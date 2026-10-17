"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { GenParams, InputSlot, MediaKind, Operation, Preset } from "@/lib/catalog/types";
import type { FeedFilter } from "@/lib/api";
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
}

interface Ctx {
  config: StudioConfig;
  draft: Draft;
  setDraft: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
  setSlot: (key: SlotKey, v: SlotValue | null) => void;
  /** Put an image somewhere sensible (first empty image slot, else references). */
  addImage: (v: SlotValue) => void;
}

const StudioCtx = createContext<Ctx | null>(null);

export function useStudio(): Ctx {
  const c = useContext(StudioCtx);
  if (!c) throw new Error("useStudio outside StudioProvider");
  return c;
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
  const value = useMemo(() => ({ config, draft, setDraft, setSlot, addImage }), [config, draft, setDraft, setSlot, addImage]);
  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

/** Replace a slot value by key, updating only when it's the same upload (async upload callbacks). */
export function slotUpdater(setSlot: Ctx["setSlot"], key: SlotKey) {
  return (v: SlotValue | null) => setSlot(key, v);
}
