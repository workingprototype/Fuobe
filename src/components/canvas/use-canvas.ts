"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Canvas, CanvasGraph, CanvasPlan, CanvasSummary } from "@/lib/catalog/canvas";
import type { Engine, Generation } from "@/lib/catalog/types";

/** Client hooks for /api/canvases (kept next to the canvas UI; the shapes live in src/lib/catalog/canvas.ts). */

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { body });
  return body;
}

const send = (url: string, method: string, body?: unknown, init?: RequestInit) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), ...init });

export interface CanvasView {
  canvas: Canvas;
  generations: Generation[];
}

const active = (g: Generation) => g.status === "queued" || g.status === "running";

export function useCanvases() {
  return useQuery({
    queryKey: ["canvases"],
    queryFn: async () => (await json<{ items: CanvasSummary[] }>(await fetch("/api/canvases"))).items,
  });
}

/**
 * One canvas with its nodes' generations. Polls while something renders (slower when the live
 * stream delivers updates).
 */
export function useCanvasView(id: string, live: boolean) {
  return useQuery({
    queryKey: ["canvases", id],
    queryFn: async () => json<CanvasView>(await fetch(`/api/canvases/${id}`)),
    refetchInterval: (q) => (q.state.data?.generations.some(active) ? (live ? 6000 : 1500) : false),
    // The editor owns the graph once loaded; refetches only bring runs and generations.
    refetchOnWindowFocus: false,
  });
}

export function useCanvasActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["canvases"], exact: true });
  return {
    create: async (body: { name?: string; templateId?: string; engine?: Engine; graph?: CanvasGraph }) => {
      const c = await json<Canvas>(await send("/api/canvases", "POST", body));
      refresh();
      return c;
    },
    rename: async (id: string, name: string) => {
      qc.setQueryData<CanvasSummary[]>(["canvases"], (old) => old?.map((c) => (c.id === id ? { ...c, name } : c)));
      await json<Canvas>(await send(`/api/canvases/${id}`, "PATCH", { name }));
      refresh();
    },
    duplicate: async (id: string) => {
      const c = await json<Canvas>(await send(`/api/canvases/${id}/duplicate`, "POST"));
      refresh();
      return c;
    },
    remove: async (id: string) => {
      qc.setQueryData<CanvasSummary[]>(["canvases"], (old) => old?.filter((c) => c.id !== id));
      const res = await fetch(`/api/canvases/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("Couldn't delete it. Please try again.");
      qc.removeQueries({ queryKey: ["canvases", id] });
      refresh();
    },
  };
}

/** Save the board (autosave). `keepalive` lets a save started while leaving the page finish. */
export async function saveCanvas(id: string, patch: { name?: string; graph?: CanvasGraph }, keepalive = false): Promise<Canvas> {
  return json<Canvas>(await send(`/api/canvases/${id}`, "PATCH", patch, { keepalive }));
}

export interface RunResponse {
  canvas: Canvas;
  items: Generation[];
  ran: string[];
  reused: CanvasPlan["reused"];
  errors: CanvasPlan["errors"];
  costUsd: number;
}

export function useRunCanvas(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { targets?: string[]; force?: boolean; graph: CanvasGraph }) => {
      const res = await send(`/api/canvases/${id}/run`, "POST", body);
      const data = (await res.json().catch(() => ({}))) as Partial<RunResponse> & { error?: string };
      if (!res.ok && !data.errors) throw new Error(data.error ?? `Request failed (${res.status})`);
      return { ...data, ok: res.ok } as RunResponse & { ok: boolean; error?: string };
    },
    onSuccess: (r) => {
      if (!r.canvas) return;
      qc.setQueryData<CanvasView>(["canvases", id], (old) => {
        const known = new Map((old?.generations ?? []).map((g) => [g.id, g]));
        for (const g of r.items ?? []) known.set(g.id, g);
        return { canvas: { ...(old?.canvas ?? r.canvas), runs: r.canvas.runs, updatedAt: r.canvas.updatedAt }, generations: [...known.values()] };
      });
      // New results appear in the library and feeds too.
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["canvases"], exact: true });
    },
  });
}

/**
 * Live generation updates from GET /api/generations/stream (when this install has it): patches the
 * canvas view as soon as a node's job moves. Returns whether the stream is connected; without it
 * the view falls back to polling.
 */
export function useLiveGenerations(id: string): boolean {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const failed = useRef(false);
  useEffect(() => {
    if (failed.current || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/generations/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => {
      // A missing endpoint (404) or a dropped connection: poll instead; don't hammer the server.
      if (es.readyState === EventSource.CLOSED) {
        failed.current = true;
        setLive(false);
      }
    };
    es.addEventListener("generation", (e) => {
      let g: Generation;
      try {
        g = JSON.parse((e as MessageEvent<string>).data) as Generation;
      } catch {
        return;
      }
      qc.setQueryData<CanvasView>(["canvases", id], (old) => {
        if (!old || !old.generations.some((x) => x.id === g.id)) return old;
        return { ...old, generations: old.generations.map((x) => (x.id === g.id ? g : x)) };
      });
    });
    return () => {
      es.close();
      setLive(false);
    };
  }, [id, qc]);
  return live;
}
