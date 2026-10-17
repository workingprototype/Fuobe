"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AssistThread, AssistThreadSummary, AssistThreadView } from "./assist";
import type { ElementKind, StudioElement } from "./catalog/elements";
import type { Engine, Generation, GenerationRequest, MediaKind } from "./catalog/types";
import { applyToList, applyToPages, applyToThread, backoff, parseSse, toStreamEvent, type Pages, type StreamEvent } from "./generation-stream";
import { filterToSearch, type FeedFilter, type Folder } from "./library";

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
//
// Lists live under ["generations", filter] (studio feeds, home) and ["library", filter] (the
// Library's paged lists); Assist threads hold theirs in ["assist", id]. Every change (the live
// stream, the user's own actions) goes through applyEvent(), which patches all of them by id.

export type { FeedFilter } from "./library";

const isActive = (g: Generation) => g.status === "queued" || g.status === "running";
/** Poll while something renders: fast without the live stream, a slow safety net with it. */
const pollEvery = (items: Generation[] | undefined, live: boolean) => (items?.some(isActive) ? (live ? 10_000 : 1500) : false);

/** Apply one change to every cached list and thread, skipping caches it doesn't change. */
function applyEvent(qc: QueryClient, ev: StreamEvent): void {
  for (const q of qc.getQueryCache().findAll({ queryKey: ["generations"] })) {
    const data = q.state.data as Generation[] | undefined;
    const next = applyToList(data, (q.queryKey[1] ?? {}) as FeedFilter, ev);
    if (next !== data) qc.setQueryData(q.queryKey, next);
  }
  for (const q of qc.getQueryCache().findAll({ queryKey: ["library"] })) {
    if (q.queryKey.length !== 2 || typeof q.queryKey[1] !== "object") continue;
    const data = q.state.data as Pages | undefined;
    const next = applyToPages(data, q.queryKey[1] as FeedFilter, ev);
    if (next !== data) qc.setQueryData(q.queryKey, next);
  }
  for (const q of qc.getQueryCache().findAll({ queryKey: ["assist"] })) {
    if (typeof q.queryKey[1] !== "string") continue;
    const data = q.state.data as AssistThreadView | undefined;
    const next = applyToThread(data, ev);
    if (next !== data) qc.setQueryData(q.queryKey, next);
  }
}

/** The freshest copy of a generation in any cache (a viewer may hold an older object). */
function cached(qc: QueryClient, id: string): Generation | undefined {
  let best: Generation | undefined;
  const consider = (g: Generation | undefined) => {
    if (g?.id === id && (!best || g.updatedAt >= best.updatedAt)) best = g;
  };
  for (const q of qc.getQueryCache().findAll({ queryKey: ["generations"] })) (q.state.data as Generation[] | undefined)?.forEach(consider);
  for (const q of qc.getQueryCache().findAll({ queryKey: ["library"] })) (q.state.data as Pages | undefined)?.pages?.forEach((p) => p.forEach(consider));
  for (const q of qc.getQueryCache().findAll({ queryKey: ["assist"] })) (q.state.data as AssistThreadView | undefined)?.generations?.forEach(consider);
  return best;
}

const patched = (g: Generation, patch: Partial<Generation>): Generation => ({ ...g, ...patch, updatedAt: Math.max(Date.now(), g.updatedAt + 1) });

// --- Live updates (GET /api/generations/stream, built by the runtime) -------------------------

const live = {
  connected: false,
  everConnected: false,
  subscribers: 0,
  listeners: new Set<() => void>(),
  abort: null as AbortController | null,
  timer: null as ReturnType<typeof setTimeout> | null,
  attempt: 0,
  client: null as QueryClient | null,
};

function setLive(v: boolean) {
  if (live.connected === v) return;
  live.connected = v;
  live.listeners.forEach((l) => l());
}

function scheduleReconnect(missing: boolean) {
  setLive(false);
  live.abort = null;
  if (!live.subscribers) return;
  live.timer = setTimeout(connect, backoff(live.attempt++, missing));
}

