"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CinemaFolder, CinemaGenerateInput, CinemaProject, CinemaTile, DirectorMessage, DirectorSettings } from "@/lib/catalog/cinema";
import type { Generation } from "@/lib/catalog/types";
import { toStreamEvent } from "@/lib/generation-stream";
import { Autosaver } from "./autosave";
import { applyToTakes, type CinemaGeneration } from "./live";

/** React Query hooks for /api/cinema/** (kept here, next to the workspace that uses them). */

export type { CinemaGeneration };

export interface ProjectView {
  project: CinemaProject;
  folders: CinemaFolder[];
  spentUsd: number;
  context: { higgsfield: boolean; cloudAllowed: boolean };
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** `keepalive` lets a save finish after the page is gone (tab closed, reload). */
const send = async <T,>(url: string, method: string, body?: unknown, keepalive = false) =>
  json<T>(await fetch(url, { method, keepalive, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const active = (g: Generation) => g.status === "queued" || g.status === "running";

// ---------------------------------------------------------------------------
// Live updates: one EventSource on GET /api/generations/stream for the workspace's lists. While it's
// connected the takes update in place and polling drops to a slow safety net.

const live = { es: null as EventSource | null, users: 0, connected: false, client: null as QueryClient | null, listeners: new Set<() => void>() };

function setConnected(v: boolean) {
  if (live.connected === v) return;
  live.connected = v;
  live.listeners.forEach((l) => l());
}

function applyEvent(qc: QueryClient, data: string, event: string) {
  const ev = toStreamEvent({ event, data });
  if (!ev) return;
  for (const q of qc.getQueryCache().findAll({ queryKey: ["cinema"] })) {
    const k = q.queryKey;
    if (!(k[2] === "items" || k[1] === "studio")) continue;
    const old = q.state.data as CinemaGeneration[] | undefined;
    const next = applyToTakes(old, ev);
    if (next !== old) qc.setQueryData(k, next);
  }
}

function useCinemaStream(): boolean {
  const qc = useQueryClient();
  useEffect(() => {
    live.client = qc;
    live.users++;
    if (!live.es && typeof EventSource !== "undefined") {
      const es = new EventSource("/api/generations/stream");
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      for (const event of ["generation", "deleted"]) es.addEventListener(event, (m) => live.client && applyEvent(live.client, (m as MessageEvent<string>).data, event));
      live.es = es;
    }
    return () => {
      live.users--;
      if (live.users) return;
      live.es?.close();
      live.es = null;
      setConnected(false);
    };
  }, [qc]);
  return useSyncExternalStore(
    (cb) => {
      live.listeners.add(cb);
      return () => live.listeners.delete(cb);
    },
    () => live.connected,
    () => false,
  );
}

const pollEvery = (items: Generation[] | undefined, connected: boolean) => (items?.some(active) ? (connected ? 10_000 : 1500) : false);

// ---------------------------------------------------------------------------
// Queries

export function useCinemaProjects() {
  return useQuery({
    queryKey: ["cinema", "projects"],
    queryFn: async () => (await json<{ items: CinemaProject[] }>(await fetch("/api/cinema/projects"))).items,
  });
}

export function useCinemaProject(id: string) {
  return useQuery({
    queryKey: ["cinema", id],
    queryFn: async () => json<ProjectView>(await fetch(`/api/cinema/projects/${id}`)),
    retry: (n, e) => !/not found/i.test((e as Error).message) && n < 1,
  });
}

/** Every take in the project (folders are filtered in the browser); live, with polling as a fallback. */
export function useCinemaItems(id: string) {
  const connected = useCinemaStream();
  return useQuery({
    queryKey: ["cinema", id, "items"],
    queryFn: async () => (await json<{ items: CinemaGeneration[] }>(await fetch(`/api/cinema/projects/${id}/items`))).items,
    refetchInterval: (q) => pollEvery(q.state.data, connected),
  });
}

/** "My Generations": every Cinema Studio generation, in any project (each with its projectId). */
export function useStudioGenerations(id: string, enabled: boolean) {
  const connected = useCinemaStream();
  return useQuery({
    queryKey: ["cinema", "studio"],
    enabled,
    queryFn: async () => (await json<{ items: CinemaGeneration[] }>(await fetch(`/api/cinema/projects/${id}/items?scope=studio`))).items,
    refetchInterval: (q) => pollEvery(q.state.data, connected),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; cover?: string | null; costCapUsd?: number | null }) => send<CinemaProject>("/api/cinema/projects", "POST", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cinema", "projects"] }),
  });
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  cover?: string | null;
  costCapUsd?: number | null;
  director?: DirectorSettings;
  palettes?: CinemaProject["palettes"];
  brief?: { title?: string; body?: string };
  pinned?: boolean;
}

/** A patch plus `keepalive` for saves that must outlive the page (autosave on tab close). */
export type ProjectSave = ProjectPatch & { keepalive?: boolean };

const patchOf = ({ keepalive, ...patch }: ProjectSave): ProjectPatch => (void keepalive, patch);

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (save: ProjectSave) => send<CinemaProject>(`/api/cinema/projects/${id}`, "PATCH", patchOf(save), !!save.keepalive),
    onMutate: (save) => {
      const patch = patchOf(save);
      qc.setQueryData<ProjectView>(["cinema", id], (old) =>
        old ? { ...old, project: { ...old.project, ...patch, brief: { ...old.project.brief, ...patch.brief } } as CinemaProject } : old,
      );
    },
    onSuccess: (project) => {
      qc.setQueryData<ProjectView>(["cinema", id], (old) => (old ? { ...old, project } : old));
      void qc.invalidateQueries({ queryKey: ["cinema", "projects"] });
    },
  });
}

