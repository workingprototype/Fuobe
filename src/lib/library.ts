/**
 * Library (Assets) logic shared by the browser and the server: feed filters, folders, the Trash,
 * download names, date sections and batch stacks. Pure: no React, no database.
 */
import { OPERATION_LABELS, type Generation, type GenerationStatus, type MediaKind, type OutputFile } from "./catalog/types";

// ---------------------------------------------------------------------------
// Filters (GET /api/generations query ⇄ client-side matching for live cache updates)

export interface FeedFilter {
  kind?: MediaKind;
  kinds?: MediaKind[];
  features?: string[];
  favorites?: boolean;
  q?: string;
  limit?: number;
  models?: string[];
  statuses?: GenerationStatus[];
  /** createdAt range: since ≤ t < until. */
  since?: number;
  until?: number;
  folderId?: string;
  /** The Trash instead of the library. */
  trashed?: boolean;
}

/** The paging cursor for the page after `last`: its timestamp (deletedAt in the Trash) and id, so equal timestamps aren't skipped. */
export function cursorAfter(last: Generation, trashed?: boolean): string | undefined {
  const ts = trashed ? last.deletedAt : last.createdAt;
  return ts ? `${ts}:${last.id}` : undefined;
}

export function filterToSearch(f: FeedFilter, before?: string | number): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.kind) qs.set("kind", f.kind);
  if (f.kinds?.length) qs.set("kinds", f.kinds.join(","));
  if (f.features?.length) qs.set("features", f.features.join(","));
  if (f.favorites) qs.set("favorites", "1");
  if (f.q?.trim()) qs.set("q", f.q.trim());
  if (f.models?.length) qs.set("models", f.models.join(","));
  if (f.statuses?.length) qs.set("statuses", f.statuses.join(","));
  if (f.since) qs.set("since", String(f.since));
  if (f.until) qs.set("until", String(f.until));
  if (f.folderId) qs.set("folder", f.folderId);
  if (f.trashed) qs.set("trash", "1");
  if (before) qs.set("before", String(before));
  qs.set("limit", String(f.limit ?? 80));
  return qs;
}

const featureMatches = (feature: string, pattern: string) => (pattern.endsWith("*") ? feature.startsWith(pattern.slice(0, -1)) : feature === pattern);

/** Whether a generation belongs in a list with this filter (mirrors listGenerations). */
export function matchesFilter(g: Generation, f: FeedFilter): boolean {
  if (!!f.trashed !== !!g.deletedAt) return false;
  if (f.kind && g.kind !== f.kind) return false;
  if (f.kinds?.length && !f.kinds.includes(g.kind)) return false;
  if (f.features?.length && !f.features.some((p) => featureMatches(g.feature, p))) return false;
  if (f.favorites && !g.favorite) return false;
  if (f.models?.length && !f.models.includes(g.modelId)) return false;
  if (f.statuses?.length && !f.statuses.includes(g.status)) return false;
  if (f.since && g.createdAt < f.since) return false;
  if (f.until && g.createdAt >= f.until) return false;
  if (f.folderId && g.folderId !== f.folderId) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && !`${g.prompt ?? ""}\n${g.request.prompt ?? ""}`.toLowerCase().includes(q)) return false;
  return true;
}

const byIdDesc = (a: Generation, b: Generation) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Newest first, as the server orders lists (ties: id descending). */
export function byNewest(a: Generation, b: Generation): number {
  return b.createdAt - a.createdAt || byIdDesc(a, b);
}

/** The Trash's order: most recently deleted first (ties: id descending, like the server). */
export function byDeleted(a: Generation, b: Generation): number {
  return (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || byIdDesc(a, b);
}

// ---------------------------------------------------------------------------
// Folders

export interface Folder {
  id: string;
  name: string;
  color: string;
  count: number;
  /** The newest output in the folder, for its cover. */
  cover: OutputFile | null;
  createdAt: number;
  updatedAt: number;
}

/** Higgsfield's seven folder swatches, as oklch hues (lime is the default). */
export const FOLDER_COLORS = [
  { id: "lime", label: "Lime", hue: 125, chroma: 0.21 },
  { id: "cyan", label: "Cyan", hue: 205, chroma: 0.12 },
  { id: "slate", label: "Slate", hue: 255, chroma: 0.03 },
  { id: "violet", label: "Violet", hue: 290, chroma: 0.15 },
  { id: "purple", label: "Purple", hue: 310, chroma: 0.16 },
  { id: "pink", label: "Pink", hue: 350, chroma: 0.16 },
  { id: "yellow", label: "Yellow", hue: 95, chroma: 0.16 },
] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number]["id"];
export const DEFAULT_FOLDER_COLOR: FolderColor = "lime";

export function folderSwatch(color: string): string {
  const c = FOLDER_COLORS.find((x) => x.id === color) ?? FOLDER_COLORS[0];
  return `oklch(0.86 ${c.chroma} ${c.hue})`;
}

// ---------------------------------------------------------------------------
// Trash

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export function trashDaysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));
}

// ---------------------------------------------------------------------------
// Download names

const EXT_BY_KIND: Record<MediaKind, string> = { image: "png", video: "mp4", audio: "wav", text: "txt", model3d: "glb" };

export function extensionOf(o: Pick<OutputFile, "url" | "kind">): string {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(o.url.split("/").pop() ?? "");
  return m ? m[1].toLowerCase() : EXT_BY_KIND[o.kind];
}

