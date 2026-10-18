"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGenerationEvents } from "@/lib/api";
import type { DubSessionView, OneShotModel } from "@/lib/av/dub";
import type { Cue } from "@/lib/cues";
import type { Engine, Generation } from "@/lib/catalog/types";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const active = (gs: Generation[]) => gs.some((g) => g.status === "queued" || g.status === "running");

/** Recent dubs; refreshed when one of their steps changes on the live stream. */
export function useDubSessions() {
  const qc = useQueryClient();
  const connected = useGenerationEvents((ev) => {
    if (ev.type === "generation" && ev.generation.feature === "dub") void qc.invalidateQueries({ queryKey: ["dub"] });
  });
  return useQuery({
    queryKey: ["dub"],
    queryFn: async () => (await json<{ items: DubSessionView[] }>(await fetch("/api/dub"))).items,
    refetchInterval: (q) => (q.state.data?.some((s) => active(Object.values(s.generations))) ? (connected ? 8000 : 2000) : false),
  });
}

export interface NewDub {
  engine: Engine;
  mode: "oneshot" | "steps";
  video: string;
  title?: string;
  source?: string;
  targets: string[];
  model?: OneShotModel;
}

export function useDubActions() {
  const qc = useQueryClient();
  const put = (s: DubSessionView) => qc.setQueryData<DubSessionView[]>(["dub"], (xs) => (xs ? [s, ...xs.filter((x) => x.id !== s.id)] : [s]));
  const create = useMutation({
    mutationFn: async (body: NewDub) => json<DubSessionView>(await fetch("/api/dub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    onSuccess: (s) => {
      put(s);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
  const saveDraft = useMutation({
    mutationFn: async ({ id, lang, cues }: { id: string; lang: string; cues: Cue[] }) =>
      json<DubSessionView>(await fetch(`/api/dub/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, cues }) })),
    onSuccess: put,
  });
  const voice = useMutation({
    mutationFn: async ({ id, lang, cues, lipsync }: { id: string; lang: string; cues?: Cue[]; lipsync?: boolean }) =>
      json<DubSessionView>(await fetch(`/api/dub/${id}/voice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, cues, lipsync }) })),
    onSuccess: (s) => {
      put(s);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dub/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("Couldn't remove it");
      return id;
    },
    onSuccess: (id) => qc.setQueryData<DubSessionView[]>(["dub"], (xs) => xs?.filter((x) => x.id !== id)),
  });
  return { create, saveDraft, voice, remove };
}
