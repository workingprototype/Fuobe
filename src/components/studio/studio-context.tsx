"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { GenParams, InputSlot, MediaKind, Operation, Preset } from "@/lib/catalog/types";
import type { FeedFilter } from "@/lib/api";
import type { Signature } from "@/lib/catalog/palettes";
import type { SlotValue } from "./media-slot";

export type SlotKey = InputSlot["key"];

export interface StudioConfig {
  /** Stored on each generation; used for feed filtering. */
  feature: string;
  title: string;
  hero: string;
  /** Small line under the hero (e.g. which models an app runs on). */
  subtitle?: string;
  placeholder: string;
  kind: MediaKind;
  /** Operations whose models appear in the picker. */
  ops: Operation[];
  /** Narrower than `ops` for the picker list: the Image studio lists text-to-image models; edit-only tools live in Edit. */
  pickerOps?: Operation[];
  feed: FeedFilter;
  slots: InputSlot[];
  /** Extra reference images (multi-reference edit / image prompt), or a list of clips (kind "video": join clips). */
  multiRef?: { label: string; max: number; kind?: MediaKind };
  /** Preset picker shown in the composer. */
  presetPicker?: "motion" | "effect";
  preset?: Preset;
  defaultModels: { cloud: string; open: string };
  suggestions?: string[];
  /** Prompt is optional (e.g. motions, upscale). */
  promptOptional?: boolean;
  hidePrompt?: boolean;
  /** Paint tools offered on the first image: an inpaint mask and/or freehand drawing. */
  sketch?: ("mask" | "draw")[];
  /** Open the editor as soon as an image is attached (Inpaint). */
  sketchAutoOpen?: "mask" | "draw";
  /** Appended to the user prompt on submit (e.g. identity lock for characters). */
  promptSuffix?: string;
  /** Optional slots of which one is needed (Lipsync: a portrait or a video): Generate names the group. */
  anyOf?: SlotKey[][];
  /** Color signature + Moodboard chips (Image studio): a saved palette and a style, routed per model (src/lib/catalog/palettes.ts). */
  signature?: boolean;
  /** Models the studio can be moved to (by the signature chips) beyond its picker list and defaults: kept in its model slice. */
  extraModels?: string[];
}

export interface Draft {
  prompt: string;
  negativePrompt: string;
  modelId: string;
  params: GenParams;
  slots: Partial<Record<SlotKey, SlotValue | null>>;
  refs: SlotValue[];
  presetId?: string;
  presetOptions: Record<string, string>;
  /** Motions/effects: strength of the preset, and an optional second one mixed in (Mix). */
  presetStrength?: number;
  mix?: { presetId: string; strength: number };
  /** The Color signature and Moodboard picked in the composer (studios with `signature`). */
  signature?: Signature;
}

interface Actions {
  config: StudioConfig;
  setDraft: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
  setSlot: (key: SlotKey, v: SlotValue | null) => void;
  /** Put an image somewhere sensible (first empty image slot, else references). */
  addImage: (v: SlotValue) => void;
}

interface Ctx extends Actions {
  draft: Draft;
}

// Two contexts: the draft changes on every keystroke, the config and actions never do, so the
// page shell and the feed (which only need actions) don't re-render while you type.
const ActionsCtx = createContext<Actions | null>(null);
const DraftCtx = createContext<Draft | null>(null);

/** Config and stable actions only: use this where the draft isn't needed (no re-render per keystroke). */
export function useStudioActions(): Actions {
  const c = useContext(ActionsCtx);
  if (!c) throw new Error("useStudioActions outside StudioProvider");
  return c;
}

/** Everything, including the draft (re-renders on every draft change). */
export function useStudio(): Ctx {
  const actions = useStudioActions();
  const draft = useContext(DraftCtx)!;
  return useMemo(() => ({ ...actions, draft }), [actions, draft]);
}

export function StudioProvider({
  config,
  initial,
  children,
}: {
  config: StudioConfig;
  initial: Draft;
  children: React.ReactNode;
}) {
  const [draft, setState] = useState<Draft>(initial);
  const setDraft = useCallback<Ctx["setDraft"]>((patch) => {
    setState((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
  }, []);
  const setSlot = useCallback((key: SlotKey, v: SlotValue | null) => {
    setState((d) => ({ ...d, slots: { ...d.slots, [key]: v } }));
  }, []);
  const addImage = useCallback(
    (v: SlotValue) => {
      setState((d) => {
        const empty = config.slots.find((s) => s.accept === v.kind && !d.slots[s.key]);
        if (empty) return { ...d, slots: { ...d.slots, [empty.key]: v } };
        if (config.multiRef && v.kind === "image" && d.refs.length < config.multiRef.max) return { ...d, refs: [...d.refs, v] };
        const first = config.slots.find((s) => s.accept === v.kind);
        if (first) return { ...d, slots: { ...d.slots, [first.key]: v } };
        return d;
      });
    },
    [config],
  );
  const actions = useMemo(() => ({ config, setDraft, setSlot, addImage }), [config, setDraft, setSlot, addImage]);
  return (
    <ActionsCtx.Provider value={actions}>
      <DraftCtx.Provider value={draft}>{children}</DraftCtx.Provider>
    </ActionsCtx.Provider>
  );
}

/** Replace a slot value by key, updating only when it's the same upload (async upload callbacks). */
export function slotUpdater(setSlot: Actions["setSlot"], key: SlotKey) {
  return (v: SlotValue | null) => setSlot(key, v);
}
