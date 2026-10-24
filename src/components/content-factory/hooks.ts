"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeriesCard, SeriesEstimate, SeriesSettings, SeriesView, StyleBrief } from "@/lib/catalog/content-factory";
import type { NarratorVoice } from "@/lib/catalog/faceless";
import type { Engine } from "@/lib/catalog/types";
import { useDebounced } from "@/components/faceless/hooks";

/** React Query hooks for /api/content-factory/** (kept next to the views that use them). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly needsUpload = false,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; needsUpload?: boolean };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, !!body.needsUpload);
  return body;
}

const send = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

export type ReferenceInput = { kind: "upload"; url: string; title?: string } | { kind: "link"; link: string } | { kind: "preset"; presetId: string };

/** What the composer sends for a price, a run or the Claude message. */
export interface SeriesAsk {
  prompt: string;
  settings: SeriesSettings;
  voice?: NarratorVoice | null;
  subtitles?: boolean;
  music?: boolean;
}

const inFlight = (v: SeriesView) => v.analysis?.status === "reading" || v.episodes.some((e) => e.status === "writing" || e.status === "rendering");

export function useSeriesList() {
  return useQuery({
    queryKey: ["content-factory", "series"],
    queryFn: async () => (await json<{ items: SeriesCard[] }>(await fetch("/api/content-factory/series"))).items,
    refetchInterval: (q) => (q.state.data?.some((s) => s.rendering > 0) ? 5000 : false),
  });
}

export function useSeries(id: string | null) {
  return useQuery({
    queryKey: ["content-factory", "series", id],
    enabled: !!id,
    queryFn: async () => json<SeriesView>(await fetch(`/api/content-factory/series/${id}`)),
    retry: (n, e) => !/not found/i.test((e as Error).message) && n < 1,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return d.analysis?.status === "reading" ? 1200 : inFlight(d) ? 3000 : false;
    },
  });
}

/** Put a fresh view in the cache (so the page shows it without a refetch). */
function useSetView() {
  const qc = useQueryClient();
  return (v: SeriesView) => {
    qc.setQueryData(["content-factory", "series", v.id], v);
    void qc.invalidateQueries({ queryKey: ["content-factory", "series"], exact: true });
  };
}

export function useCreateSeries() {
  const set = useSetView();
  return useMutation({
    mutationFn: (b: { reference: ReferenceInput | null; engine: Engine; prompt?: string }) => send<SeriesView>("/api/content-factory/series", "POST", b),
    onSuccess: set,
  });
}

export function useRereadSeries() {
  const set = useSetView();
  return useMutation({ mutationFn: ({ id, engine }: { id: string; engine: Engine }) => send<SeriesView>(`/api/content-factory/series/${id}/read`, "POST", { engine }), onSuccess: set });
}

export function useUpdateSeries() {
  const set = useSetView();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; brief?: StyleBrief; name?: string }) => send<SeriesView>(`/api/content-factory/series/${id}`, "PATCH", b), onSuccess: set });
}

export function useGenerateSeries() {
  const set = useSetView();
  return useMutation({ mutationFn: ({ id, ...b }: SeriesAsk & { id: string; review?: boolean }) => send<SeriesView>(`/api/content-factory/series/${id}/generate`, "POST", b), onSuccess: set });
}

export function useAddEpisodes(id: string) {
  const set = useSetView();
  return useMutation({ mutationFn: (b: { count: number; next?: string; review?: boolean }) => send<SeriesView>(`/api/content-factory/series/${id}/episodes`, "POST", b), onSuccess: set });
}

export function useDeleteSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>(`/api/content-factory/series/${id}`, "DELETE"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content-factory"] }),
  });
}

export function useSeriesEstimate(input: (SeriesAsk & { seriesId?: string; presetId?: string }) | null) {
  const key = input && JSON.stringify(input);
  const debounced = useDebounced(key, 300);
  const q = useQuery({
    queryKey: ["content-factory", "estimate", debounced],
    enabled: !!debounced,
    queryFn: async () => send<SeriesEstimate>("/api/content-factory/estimate", "POST", JSON.parse(debounced!)),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: false,
  });
  return { data: q.data, error: q.error as Error | null, isFetching: q.isFetching || key !== debounced };
}

export const claudePrompt = (b: SeriesAsk & { seriesId?: string; presetId?: string }) =>
  send<{ message: string; bytes: number; needsToken: boolean }>("/api/content-factory/claude", "POST", b);
