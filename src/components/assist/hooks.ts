"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssistAvailability,
  AssistMemory,
  AssistModeChoice,
  AssistProject,
  AssistThread,
  AssistThreadSummary,
  AssistThreadView,
  MemoryCategory,
  MemoryScope,
  ProjectColor,
  ProjectSource,
  Skill,
  SkillSummary,
} from "@/lib/assist";
import type { Engine } from "@/lib/catalog/types";

/**
 * React Query hooks for Assist's skills, memory, projects and chat lists (/api/assist/**).
 * Thread transcripts stay under ["assist", id] (patched by the live generation stream in
 * lib/api.ts); the lists here use their own keys so that reducer never mistakes them for a thread.
 */

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status });
  return body;
}

const send = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

// ---------------------------------------------------------------------------
// Chats

export interface ChatList {
  threads: AssistThreadSummary[];
  agent: AssistThread["agent"];
  availability: AssistAvailability;
}

/** Chats, optionally one project's (or "none": chats outside projects), with a search. */
export function useChats(f: { project?: string | "none"; q?: string } = {}) {
  const sp = new URLSearchParams();
  if (f.project) sp.set("project", f.project);
  if (f.q?.trim()) sp.set("q", f.q.trim());
  return useQuery({
    queryKey: ["assist-chats", f.project ?? "all", f.q?.trim() ?? ""],
    queryFn: async () => json<ChatList>(await fetch(`/api/assist${sp.size ? `?${sp}` : ""}`)),
    staleTime: 5_000,
  });
}

export function useChatActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["assist-chats"] });
    void qc.invalidateQueries({ queryKey: ["assist"], exact: true });
    void qc.invalidateQueries({ queryKey: ["assist-projects"] });
    if (id) void qc.invalidateQueries({ queryKey: ["assist", id] });
  };
  return {
    start: async (body: { text: string; attachments?: string[]; engine: Engine; autoApprove: boolean; projectId?: string | null; mode?: AssistModeChoice }) => {
      const t = await send<AssistThread & { note?: string }>("/api/assist", "POST", body);
      qc.setQueryData<AssistThreadView>(["assist", t.id], { thread: t, generations: [] });
      refresh(t.id);
      return t;
    },
    patch: async (id: string, body: { autoApprove?: boolean; title?: string; projectId?: string | null; mode?: AssistModeChoice }) => {
      const t = await send<AssistThread>(`/api/assist/${id}`, "PATCH", body);
      qc.setQueryData<AssistThreadView>(["assist", id], (old) => (old ? { ...old, thread: t } : old));
      refresh(id);
      return t;
    },
    remove: async (id: string) => {
      await send(`/api/assist/${id}`, "DELETE");
      qc.removeQueries({ queryKey: ["assist", id] });
      refresh();
    },
  };
}

// ---------------------------------------------------------------------------
// Skills

export function useSkills() {
  return useQuery({
    queryKey: ["assist-skills"],
    queryFn: async () => (await json<{ items: SkillSummary[] }>(await fetch("/api/assist/skills"))).items,
    staleTime: 30_000,
  });
}

export function useSkill(name: string | null) {
  return useQuery({
    queryKey: ["assist-skills", name],
    enabled: !!name,
    queryFn: async () => json<Skill>(await fetch(`/api/assist/skills/${name}`)),
  });
}

export interface SkillForm {
  name: string;
  title: string;
  description: string;
  whenToUse?: string;
  body: string;
  icon?: string;
}

