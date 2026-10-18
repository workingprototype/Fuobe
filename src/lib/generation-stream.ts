/**
 * Live generation updates from GET /api/generations/stream (server-sent events), applied to the
 * React Query caches by id. Pure: the parser and the cache reducers are tested without a browser.
 *
 *   event: generation   data: <Generation JSON, as GET /api/generations returns it>
 *   event: deleted      data: {"id": "..."}
 *   : ping              (every 15 s)
 */
import { replaceEqualDeep } from "@tanstack/react-query";
import type { Generation } from "./catalog/types";
import { byNewest, matchesFilter, type FeedFilter } from "./library";

/** Lists are newest first; the Trash is most recently deleted first. */
const byDeleted = (a: Generation, b: Generation) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || byNewest(a, b);
const orderFor = (f: FeedFilter) => (f.trashed ? byDeleted : byNewest);

export type StreamEvent = { type: "generation"; generation: Generation } | { type: "deleted"; id: string };

/** Split an SSE byte stream (decoded) into events; returns what's left of an unfinished event. */
export function parseSse(buffer: string): { events: { event: string; data: string; id?: string }[]; rest: string } {
  const events: { event: string; data: string; id?: string }[] = [];
  const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    if (data.length) events.push({ event, data: data.join("\n"), ...(id !== undefined && { id }) });
  }
  return { events, rest };
}

/** An SSE message → a cache event (null for unknown or malformed ones). */
export function toStreamEvent(m: { event: string; data: string }): StreamEvent | null {
  try {
    const v = JSON.parse(m.data) as Record<string, unknown>;
    if (m.event === "deleted" && typeof v.id === "string") return { type: "deleted", id: v.id };
    if (m.event === "generation" && typeof v.id === "string" && typeof v.createdAt === "number" && v.request) return { type: "generation", generation: v as unknown as Generation };
  } catch {}
  return null;
}

/**
 * Apply one event to a cached list for `filter` (newest first, at most `limit` long). Unknown
 * generations are inserted when they match and fall inside the loaded window; ones that stop
 * matching (unfavorited on the Favorites tab, moved to the Trash) are removed. Returns the same
 * array when nothing changed, so React Query keeps every unchanged object (and memoized tile) as is.
 */
export function applyToList(list: Generation[] | undefined, filter: FeedFilter, ev: StreamEvent, opts: { window?: boolean } = {}): Generation[] | undefined {
  if (!list) return list;
  const id = ev.type === "deleted" ? ev.id : ev.generation.id;
  const at = list.findIndex((g) => g.id === id);
  if (ev.type === "deleted") return at < 0 ? list : list.filter((g) => g.id !== id);
  const g = ev.generation;
  const fits = matchesFilter(g, filter);
  if (at >= 0) {
    if (!fits) return list.filter((x) => x.id !== id);
    const old = list[at];
    if (old.updatedAt > g.updatedAt) return list; // a late event
    const next = list.slice();
    next[at] = g;
    return next;
  }
  if (!fits) return list;
  // Inside the loaded window only: an older item belongs to a page that isn't loaded yet.
  const oldest = list.at(-1);
  const full = list.length >= (filter.limit ?? 80);
  if ((opts.window ?? true) && full && oldest && orderFor(filter)(g, oldest) > 0) return list;
  const next = [...list, g].sort(orderFor(filter));
  return full ? next.slice(0, list.length) : next;
}

export interface Pages {
  pages: Generation[][];
  pageParams: unknown[];
}

/** Same for infinite (paged) lists: patch any page, insert into the page whose range holds it. */
export function applyToPages(data: Pages | undefined, filter: FeedFilter, ev: StreamEvent): Pages | undefined {
  if (!data?.pages.length) return data;
  const id = ev.type === "deleted" ? ev.id : ev.generation.id;
  const p = data.pages.findIndex((page) => page.some((g) => g.id === id));
  if (p >= 0) {
    const page = applyToList(data.pages[p], filter, ev, { window: false });
    if (page === data.pages[p]) return data;
    const pages = data.pages.slice();
    pages[p] = page!;
    return { ...data, pages };
  }
  if (ev.type === "deleted" || !matchesFilter(ev.generation, filter)) return data;
  const g = ev.generation;
  // A new one goes into the first page whose last item it sorts before (the first page, nearly always)…
  let target = data.pages.findIndex((page) => page.length > 0 && orderFor(filter)(g, page.at(-1)!) < 0);
  if (target < 0) {
    // …or after everything loaded, when the last page isn't full (there's nothing further to load).
    const last = data.pages.length - 1;
    if (data.pages[last].length >= (filter.limit ?? 60)) return data;
    target = last;
  }
  const pages = data.pages.slice();
  pages[target] = [...pages[target], g].sort(orderFor(filter));
  return { ...data, pages };
}

/** Assist threads hold their own generations: patch them by id (a thread never gains one from the stream). */
export function applyToThread<T extends { generations: Generation[] }>(view: T | undefined, ev: StreamEvent): T | undefined {
  if (!view) return view;
  const id = ev.type === "deleted" ? ev.id : ev.generation.id;
  const at = view.generations.findIndex((g) => g.id === id);
  if (at < 0) return view;
  if (ev.type === "deleted" || ev.generation.deletedAt) return { ...view, generations: view.generations.filter((g) => g.id !== id) };
  if (view.generations[at].updatedAt > ev.generation.updatedAt) return view;
  const generations = view.generations.slice();
  generations[at] = ev.generation;
  return { ...view, generations };
}

/**
 * Structural sharing by id for generation lists. React Query's default compares arrays index by
 * index, so one new result at the top (everything shifts by one) would hand every row a new
 * object and re-render the whole feed. Matching by id keeps every unchanged generation identical.
 */
export function shareById(prev: unknown, next: unknown): unknown {
  if (!Array.isArray(prev) || !Array.isArray(next)) return replaceEqualDeep(prev, next);
  const byId = new Map((prev as Generation[]).map((g) => [g.id, g]));
  let same = prev.length === next.length;
  const out = (next as Generation[]).map((g, i) => {
    const old = byId.get(g.id);
    const v = old ? (replaceEqualDeep(old, g) as Generation) : g;
    if (v !== prev[i]) same = false;
    return v;
  });
  return same ? prev : out;
}

/** The same for paged lists ({ pages, pageParams }), matching across pages. */
export function sharePagesById(prev: unknown, next: unknown): unknown {
  const p = prev as Pages | undefined;
  const n = next as Pages | undefined;
  if (!p?.pages || !n?.pages) return replaceEqualDeep(prev, next);
  const all = p.pages.flat();
  const pages = n.pages.map((page, i) => {
    const shared = shareById(all, page) as Generation[];
    const old = p.pages[i];
    return old && old.length === shared.length && shared.every((g, k) => g === old[k]) ? old : shared;
  });
  const samePages = pages.length === p.pages.length && pages.every((page, i) => page === p.pages[i]);
  const pageParams = replaceEqualDeep(p.pageParams, n.pageParams);
  return samePages && pageParams === p.pageParams ? p : { ...n, pages, pageParams };
}

/** Reconnect delays: 1 s, 2 s, 4 s … capped at 30 s (5 min once the endpoint said it doesn't exist). */
export function backoff(attempt: number, missing = false): number {
  return missing ? 300_000 : Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}