async function connect() {
  live.timer = null;
  if (live.abort || !live.subscribers || !live.client) return;
  const ctrl = new AbortController();
  live.abort = ctrl;
  try {
    const res = await fetch("/api/generations/stream", { headers: { Accept: "text/event-stream" }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
      // No stream on this server (yet): keep polling, look again in a few minutes.
      return scheduleReconnect(res.status === 404 || res.ok);
    }
    live.attempt = 0;
    setLive(true);
    // Back after a drop: catch up on whatever changed while we were away.
    if (live.everConnected) {
      void live.client.invalidateQueries({ queryKey: ["generations"] });
      void live.client.invalidateQueries({ queryKey: ["library"] });
    }
    live.everConnected = true;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseSse(buf + value);
      buf = parsed.rest;
      for (const m of parsed.events) {
        const ev = toStreamEvent(m);
        if (ev && live.client) applyEvent(live.client, ev);
      }
    }
  } catch {
    if (ctrl.signal.aborted) return;
  }
  if (live.abort === ctrl) scheduleReconnect(false);
}

/** Share one stream between every list on the page; returns whether it's connected. */
function useGenerationStream(): boolean {
  const qc = useQueryClient();
  useEffect(() => {
    live.client = qc;
    live.subscribers++;
    if (!live.abort && !live.timer) void connect();
    return () => {
      live.subscribers--;
      if (live.subscribers) return;
      // Keep it through quick remounts (route changes); drop it when nothing shows generations.
      setTimeout(() => {
        if (live.subscribers) return;
        live.abort?.abort();
        live.abort = null;
        if (live.timer) clearTimeout(live.timer);
        live.timer = null;
        setLive(false);
      }, 5000);
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

// --- Lists ----------------------------------------------------------------------------------

function feedKey(f: FeedFilter) {
  return ["generations", f] as const;
}

export function useGenerations(filter: FeedFilter, opts: { keepPrevious?: boolean } = {}) {
  const connected = useGenerationStream();
  return useQuery({
    queryKey: feedKey(filter),
    queryFn: async () => (await json<{ items: Generation[] }>(await fetch(`/api/generations?${filterToSearch(filter)}`))).items,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    refetchInterval: (q) => pollEvery(q.state.data, connected),
  });
}

export const LIBRARY_PAGE = 60;

/** The Library's paged list ("Load more" pages back with the before cursor). */
export function useLibrary(filter: FeedFilter) {
  const connected = useGenerationStream();
  const f = { ...filter, limit: filter.limit ?? LIBRARY_PAGE };
  return useInfiniteQuery({
    queryKey: ["library", f] as const,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      (await json<{ items: Generation[] }>(await fetch(`/api/generations${f.trashed ? "/trash" : ""}?${filterToSearch(f, pageParam)}`))).items,
    getNextPageParam: (last) => {
      if (last.length < f.limit) return undefined;
      const tail = last.at(-1)!;
      return f.trashed ? (tail.deletedAt ?? undefined) : tail.createdAt;
    },
    placeholderData: keepPreviousData,
    refetchInterval: (q) => pollEvery(q.state.data?.pages.flat(), connected),
  });
}

export interface LibraryFacets {
  models: { id: string; name: string; count: number }[];
  kinds: Partial<Record<MediaKind, number>>;
  total: number;
  favorites: number;
  failed: number;
  trash: number;
}

export function useLibraryFacets() {
  return useQuery({
    queryKey: ["library-facets"],
    queryFn: async () => json<LibraryFacets>(await fetch("/api/generations/facets")),
    staleTime: 15_000,
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
      // Show new cards instantly in the feeds they belong to (newest first, like the server), then let polling take over.
      for (const g of items) applyEvent(qc, { type: "generation", generation: { ...g, deletedAt: null } });
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["library-facets"] });
    },
  });
}

export type BulkAction = "trash" | "restore" | "delete" | "favorite" | "unfavorite" | "move";

async function bulkRequest(action: BulkAction, ids: string[], folderId?: string | null): Promise<number> {
  return (
    await json<{ count: number }>(
      await fetch("/api/generations/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, folderId }) }),
    )
  ).count;
}

/** Stable result actions (one object per QueryClient), so memoized tiles don't re-render. */
export function useGenerationActions() {
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["library-facets"] });
      void qc.invalidateQueries({ queryKey: ["folders"] });
    };
    const local = (gs: Generation[], patch: Partial<Generation> | null) => {
      for (const g of gs) {
        const cur = cached(qc, g.id) ?? g;
        applyEvent(qc, patch ? { type: "generation", generation: patched(cur, patch) } : { type: "deleted", id: g.id });
      }
    };
    /** Optimistic, then the server; on failure the caches are refetched and the error shown. */
    const run = async (gs: Generation[], patch: Partial<Generation> | null, action: BulkAction, folderId?: string | null) => {
      if (!gs.length) return 0;
      local(gs, patch);
      try {
        return await bulkRequest(action, gs.map((g) => g.id), folderId);
      } catch (e) {
        toast.error((e as Error).message);
        return 0;
      } finally {
        refresh();
      }
    };
    const restore = (gs: Generation[]) => run(gs, { deletedAt: null }, "restore");
    const trash = (gs: Generation[], what?: string) => {
      const p = run(gs, { deletedAt: Date.now() }, "trash");
      toast(what ?? (gs.length === 1 ? "Moved to Trash" : `${gs.length} moved to Trash`), {
        id: "trash-undo",
        duration: 6000,
        action: { label: "Undo", onClick: () => void p.then(() => restore(gs)) },
      });
      return p;
    };
    return {
      /** Toggle (or set) a favorite from the freshest cached copy, so a stale viewer object can't send the wrong value. */
      favorite: async (g: Generation, value?: boolean) => {
        const cur = cached(qc, g.id) ?? g;
        const next = value ?? !cur.favorite;
        local([cur], { favorite: next });
        const res = await fetch(`/api/generations/${g.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorite: next }) });
        if (!res.ok) refresh();
      },
      favoriteMany: (gs: Generation[], value: boolean) => run(gs, { favorite: value }, value ? "favorite" : "unfavorite"),
      /** Move to the Trash quietly (callers that announce it themselves). */
      remove: (g: Generation) => run([g], { deletedAt: Date.now() }, "trash"),
      /** Move to the Trash with an Undo toast. */
      trash,
      restore,
      deleteForever: (gs: Generation[]) => run(gs, null, "delete"),
      emptyTrash: async () => {
        await fetch("/api/generations/trash", { method: "DELETE" });
        refresh();
      },
      move: (gs: Generation[], folderId: string | null) => run(gs, { folderId }, "move", folderId),
      cancel: async (g: Generation) => {
        local([g], { status: "canceled" });
        await fetch(`/api/generations/${g.id}/cancel`, { method: "POST" });
        refresh();
      },
    };
  }, [qc]);
}

/** Files you uploaded (the Library's Uploads tab), newest first. */
export function useUploads(kind?: MediaKind) {
  return useQuery({
    queryKey: ["assets", "upload", kind, 200],
    queryFn: async () => {
      const qs = new URLSearchParams({ source: "upload", limit: "200" });
      if (kind) qs.set("kind", kind);
      return (await json<{ items: Asset[] }>(await fetch(`/api/assets?${qs}`))).items;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Library folders

export function useFolders() {
  return useQuery({
    queryKey: ["folders"],
    queryFn: async () => (await json<{ items: Folder[] }>(await fetch("/api/folders"))).items,
    staleTime: 10_000,
  });
}

export function useFolderActions() {
  const qc = useQueryClient();
  return useMemo(() => {
    const send = async <T,>(url: string, method: string, body?: unknown) => {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const out = res.status === 204 ? (undefined as T) : await json<T>(res);
      void qc.invalidateQueries({ queryKey: ["folders"] });
      return out;
    };
    return {
      create: (body: { name: string; color?: string }) => send<Folder>("/api/folders", "POST", body),
      update: (id: string, body: { name?: string; color?: string }) => send<Folder>(`/api/folders/${id}`, "PATCH", body),
      remove: async (id: string) => {
        await send<void>(`/api/folders/${id}`, "DELETE");
        void qc.invalidateQueries({ queryKey: ["library"] });
        void qc.invalidateQueries({ queryKey: ["generations"] });
      },
    };
  }, [qc]);
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
// Elements (@characters, locations, props, styles)

export function useElements() {
  return useQuery({
    queryKey: ["elements"],
    queryFn: async () => (await json<{ items: StudioElement[] }>(await fetch("/api/elements"))).items,
    staleTime: 10_000,
  });
}

export function useElement(id: string) {
  return useQuery({
    queryKey: ["elements", id],
    queryFn: async () => json<StudioElement>(await fetch(`/api/elements/${id}`)),
    // Pick up the trained identity as soon as a training job finishes.
    refetchInterval: (q) => (q.state.data?.status === "training" ? 3000 : false),
  });
}

export function useSaveElement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id?: string; name: string; kind?: ElementKind; description?: string | null; references: string[] }) => {
      const { id, ...rest } = body;
      return json<StudioElement>(
        await fetch(id ? `/api/elements/${id}` : "/api/elements", {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rest),
        }),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["elements"] }),
  });
}

export function useDeleteElement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/elements/${id}`, { method: "DELETE" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["elements"] }),
  });
}