export function useSkillActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-skills"] });
  return {
    create: async (f: SkillForm) => {
      const s = await send<Skill>("/api/assist/skills", "POST", f);
      refresh();
      return s;
    },
    update: async (name: string, f: Partial<SkillForm>) => {
      const s = await send<Skill>(`/api/assist/skills/${name}`, "PATCH", f);
      refresh();
      return s;
    },
    toggle: async (name: string, enabled: boolean) => {
      // Optimistic: the switch moves at once.
      qc.setQueryData<SkillSummary[]>(["assist-skills"], (old) => old?.map((s) => (s.name === name ? { ...s, enabled } : s)));
      try {
        await send<Skill>(`/api/assist/skills/${name}`, "PATCH", { enabled });
      } finally {
        refresh();
      }
    },
    duplicate: async (name: string) => {
      const s = await send<Skill>(`/api/assist/skills/${name}/duplicate`, "POST");
      refresh();
      return s;
    },
    remove: async (name: string) => {
      await send(`/api/assist/skills/${name}`, "DELETE");
      refresh();
    },
    upload: async (file: File, replace = false) => {
      const form = new FormData();
      form.set("file", file);
      const r = await json<{ skill: Skill; skipped: string[]; replaced: boolean }>(await fetch(`/api/assist/skills/upload${replace ? "?replace=1" : ""}`, { method: "POST", body: form }));
      refresh();
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// Memory

export function useMemories(f: { scope: MemoryScope | "all"; projectId?: string | null }) {
  const sp = new URLSearchParams({ scope: f.scope });
  if (f.projectId) sp.set("project", f.projectId);
  return useQuery({
    queryKey: ["assist-memory", f.scope, f.projectId ?? null],
    queryFn: async () => (await json<{ items: AssistMemory[] }>(await fetch(`/api/assist/memory?${sp}`))).items,
  });
}

export function useMemoryActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-memory"] });
  return {
    add: async (m: { text: string; category: MemoryCategory; scope: MemoryScope; projectId?: string | null }) => {
      const r = await send<AssistMemory>("/api/assist/memory", "POST", m);
      refresh();
      return r;
    },
    update: async (id: string, patch: { text?: string; category?: MemoryCategory }) => {
      const r = await send<AssistMemory>(`/api/assist/memory/${id}`, "PATCH", patch);
      refresh();
      return r;
    },
    remove: async (id: string) => {
      await send(`/api/assist/memory/${id}`, "DELETE");
      refresh();
    },
    importItems: async (body: { items: { text: string; category: MemoryCategory }[]; scope: MemoryScope; projectId?: string | null }) => {
      const r = await send<{ added: number; skipped: number }>("/api/assist/memory/import", "POST", body);
      refresh();
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// Projects

export function useProjects() {
  return useQuery({
    queryKey: ["assist-projects"],
    queryFn: async () => (await json<{ items: AssistProject[] }>(await fetch("/api/assist/projects"))).items,
    staleTime: 10_000,
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["assist-projects", id],
    enabled: !!id,
    queryFn: async () => json<AssistProject>(await fetch(`/api/assist/projects/${id}`)),
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 1,
  });
}

export interface ProjectForm {
  name?: string;
  color?: ProjectColor;
  instructions?: string;
  skills?: string[];
  usePersonalMemory?: boolean;
}

export type SourceForm = { kind: "link"; url: string } | { kind: "element"; elementId: string } | { kind: "text"; title?: string; text: string };

export function useProjectActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["assist-projects"] });
    if (id) void qc.invalidateQueries({ queryKey: ["assist-projects", id] });
  };
  return {
    create: async (f: ProjectForm) => {
      const p = await send<AssistProject>("/api/assist/projects", "POST", f);
      refresh();
      return p;
    },
    update: async (id: string, f: ProjectForm) => {
      const p = await send<AssistProject>(`/api/assist/projects/${id}`, "PATCH", f);
      qc.setQueryData(["assist-projects", id], p);
      refresh(id);
      return p;
    },
    remove: async (id: string) => {
      await send(`/api/assist/projects/${id}`, "DELETE");
      qc.removeQueries({ queryKey: ["assist-projects", id] });
      refresh();
      void qc.invalidateQueries({ queryKey: ["assist-chats"] });
    },
    addSource: async (id: string, s: SourceForm) => {
      const r = await send<ProjectSource>(`/api/assist/projects/${id}/sources`, "POST", s);
      refresh(id);
      return r;
    },
    addFile: async (id: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      const r = await json<ProjectSource>(await fetch(`/api/assist/projects/${id}/sources`, { method: "POST", body: form }));
      refresh(id);
      return r;
    },
    refreshSource: async (id: string, sourceId: string) => {
      const r = await send<ProjectSource>(`/api/assist/projects/${id}/sources/${sourceId}/refresh`, "POST");
      refresh(id);
      return r;
    },
    removeSource: async (id: string, sourceId: string) => {
      await send(`/api/assist/projects/${id}/sources/${sourceId}`, "DELETE");
      refresh(id);
    },
  };
}