/**
 * A debounced autosave that never loses the last edit: it saves `delay` ms after the last change, and
 * right away when the component unmounts (a closed panel, a tab switch, leaving the page) or the
 * browser tab is hidden or closed (then with keepalive).
 */
export function useAutosave<T>(save: (value: T, opts: { keepalive: boolean }) => void, delay: number): Autosaver<T> {
  const [saver] = useState(() => new Autosaver(save, delay));
  useEffect(() => saver.setSave(save));
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") saver.flush(true);
    };
    const exit = () => saver.flush(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", exit);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", exit);
      saver.flush();
    };
  }, [saver]);
  return saver;
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>(`/api/cinema/projects/${id}`, "DELETE"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cinema", "projects"] }),
  });
}

export function useFolderActions(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["cinema", projectId] });
  };
  return {
    create: async (body: { name: string; parentId?: string | null; color?: string | null }) => {
      const f = await send<CinemaFolder>(`/api/cinema/projects/${projectId}/folders`, "POST", body);
      refresh();
      return f;
    },
    update: async (folderId: string, patch: Partial<Pick<CinemaFolder, "name" | "color" | "pinned" | "parentId" | "position">>) => {
      qc.setQueryData<ProjectView>(["cinema", projectId], (old) => (old ? { ...old, folders: old.folders.map((f) => (f.id === folderId ? { ...f, ...patch } : f)) } : old));
      try {
        await send<CinemaFolder>(`/api/cinema/projects/${projectId}/folders/${folderId}`, "PATCH", patch);
      } finally {
        refresh();
      }
    },
    remove: async (folderId: string) => {
      await send<void>(`/api/cinema/projects/${projectId}/folders/${folderId}`, "DELETE");
      refresh();
    },
  };
}

/** Whether a listed take belongs to another project (only "My Generations" shows those). */
export const foreign = (g: CinemaGeneration, projectId: string) => !!g.projectId && g.projectId !== projectId;

/**
 * Actions on takes. Likes and deletes go through the library (/api/generations/bulk) so they work
 * on any project's take; Delete moves to the Trash and comes with Undo. Moves are this project's
 * only; retries go to the project that owns the take.
 */