// ---------------------------------------------------------------------------
// Provider status

export type EngineMode = "both" | "open" | "cloud";

export interface StatusInfo {
  providers: Record<string, { label: string; configured: boolean }>;
  demoMode: string;
  engineMode: EngineMode;
  cloudProvider: string;
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
// Settings → Engine mode can lock the install to one engine; then the toggle is disabled.

const ENGINE_KEY = "fuobe.engine";
const MODE_KEY = "fuobe.engineMode";
const listeners = new Set<() => void>();

function readEngine(): Engine {
  try {
    return localStorage.getItem(ENGINE_KEY) === "open" ? "open" : "cloud";
  } catch {
    return "cloud";
  }
}

function readCachedMode(): EngineMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "open" || m === "cloud" ? m : "both";
  } catch {
    return "both";
  }
}

const noopSubscribe = () => () => {};

/** false while hydrating (matches the server HTML), true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** The install's engine mode (from the server, cached locally so pages don't flash). */
export function useEngineMode(): EngineMode {
  const hydrated = useHydrated();
  const status = useStatus().data;
  const cached = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readCachedMode,
    () => "both" as EngineMode,
  );
  const serverMode = status?.engineMode;
  useEffect(() => {
    if (!serverMode || serverMode === readCachedMode()) return;
    try {
      localStorage.setItem(MODE_KEY, serverMode);
    } catch {}
    listeners.forEach((l) => l());
  }, [serverMode]);
  // Suspense subtrees can hydrate after the status query resolved; render the server's view until hydrated.
  if (!hydrated) return "both";
  return serverMode ?? cached;
}

