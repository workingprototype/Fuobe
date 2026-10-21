"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue } from "react";
import type { MixedResolution, MixedValues } from "@/lib/catalog/mixed-media";
import type { Engine, Generation } from "@/lib/catalog/types";
import { useGenerationEvents } from "@/lib/api";
import { send } from "@/components/shorts/hooks";

/** React Query hooks for /api/mixed-media/** (renders, preview frames, estimates). */

export interface MixedBody {
  engine: Engine;
  presetId: string;
  values: MixedValues;
  source: { url: string; name?: string; duration?: number; fps?: number };
  range: { start: number; end: number };
  fps: number;
  resolution: MixedResolution;
  modelId?: string;
  anchor?: string;
  frameUrl?: string;
  /** Client nonce: a repeat of it gets the first answer (see useSubmitGuard). */
  requestId?: string;
}

export interface MixedEstimate {
  costUsd: number | null;
  previewUsd: number | null;
  demo: boolean;
  frames: number;
  fps: number;
  notes: string[];
}

export function useMixedEstimate(body: MixedBody | null) {
  const key = useDeferredValue(body ? JSON.stringify(body) : null);
  return useQuery({
    queryKey: ["mixed-media", "estimate", key],
    queryFn: async () => send<MixedEstimate>("/api/mixed-media/estimate", "POST", JSON.parse(key!)),
    enabled: !!key,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

const active = (g?: Generation | null) => !!g && (g.status === "queued" || g.status === "running");

/** Follow one generation (a preview frame, the latest render) until it settles. */
export function useWatchedGeneration(id: string | null) {
  const qc = useQueryClient();
  const connected = useGenerationEvents((ev) => {
    if (!id) return;
    if (ev.type === "generation" && ev.generation.id === id) qc.setQueryData(["mixed-media", "generation", id], ev.generation);
  });
  return useQuery({
    queryKey: ["mixed-media", "generation", id],
    queryFn: async () => send<Generation>(`/api/generations/${id}`, "GET"),
    enabled: !!id,
    refetchInterval: (q) => (active(q.state.data) ? (connected ? 5000 : 1200) : false),
  });
}

export function useMixedActions() {
  const qc = useQueryClient();
  const seed = (g: Generation) => qc.setQueryData(["mixed-media", "generation", g.id], g);
  return {
    render: useMutation({
      mutationFn: (b: MixedBody) => send<{ final: Generation; items: Generation[] }>("/api/mixed-media", "POST", b),
      onSuccess: (r) => {
        seed(r.final);
        void qc.invalidateQueries({ queryKey: ["generations"] });
      },
    }),
    preview: useMutation({
      mutationFn: (b: MixedBody) => send<Generation>("/api/mixed-media/preview", "POST", b),
      onSuccess: seed,
    }),
  };
}
