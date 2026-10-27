"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useHydrated } from "@/lib/api";
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
import type { ConnectorView } from "@/lib/assist-connectors";
import type { ScheduleRule, ScheduleView } from "@/lib/assist-schedule";
import type { Engine, Generation } from "@/lib/catalog/types";

/** A rule as the dialog sends it: the server sets when "every N hours" starts counting. */
export type ScheduleRuleInput = ScheduleRule extends infer R ? (R extends { kind: "hours" } ? Omit<R, "from"> : R) : never;

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

/**
 * Until the page has hydrated, a query reads as loading: the first client render then matches the
 * server's HTML even when another Suspense boundary already filled the cache with the same key.
 */
function useHydrationSafe<T extends UseQueryResult<unknown, Error>>(q: T): T {
  const hydrated = useHydrated();
  if (hydrated) return q;
  return { ...q, data: undefined, error: null, status: "pending", isPending: true, isLoading: true, isFetching: true, isSuccess: false, isError: false, fetchStatus: "fetching" } as T;
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
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-chats", f.project ?? "all", f.q?.trim() ?? ""],
      queryFn: async () => json<ChatList>(await fetch(`/api/assist${sp.size ? `?${sp}` : ""}`)),
      staleTime: 5_000,
    }),
  );
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
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-skills"],
      queryFn: async () => (await json<{ items: SkillSummary[] }>(await fetch("/api/assist/skills"))).items,
      staleTime: 30_000,
    }),
  );
}

export function useSkill(name: string | null) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-skills", name],
      enabled: !!name,
      queryFn: async () => json<Skill>(await fetch(`/api/assist/skills/${name}`)),
    }),
  );
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
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-memory", f.scope, f.projectId ?? null],
      queryFn: async () => (await json<{ items: AssistMemory[] }>(await fetch(`/api/assist/memory?${sp}`))).items,
    }),
  );
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
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects"],
      queryFn: async () => (await json<{ items: AssistProject[] }>(await fetch("/api/assist/projects"))).items,
      staleTime: 10_000,
    }),
  );
}

export function useProject(id: string | null) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects", id],
      enabled: !!id,
      queryFn: async () => json<AssistProject>(await fetch(`/api/assist/projects/${id}`)),
      retry: (n, e) => (e as { status?: number }).status !== 404 && n < 1,
    }),
  );
}

export interface ProjectAsset {
  generation: Generation;
  chatId: string;
  chatTitle: string;
}

/** What a project's chats made (the Assets tab), refreshed when the tab is opened again. */
export function useProjectAssets(id: string, enabled = true) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects", id, "assets"],
      enabled,
      queryFn: async () => (await json<{ items: ProjectAsset[] }>(await fetch(`/api/assist/projects/${id}/assets`))).items,
      staleTime: 10_000,
    }),
  );
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

// ---------------------------------------------------------------------------
// Scheduled tasks

export interface ScheduleForm {
  title: string;
  prompt: string;
  attachments?: string[];
  projectId?: string | null;
  rule: ScheduleRuleInput;
  tz: string;
  approval: "ask" | "auto";
  capUsd?: number | null;
  engine: Engine;
  mode?: AssistModeChoice | null;
  paused?: boolean;
}

/** Tasks, all or one project's; refreshed every 30 s so "next run" and the last result stay current. */
export function useSchedules(projectId?: string) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-schedules", projectId ?? "all"],
      queryFn: async () => (await json<{ items: ScheduleView[] }>(await fetch(`/api/assist/schedules${projectId ? `?project=${projectId}` : ""}`))).items,
      refetchInterval: 30_000,
    }),
  );
}

export function useScheduleActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["assist-schedules"] });
    void qc.invalidateQueries({ queryKey: ["assist-chats"] });
  };
  return {
    create: async (f: ScheduleForm) => {
      const s = await send<ScheduleView>("/api/assist/schedules", "POST", f);
      refresh();
      return s;
    },
    update: async (id: string, f: Partial<ScheduleForm>) => {
      const s = await send<ScheduleView>(`/api/assist/schedules/${id}`, "PATCH", f);
      refresh();
      return s;
    },
    remove: async (id: string) => {
      await send(`/api/assist/schedules/${id}`, "DELETE");
      refresh();
    },
    runNow: async (id: string) => {
      const r = await fetch(`/api/assist/schedules/${id}/run`, { method: "POST" });
      const body = (await r.json().catch(() => ({}))) as { threadId?: string | null; error?: string };
      if (!r.ok && r.status !== 409) throw new Error(body.error ?? `Request failed (${r.status})`);
      refresh();
      return body.threadId ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Custom MCP connectors (Settings → Assist connectors)

export function useConnectors() {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-connectors"],
      queryFn: async () => (await json<{ items: ConnectorView[] }>(await fetch("/api/assist/connectors"))).items,
    }),
  );
}

export function useConnectorActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-connectors"] });
  return {
    create: async (f: { name: string; url: string; token?: string }) => {
      const c = await send<ConnectorView>("/api/assist/connectors", "POST", f);
      refresh();
      return c;
    },
    update: async (id: string, f: { name?: string; url?: string; token?: string; enabled?: boolean }) => {
      // Optimistic for the on / off switch.
      if (f.enabled !== undefined) qc.setQueryData<ConnectorView[]>(["assist-connectors"], (old) => old?.map((c) => (c.id === id ? { ...c, enabled: f.enabled! } : c)));
      try {
        return await send<ConnectorView>(`/api/assist/connectors/${id}`, "PATCH", f);
      } finally {
        refresh();
      }
    },
    remove: async (id: string) => {
      await send(`/api/assist/connectors/${id}`, "DELETE");
      refresh();
    },
  };
}