export function useEngine(): [Engine, (e: Engine) => void, EngineMode] {
  const mode = useEngineMode();
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
  const set = useCallback(
    (e: Engine) => {
      if (mode !== "both") return;
      try {
        localStorage.setItem(ENGINE_KEY, e);
      } catch {}
      listeners.forEach((l) => l());
    },
    [mode],
  );
  return [mode === "both" ? engine : mode, set, mode];
}

// ---------------------------------------------------------------------------
// Assist

export function useAssistThreads() {
  return useQuery({
    queryKey: ["assist"],
    queryFn: async () => json<{ threads: AssistThreadSummary[]; agent: AssistThread["agent"] }>(await fetch("/api/assist")),
  });
}

export function useAssistThread(id: string | null) {
  return useQuery({
    queryKey: ["assist", id],
    enabled: !!id,
    queryFn: async () => json<AssistThreadView>(await fetch(`/api/assist/${id}`)),
    // Fast while the agent works, slower while generations render, idle otherwise.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.thread.status === "running") return 900;
      return d.generations.some((g) => g.status === "queued" || g.status === "running") ? 1500 : false;
    },
  });
}

export function useAssistActions() {
  const qc = useQueryClient();
  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["assist", id] });
    void qc.invalidateQueries({ queryKey: ["assist"], exact: true });
  };
  const post = async <T,>(url: string, body: unknown, method = "POST") =>
    json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return {
    start: async (body: { text: string; attachments?: string[]; engine: Engine; autoApprove: boolean }) => {
      const t = await post<AssistThread>("/api/assist", body);
      qc.setQueryData<AssistThreadView>(["assist", t.id], { thread: t, generations: [] });
      refresh(t.id);
      return t;
    },
    send: async (id: string, body: { text: string; attachments?: string[] }) => {
      const t = await post<AssistThread>(`/api/assist/${id}/messages`, body);
      qc.setQueryData<AssistThreadView>(["assist", id], (old) => ({ thread: t, generations: old?.generations ?? [] }));
      refresh(id);
    },
    answer: async (id: string, approve: boolean) => {
      const t = await post<AssistThread>(`/api/assist/${id}/approval`, { approve });
      qc.setQueryData<AssistThreadView>(["assist", id], (old) => ({ thread: t, generations: old?.generations ?? [] }));
      refresh(id);
    },
    setAutoApprove: async (id: string, autoApprove: boolean) => {
      await post(`/api/assist/${id}`, { autoApprove }, "PATCH");
      refresh(id);
    },
    remove: async (id: string) => {
      await fetch(`/api/assist/${id}`, { method: "DELETE" });
      qc.removeQueries({ queryKey: ["assist", id] });
      void qc.invalidateQueries({ queryKey: ["assist"], exact: true });
    },
  };
}
