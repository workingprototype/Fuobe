"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import type { Engine, Generation, GenerationRequest, MediaKind } from "./catalog/types";

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string | null;
  url: string;
  contentType: string;
  size: number;
  source: "upload" | "generation";
  createdAt: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

// ---------------------------------------------------------------------------
// Generations

export interface FeedFilter {
  kind?: MediaKind;
  features?: string[];
  favorites?: boolean;
  q?: string;
  limit?: number;
}

function feedKey(f: FeedFilter) {
  return ["generations", f] as const;
}

export function useGenerations(filter: FeedFilter) {
  return useQuery({
    queryKey: feedKey(filter),
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filter.kind) qs.set("kind", filter.kind);
      if (filter.features?.length) qs.set("features", filter.features.join(","));
      if (filter.favorites) qs.set("favorites", "1");
      if (filter.q) qs.set("q", filter.q);
      qs.set("limit", String(filter.limit ?? 80));
      return (await json<{ items: Generation[] }>(await fetch(`/api/generations?${qs}`))).items;
    },
    refetchInterval: (q) => (q.state.data?.some((g) => g.status === "queued" || g.status === "running") ? 1500 : false),
  });
}

export function useCreateGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: GenerationRequest) =>
      (
        await json<{ items: Generation[] }>(
          await fetch("/api/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
          }),
        )
      ).items,
    onSuccess: (items) => {
      // Show new cards instantly in every matching feed, then let polling take over.
      qc.setQueriesData<Generation[]>({ queryKey: ["generations"] }, (old) => (old ? [...items, ...old] : old));
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useGenerationActions() {
  const qc = useQueryClient();
  const patchLocal = (id: string, fn: (g: Generation) => Generation | null) =>
    qc.setQueriesData<Generation[]>({ queryKey: ["generations"] }, (old) =>
      old?.map((g) => (g.id === id ? fn(g) : g)).filter((g): g is Generation => !!g),
    );
  return {
    favorite: async (g: Generation) => {
      patchLocal(g.id, (x) => ({ ...x, favorite: !x.favorite }));
      await fetch(`/api/generations/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !g.favorite }),
      });
    },
    remove: async (g: Generation) => {
      patchLocal(g.id, () => null);
      await fetch(`/api/generations/${g.id}`, { method: "DELETE" });
    },
    cancel: async (g: Generation) => {
      patchLocal(g.id, (x) => ({ ...x, status: "canceled" }));
      await fetch(`/api/generations/${g.id}/cancel`, { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  };
}

// ---------------------------------------------------------------------------
// Uploads & assets

export async function uploadFile(file: File): Promise<Asset> {
  const form = new FormData();
  form.append("file", file);
  return json<Asset>(await fetch("/api/uploads", { method: "POST", body: form }));
}

export function useAssets(source?: "upload" | "generation", kind?: MediaKind) {
  return useQuery({
    queryKey: ["assets", source, kind],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (source) qs.set("source", source);
      if (kind) qs.set("kind", kind);
      return (await json<{ items: Asset[] }>(await fetch(`/api/assets?${qs}`))).items;
    },
  });
}

// ---------------------------------------------------------------------------
// Provider status

export interface StatusInfo {
  providers: Record<string, { label: string; configured: boolean }>;
  demoMode: string;
}

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: async () => json<StatusInfo>(await fetch("/api/status")),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export async function enhance(prompt: string, kind: MediaKind, op: string): Promise<string> {
  return (
    await json<{ prompt: string }>(
      await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, kind, op }),
      }),
    )
  ).prompt;
}

// ---------------------------------------------------------------------------
// Engine preference (Cloud vs Open source), shared across tabs via localStorage.

const ENGINE_KEY = "fuobe.engine";
const listeners = new Set<() => void>();

function readEngine(): Engine {
  try {
    return localStorage.getItem(ENGINE_KEY) === "open" ? "open" : "cloud";
  } catch {
    return "cloud";
  }
}

export function useEngine(): [Engine, (e: Engine) => void] {
  const engine = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    readEngine,
    () => "cloud" as Engine,
  );
  const set = useCallback((e: Engine) => {
    try {
      localStorage.setItem(ENGINE_KEY, e);
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  return [engine, set];
}