export function downloadName(g: Pick<Generation, "id" | "prompt" | "modelId" | "request">, o: Pick<OutputFile, "url" | "kind">, i: number, ext = extensionOf(o)): string {
  const base = (g.request.prompt || g.prompt || g.modelId).slice(0, 40).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "fuobe";
  return `${base}-${g.id.slice(0, 6)}${i ? `-${i + 1}` : ""}.${ext}`;
}

export const downloadHref = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

// ---------------------------------------------------------------------------
// Split by date

export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now = Date.now()): string {
  const day = dayStart(ts);
  const today = dayStart(now);
  if (day === today) return "Today";
  if (day === dayStart(today - DAY / 2)) return "Yesterday";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function splitByDate<T>(items: T[], ts: (t: T) => number, now = Date.now()): { key: number; label: string; items: T[] }[] {
  const out: { key: number; label: string; items: T[] }[] = [];
  for (const it of items) {
    const key = dayStart(ts(it));
    const last = out.at(-1);
    if (last?.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(key, now), items: [it] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch stacks (storyboard + its film, multi-shot films, extend chains, pipelines, N takes)

export type LibraryEntry = { type: "single"; key: string; g: Generation } | { type: "stack"; key: string; title: string; label: string; items: Generation[] };

/** Storyboard films live in `${batchId}-film`: stack them with their board. */
export function stackKey(g: Pick<Generation, "batchId">): string | null {
  return g.batchId ? g.batchId.replace(/-film$/, "") : null;
}

/** The offline shot list wraps the story ("wide shot: <story> — beat 1 of 4"): unwrap it. */
function unwrapScene(scene: string): string {
  return /^[^:]{2,40}:\s*(.+?)\s+—\s+beat \d+ of \d+$/.exec(scene.trim())?.[1] ?? scene.trim();
}

/**
 * What the user asked for, never the internal chain prompt. Results made without words (transcribe,
 * image to 3D, upscale, trim…) are named by what was done: "Transcribe · Whisper".
 */
export function userTitle(g: Pick<Generation, "request" | "presetName" | "prompt" | "op" | "modelName">): string {
  const own = g.request.title?.trim();
  if (own) return own;
  if (g.request.frame) return unwrapScene(g.request.frame.scene);
  const words = g.request.prompt?.trim() || g.presetName || g.prompt?.trim();
  if (words && words !== g.op) return words;
  const what = OPERATION_LABELS[g.op];
  return what ? `${what}${g.modelName ? ` · ${g.modelName}` : ""}` : (g.modelName ?? "Untitled");
}

const order = (g: Generation) => g.request.step?.index ?? g.request.frame?.index ?? 0;

export function stackTitle(items: Generation[]): string {
  const titled = items.find((g) => g.request.title?.trim());
  if (titled) return userTitle(titled);
  // An Assist plan: its summary.
  const plan = items.find((g) => g.request.batchTitle?.trim())?.request.batchTitle?.trim();
  if (plan) return plan;
  const frames = items.filter((g) => g.request.frame).sort((a, b) => order(a) - order(b));
  if (frames.length) return unwrapScene(frames[0].request.frame!.scene);
  const film = items.find((g) => g.op === "concat" && g.prompt?.trim());
  if (film) return unwrapScene(film.prompt!);
  const first = [...items].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt)[0];
  return userTitle(first);
}

export function stackLabel(items: Generation[]): string {
  const frames = items.filter((g) => g.request.frame).length;
  const films = items.filter((g) => g.op === "concat" && g.request.step?.label?.startsWith("Film")).length;
  const shots = items.filter((g) => /^Shot \d+/.test(g.request.step?.label ?? "")).length;
  if (frames) return `Storyboard · ${frames} frame${frames === 1 ? "" : "s"}${films ? " + film" : ""}`;
  if (films && shots) return `Film · ${shots} shots`;
  if (items.some((g) => g.request.step)) return `${items.length} steps`;
  if (items.every((g) => g.request.prompt === items[0].request.prompt && g.modelId === items[0].modelId)) return `${items.length} takes`;
  return `${items.length} results`;
}

/** Group a newest-first list into cards: generations sharing a batch become one stack, placed where its newest member is. */
export function buildEntries(items: Generation[], opts: { stacks?: boolean } = {}): LibraryEntry[] {
  if (opts.stacks === false) return items.map((g) => ({ type: "single", key: g.id, g }));
  const groups = new Map<string, Generation[]>();
  for (const g of items) {
    const k = stackKey(g);
    if (k) groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const out: LibraryEntry[] = [];
  const placed = new Set<string>();
  for (const g of items) {
    const k = stackKey(g);
    const group = k ? groups.get(k)! : null;
    if (!k || !group || group.length < 2) {
      out.push({ type: "single", key: g.id, g });
      continue;
    }
    if (placed.has(k)) continue;
    placed.add(k);
    const sorted = [...group].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
    out.push({ type: "stack", key: `stack:${k}`, title: stackTitle(group), label: stackLabel(group), items: sorted });
  }
  return out;
}

/** The output a card shows: a film's video first, else the first finished output. */
export function coverOf(items: Generation[]): { g: Generation; o: OutputFile; index: number } | null {
  const done = items.filter((g) => g.status === "succeeded" && g.outputs.length);
  const film = done.find((g) => g.op === "concat");
  const g = film ?? done[0];
  return g ? { g, o: g.outputs[0], index: 0 } : null;
}
