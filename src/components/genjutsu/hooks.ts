"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CharacterOptions } from "@/lib/catalog/character-swap";
import type { GenjutsuLook, GenjutsuMode, GenjutsuTarget, GenjutsuTier, MakerSource } from "@/lib/catalog/genjutsu";
import type { Engine, Generation, PixelPoint } from "@/lib/catalog/types";
import { useDebounced } from "@/components/faceless/hooks";
import { send } from "@/components/shorts/hooks";

/** React Query hooks for /api/genjutsu/**. */

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
  /** Character swap's settings. */
  character?: CharacterOptions;
  /** Hard cuts the browser found in the clip (seconds): the server warns when the part has one. */
  cuts?: number[];
  /** Client nonce: a repeat of it gets the first answer (see useSubmitGuard). */
  requestId?: string;
}

export interface GenjutsuEstimate {
  costUsd: number | null;
  demo: boolean;
  modelId: string;
  modelName: string;
  /** A Fuobe Original, other open weights, or a partner's model. */
  source: MakerSource;
  tier?: GenjutsuTier;
  quality?: string;
  pieces: number;
  seconds: number;
  steps: number;
  notes: string[];
  /** Character swap: first frames made, the limits, and the GPU the open route was tested on. */
  anchors?: number;
  limits?: string[];
  gpu?: { weightsGb: number; tested: string; advice: string; speed: string };
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
