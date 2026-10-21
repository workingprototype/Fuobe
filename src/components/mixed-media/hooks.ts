"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Follow every step of a render (cut → restyle → sound), so a failed step shows its own error. */
export function useWatchedChain(ids: string[]): (Generation | undefined)[] {
  const qc = useQueryClient();
  const connected = useGenerationEvents((ev) => {
    if (ev.type === "generation" && ids.includes(ev.generation.id)) qc.setQueryData(["mixed-media", "generation", ev.generation.id], ev.generation);
  });
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["mixed-media", "generation", id],
      queryFn: async () => send<Generation>(`/api/generations/${id}`, "GET"),
      refetchInterval: (q: { state: { data?: Generation } }) => (active(q.state.data) ? (connected ? 5000 : 1200) : false),
    })),
  }).map((q) => q.data);
}

/** What each step of a render is doing, for chainState(). */
export function renderSteps(chain: (Generation | undefined)[]): { g?: Generation; label: string }[] {
  return chain.map((g) => ({
    g,
    label: !g ? "A step" : g.op === "trim" ? "Cutting the clip" : g.op === "mux" ? "Putting the sound back" : "Restyling",
  }));
}

export function useMixedActions() {
  const qc = useQueryClient();
  const seed = (g: Generation) => qc.setQueryData(["mixed-media", "generation", g.id], g);
  return {
    render: useMutation({
      mutationFn: (b: MixedBody) => send<{ final: Generation; items: Generation[] }>("/api/mixed-media", "POST", b),
      onSuccess: (r) => {
        r.items.forEach(seed);
        void qc.invalidateQueries({ queryKey: ["generations"] });
      },
    }),
    preview: useMutation({
      mutationFn: (b: MixedBody) => send<Generation>("/api/mixed-media/preview", "POST", b),
      onSuccess: seed,
    }),
    /** Run a finished-or-failed render again with the same settings (History's "Try again"). */
    retry: useMutation({
      mutationFn: (v: { id: string; requestId?: string }) => send<{ final: Generation; items: Generation[] }>("/api/mixed-media/retry", "POST", v),
      onSuccess: (r) => {
        r.items.forEach(seed);
        void qc.invalidateQueries({ queryKey: ["generations"] });
      },
    }),
  };
}
