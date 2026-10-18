"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CinemaFolder, CinemaGenerateInput, CinemaProject, CinemaTakeInfo, CinemaTile, DirectorMessage, DirectorSettings } from "@/lib/catalog/cinema";
import type { Generation } from "@/lib/catalog/types";

/** React Query hooks for /api/cinema/** (kept here, next to the workspace that uses them). */

export type CinemaGeneration = Generation & { folderId: string | null; tiles?: CinemaTile[]; take?: CinemaTakeInfo };

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

const send = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const active = (g: Generation) => g.status === "queued" || g.status === "running";

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

/** Every take in the project (folders are filtered in the browser); polls while anything renders. */
export function useCinemaItems(id: string) {
  return useQuery({
    queryKey: ["cinema", id, "items"],
    queryFn: async () => (await json<{ items: CinemaGeneration[] }>(await fetch(`/api/cinema/projects/${id}/items`))).items,
    refetchInterval: (q) => (q.state.data?.some(active) ? 1500 : false),
  });
}

/** "My Generations": every Cinema Studio generation, in any project. */
export function useStudioGenerations(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["cinema", "studio"],
    enabled,
    queryFn: async () => (await json<{ items: CinemaGeneration[] }>(await fetch(`/api/cinema/projects/${id}/items?scope=studio`))).items,
    refetchInterval: (q) => (q.state.data?.some(active) ? 1500 : false),
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

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProjectPatch) => send<CinemaProject>(`/api/cinema/projects/${id}`, "PATCH", patch),
    onMutate: (patch) => {
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

export function useItemActions(projectId: string) {
  const qc = useQueryClient();
  const key = ["cinema", projectId, "items"];
  const patchLocal = (ids: string[], fn: (g: CinemaGeneration) => CinemaGeneration | null) =>
    qc.setQueryData<CinemaGeneration[]>(key, (old) => old?.map((g) => (ids.includes(g.id) ? fn(g) : g)).filter((g): g is CinemaGeneration => !!g));
  const settle = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["cinema", "studio"] });
    void qc.invalidateQueries({ queryKey: ["generations"] });
  };
  return {
    move: async (ids: string[], folderId: string | null) => {
      patchLocal(ids, (g) => ({ ...g, folderId }));
      await send(`/api/cinema/projects/${projectId}/items`, "PATCH", { ids, folderId }).finally(settle);
    },
    favorite: async (ids: string[], favorite: boolean) => {
      patchLocal(ids, (g) => ({ ...g, favorite }));
      await send(`/api/cinema/projects/${projectId}/items`, "PATCH", { ids, favorite }).finally(settle);
    },
    remove: async (ids: string[]) => {
      patchLocal(ids, () => null);
      await send(`/api/cinema/projects/${projectId}/items`, "DELETE", { ids, deleteGenerations: true }).finally(settle);
    },
    cancel: async (g: Generation) => {
      patchLocal([g.id], (x) => ({ ...x, status: "canceled" }));
      await fetch(`/api/generations/${g.id}/cancel`, { method: "POST" }).finally(settle);
    },
    retry: async (generationId: string) => {
      await send(`/api/cinema/projects/${projectId}/items/${generationId}/retry`, "POST").finally(settle);
    },
    saveTiles: async (generationId: string, tiles: CinemaTile[]) => {
      await send(`/api/cinema/projects/${projectId}/items/${generationId}/tiles`, "PUT", { tiles });
      patchLocal([generationId], (g) => ({ ...g, tiles }));
    },
  };
}

export type GenerateBody = { input: Omit<CinemaGenerateInput, "brief">; folderId: string | null };

export function useCinemaGenerate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateBody) => send<{ items: Generation[]; plan: { notes: string[]; costUsd: number | null; outputs: number; modelId: string } }>(`/api/cinema/projects/${projectId}/generate`, "POST", body),
    onSuccess: (res, body) => {
      // New takes appear at once; polling takes over.
      qc.setQueryData<CinemaGeneration[]>(["cinema", projectId, "items"], (old) =>
        old ? [...res.items.map((g) => ({ ...g, folderId: body.folderId, take: { mode: body.input.mode, action: body.input.action, prompt: body.input.prompt, moves: body.input.moves } })), ...old] : old,
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
