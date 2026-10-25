"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { Engine } from "@/lib/catalog/types";
import { CURATED_SETS, type CuratedMoodboard, type CuratedSource, type Moodboard } from "./logic";

/** A curated set (Fuobe Soul's Soul 2.0 looks or its Soul looks): built in, nothing to fetch. */
export function useCuratedSet(source: CuratedSource): CuratedMoodboard[] {
  return CURATED_SETS[source];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const busy = (m: Moodboard) => m.status !== "complete" && m.status !== "failed";

/** Your moodboards (polled while one builds or trains) and Soul 2.0's curated looks. */
export function useMoodboards(enabled = true) {
  return useQuery({
    queryKey: ["moodboards"],
    queryFn: async () => json<{ items: Moodboard[]; curated: CuratedMoodboard[] }>(await fetch("/api/moodboards")),
    enabled,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.items.some((m) => busy(m) || m.lora?.status === "training") ? 2000 : false),
  });
}

export function useMoodboardActions() {
  const qc = useQueryClient();
  const done = useCallback(() => void qc.invalidateQueries({ queryKey: ["moodboards"] }), [qc]);
  const post = async <T,>(url: string, body?: unknown, method = "POST") =>
    json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const create = useMutation({
    mutationFn: (b: { name: string; images: string[]; collages: string[]; engine: Engine }) => post<Moodboard>("/api/moodboards", b),
    onSuccess: done,
  });
  const retry = useMutation({ mutationFn: (b: { id: string; engine?: Engine }) => post<Moodboard>(`/api/moodboards/${b.id}/retry`, { engine: b.engine }), onSuccess: done });
  const train = useMutation({
    mutationFn: (id: string) => post<Moodboard>(`/api/moodboards/${id}/train`),
    onSuccess: () => {
      done();
      void qc.invalidateQueries({ queryKey: ["elements"] });
    },
  });
  const rename = useMutation({ mutationFn: (b: { id: string; name: string }) => post<Moodboard>(`/api/moodboards/${b.id}`, { name: b.name }, "PATCH"), onSuccess: done });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/moodboards/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) await json(res);
    },
    onSuccess: done,
  });
  return useMemo(() => ({ create, retry, train, rename, remove }), [create, retry, train, rename, remove]);
}