export function useItemActions(projectId: string) {
  const qc = useQueryClient();
  const keys = [["cinema", projectId, "items"], ["cinema", "studio"]];
  const patchLocal = (ids: string[], fn: (g: CinemaGeneration) => CinemaGeneration | null) => {
    for (const key of keys) qc.setQueryData<CinemaGeneration[]>(key, (old) => old?.map((g) => (ids.includes(g.id) ? fn(g) : g)).filter((g): g is CinemaGeneration => !!g));
  };
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ["cinema"] });
    void qc.invalidateQueries({ queryKey: ["generations"] });
    void qc.invalidateQueries({ queryKey: ["library"] });
    void qc.invalidateQueries({ queryKey: ["library-facets"] });
  };
  const bulk = (action: "favorite" | "unfavorite" | "trash" | "restore", ids: string[]) => send<{ count: number }>("/api/generations/bulk", "POST", { action, ids });
  return {
    /** Move this project's takes to a folder; returns how many moved. */
    move: async (ids: string[], folderId: string | null) => {
      patchLocal(ids, (g) => (foreign(g, projectId) ? g : { ...g, folderId }));
      return (await send<{ moved: number }>(`/api/cinema/projects/${projectId}/items`, "PATCH", { ids, folderId }).finally(settle)).moved;
    },
    favorite: async (ids: string[], favorite: boolean) => {
      patchLocal(ids, (g) => ({ ...g, favorite }));
      await bulk(favorite ? "favorite" : "unfavorite", ids).finally(settle);
    },
    /** Move to the Trash (restore with `restore`): the takes stay filed in their project. */
    remove: async (ids: string[]) => {
      patchLocal(ids, () => null);
      await bulk("trash", ids).finally(settle);
    },
    restore: async (ids: string[]) => {
      await bulk("restore", ids).finally(settle);
    },
    cancel: async (g: Generation) => {
      patchLocal([g.id], (x) => ({ ...x, status: "canceled" }));
      await fetch(`/api/generations/${g.id}/cancel`, { method: "POST" }).finally(settle);
    },
    retry: async (g: CinemaGeneration) => {
      await send(`/api/cinema/projects/${g.projectId ?? projectId}/items/${g.id}/retry`, "POST").finally(settle);
    },
    saveTiles: async (generationId: string, tiles: CinemaTile[]) => {
      await send(`/api/cinema/projects/${projectId}/items/${generationId}/tiles`, "PUT", { tiles });
      patchLocal([generationId], (g) => ({ ...g, tiles }));
    },
  };
}

export type GenerateBody = { input: Omit<CinemaGenerateInput, "brief">; folderId: string | null };
export type GenerateResult = { items: Generation[]; folderId: string | null; plan: { notes: string[]; costUsd: number | null; outputs: number; modelId: string } };

export function useCinemaGenerate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateBody) => send<GenerateResult>(`/api/cinema/projects/${projectId}/generate`, "POST", body),
    onSuccess: (res, body) => {
      // New takes appear at once (where the server filed them); the stream and polling take over.
      const folderId = res.folderId === undefined ? body.folderId : res.folderId;
      qc.setQueryData<CinemaGeneration[]>(["cinema", projectId, "items"], (old) =>
        old ? [...res.items.map((g) => ({ ...g, folderId, projectId, take: { mode: body.input.mode, action: body.input.action, prompt: body.input.prompt, moves: body.input.moves } })), ...old] : old,
      );
      void qc.invalidateQueries({ queryKey: ["cinema", projectId] });
    },
  });
}

export function useDirectorChat(projectId: string) {
  const qc = useQueryClient();
  const key = ["cinema", projectId, "director"];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await json<{ messages: DirectorMessage[] }>(await fetch(`/api/cinema/projects/${projectId}/director`))).messages,
  });
  const ask = useMutation({
    mutationFn: async (text: string) => (await send<{ messages: DirectorMessage[] }>(`/api/cinema/projects/${projectId}/director`, "POST", { text })).messages,
    onMutate: (text) => {
      qc.setQueryData<DirectorMessage[]>(key, (old) => [...(old ?? []), { id: `pending-${Date.now()}`, role: "user", text, createdAt: Date.now() }]);
    },
    onSuccess: (messages) => qc.setQueryData(key, messages),
    onError: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const clear = async () => {
    qc.setQueryData(key, []);
    await send(`/api/cinema/projects/${projectId}/director`, "DELETE");
  };
  return { messages: query.data ?? [], loading: query.isLoading, ask, clear };
}
