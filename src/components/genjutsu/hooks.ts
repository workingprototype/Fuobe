"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenjutsuLook, GenjutsuMode, GenjutsuTarget, GenjutsuTier } from "@/lib/catalog/genjutsu";
import type { Engine, Generation, PixelPoint } from "@/lib/catalog/types";
import { useDebounced } from "@/components/faceless/hooks";
import { send } from "@/components/shorts/hooks";

/** React Query hooks for /api/genjutsu/** and Higgsfield's live Genjutsu looks. */

export interface GenjutsuBody {
  engine: Engine;
  mode: GenjutsuMode;
  modelId?: string;
  tier?: GenjutsuTier;
  quality?: string;
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  points?: PixelPoint[];
  frame?: { width: number; height: number };
  mask?: string;
  references?: string[];
  look?: GenjutsuLook;
  source: { url: string; name?: string; duration?: number; fps?: number; width?: number; height?: number; hasAudio?: boolean };
  range?: { start: number; end: number };
  seed?: number;
  /** Client nonce: a repeat of it gets the first answer (see useSubmitGuard). */
  requestId?: string;
}

export interface GenjutsuEstimate {
  costUsd: number | null;
  demo: boolean;
  modelId: string;
  modelName: string;
  tier?: GenjutsuTier;
  quality?: string;
  pieces: number;
  seconds: number;
  steps: number;
  notes: string[];
  higgsfield: boolean;
}

/** The price and shape of a run for the current settings, asked for once typing pauses (300 ms). */
export function useGenjutsuEstimate(body: GenjutsuBody | null) {
  const key = useDebounced(body ? JSON.stringify(body) : null, 300);
  return useQuery({
    queryKey: ["genjutsu", "estimate", key],
    queryFn: async () => send<GenjutsuEstimate>("/api/genjutsu/estimate", "POST", JSON.parse(key!)),
    enabled: !!key,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

export function useGenjutsuRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: GenjutsuBody) => send<{ final: Generation; items: Generation[] }>("/api/genjutsu", "POST", b),
    onSuccess: (r) => {
      r.items.forEach((g) => qc.setQueryData(["generation", g.id], g));
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export interface HiggsfieldLook {
  id: string;
  name: string;
  preview?: string;
}

/** Higgsfield's own Genjutsu looks (a key is needed; the list comes live from Higgsfield). */
export function useHiggsfieldLooks(enabled: boolean) {
  return useQuery({
    queryKey: ["provider-presets", "genjutsu-restyle"],
    queryFn: async () => (await (await fetch("/api/providers/higgsfield/presets?source=genjutsu-restyle")).json()) as { items: HiggsfieldLook[]; error?: string },
    enabled,
    staleTime: 60 * 60 * 1000,
  });
}
