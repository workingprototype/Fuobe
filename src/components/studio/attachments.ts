"use client";

import { nanoid } from "nanoid";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { placeAttachment, replaceAttachment } from "@/lib/composer";
import type { InputSlot, MediaKind } from "@/lib/catalog/types";
import { fileToSlot, kindOfFile, type SlotValue } from "./media-slot";
import { useStudio, type Draft, type SlotKey } from "./studio-context";

/**
 * In-flight uploads by attachment id. `seen` turns true once the attachment is in the draft;
 * when a seen attachment leaves the draft (removed, replaced, the draft reset by Reuse) its
 * upload is aborted, and a result that arrives anyway finds nothing to replace.
 */
const inflight = new Map<string, { ac: AbortController; seen: boolean }>();

/** Abort uploads whose attachment is gone from the draft. Mount once, where the draft is read. */
export function useUploadReaper(draft: Pick<Draft, "slots" | "refs">) {
  useEffect(() => {
    if (!inflight.size) return;
    const ids = new Set([...Object.values(draft.slots), ...draft.refs].map((v) => v?.id).filter(Boolean));
    for (const [id, e] of inflight) {
      if (ids.has(id)) e.seen = true;
      else if (e.seen) {
        e.ac.abort();
        inflight.delete(id);
      }
    }
  }, [draft.slots, draft.refs]);
}

/**
 * Attach files to the studio draft: paste, drop, the "+" menu and the slot tiles all go through
 * here. Each file is placed once with its local preview, then swapped for the uploaded asset by
 * id (never re-added if it was removed meanwhile).
 */
export function useAttach(slots: InputSlot[], refMax: number) {
  const { config, setDraft } = useStudio();

  /** Upload a file: `place` runs once with the local preview, the result replaces it by id. */
  const start = useCallback(
    (file: File, place: (v: SlotValue) => void, kind?: MediaKind) => {
      const id = nanoid(8);
      const entry = { ac: new AbortController(), seen: false };
      inflight.set(id, entry);
      let placed = false;
      void fileToSlot(
        file,
        (v) => {
          if (!placed) {
            placed = true;
            if (v) place({ ...v, id });
            else inflight.delete(id);
            return;
          }
          inflight.delete(id);
          setDraft((d) => replaceAttachment(d, id, v) ?? {});
        },
        kind,
        { signal: entry.ac.signal },
      );
    },
    [setDraft],
  );

  const kinds = useMemo(() => {
    const k = new Set<MediaKind>(slots.filter((s) => s.key !== "mask" && s.key !== "sketch").map((s) => s.accept));
    if (config.multiRef) k.add(config.multiRef.kind ?? "image");
    return k;
  }, [slots, config.multiRef]);

  /** Wherever it fits best: the first empty slot of its kind, else the references. */
  const attach = useCallback((v: SlotValue) => setDraft((d) => placeAttachment(d, slots, config.multiRef, refMax, v) ?? {}), [setDraft, slots, config.multiRef, refMax]);

  const attachFiles = useCallback(
    (files: File[]) => {
      const usable = files.filter((f) => kinds.has(kindOfFile(f)));
      if (usable.length < files.length) toast(files.length - usable.length > 1 ? "This studio doesn't take those files" : "This studio doesn't take that kind of file");
      for (const f of usable.slice(0, 8)) start(f, attach);
    },
    [kinds, start, attach],
  );

  /** A slot tile: replace its value (an upload it held is cancelled by the reaper). */
  const setSlotValue = useCallback(
    (key: SlotKey, v: SlotValue | null) =>
      // A drawing belongs to the image it was made on.
      setDraft((d) => ({ slots: { ...d.slots, [key]: v, ...(key === "image" && d.slots.image?.ref !== v?.ref && { mask: null, sketch: null }) } })),
    [setDraft],
  );

  const uploadToSlot = useCallback((key: SlotKey, file: File, kind: MediaKind) => start(file, (v) => setSlotValue(key, v), kind), [start, setSlotValue]);

  const removeRef = useCallback((r: SlotValue) => setDraft((d) => ({ refs: d.refs.filter((x) => (r.id ? x.id !== r.id : x !== r)) })), [setDraft]);

  const addRefFile = useCallback((file: File) => start(file, (v) => setDraft((d) => ({ refs: [...d.refs, v] })), config.multiRef?.kind), [start, setDraft, config.multiRef]);

  return useMemo(() => ({ kinds, attach, attachFiles, setSlotValue, uploadToSlot, removeRef, addRefFile }), [kinds, attach, attachFiles, setSlotValue, uploadToSlot, removeRef, addRefFile]);
}

/**
 * The page's drop zone hands files to the composer, which knows the current slots (they change
 * with the model and preset). The composer registers its `attachFiles` here.
 */
export interface ComposerBridge {
  current: ((files: File[]) => void) | null;
}

export const ComposerBridgeCtx = createContext<ComposerBridge | null>(null);

export function useComposerBridge(): ComposerBridge | null {
  return useContext(ComposerBridgeCtx);
}
