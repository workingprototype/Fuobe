import "server-only";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import type { MediaKind, OutputFile } from "@/lib/catalog/types";
import { DEFAULT_FOLDER_COLOR, downloadName, FOLDER_COLORS, TRASH_DAYS, type Folder } from "@/lib/library";
import { db } from "./db";
import { cancelGeneration, deleteGeneration, getGeneration, type ListOptions } from "./generations";
import { absolutePath } from "./storage";
import type { ZipEntry } from "./zip";

/**
 * The Assets library on top of generations: the Trash (soft delete, kept 30 days), folders,
 * bulk actions and zip downloads. Every generation reader leaves trashed rows out
 * (listGenerations / getGeneration join generation_trash).
 */

const DAY = 86_400_000;
const MAX_IDS = 500;

const STATUSES = new Set(["queued", "running", "succeeded", "failed", "canceled"]);
const KINDS = new Set(["image", "video", "audio", "text", "model3d"]);

/** `before=<ts>` or `before=<ts>:<id>` (the last row of the previous page) → the paging cursor. */
export function cursorFrom(v: string | null): Pick<ListOptions, "before" | "beforeId"> {
  const m = /^(\d+)(?::([\w-]{1,40}))?$/.exec(v?.trim() ?? "");
  if (!m || !Number(m[1])) return {};
  return { before: Number(m[1]), ...(m[2] && { beforeId: m[2] }) };
}

/** GET /api/generations query → listGenerations options (unknown values are ignored). */
export function listOptionsFrom(sp: URLSearchParams): ListOptions {
  const list = (k: string) => sp.get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const num = (k: string) => {
    const v = Number(sp.get(k));
    return sp.get(k) && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    feature: sp.get("feature") ?? undefined,
    features: list("features"),
    kind: sp.get("kind") && KINDS.has(sp.get("kind")!) ? sp.get("kind")! : undefined,
    kinds: list("kinds")?.filter((k) => KINDS.has(k)),
    models: list("models"),
    favorites: sp.get("favorites") === "1",
    status: sp.get("status") ?? undefined,
    statuses: list("statuses")?.filter((s) => STATUSES.has(s)),
    folderId: sp.get("folder") ?? undefined,
    trashed: sp.get("trash") === "1",
    q: sp.get("q") ?? undefined,
    ...cursorFrom(sp.get("before")),
    since: num("since"),
    until: num("until"),
    limit: num("limit"),
    batchId: sp.get("batch") ?? undefined,
  };
}

const ids = (list: string[]) => [...new Set(list)].slice(0, MAX_IDS);
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

function existing(list: string[]): string[] {
  if (!list.length) return [];
  return (db().prepare(`SELECT id FROM generations WHERE id IN (${placeholders(list.length)})`).all(...list) as { id: string }[]).map((r) => r.id);
}

/** Touch rows so anything watching updated_at (the live stream) sees the change. */
function touch(list: string[]): void {
  if (list.length) db().prepare(`UPDATE generations SET updated_at = ? WHERE id IN (${placeholders(list.length)})`).run(Date.now(), ...list);
}

// ---------------------------------------------------------------------------
// Trash

/**
 * Move to the Trash. Jobs still queued or rendering are canceled (in the background), so a deleted
 * job doesn't keep running and billing out of sight; Restore brings them back as canceled, with Retry.
 */
export function trashGenerations(list: string[], now = Date.now()): number {
  const found = existing(ids(list));
  const insert = db().prepare("INSERT OR IGNORE INTO generation_trash (generation_id, deleted_at) VALUES (?, ?)");
  let n = 0;
  db().transaction(() => {
    for (const id of found) n += insert.run(id, now).changes;
    touch(found);
  })();
  for (const id of activeIds(found)) void cancelGeneration(id).catch(() => {});
  return n;
}

/** The ones among `list` still queued or rendering. */
function activeIds(list: string[]): string[] {
  if (!list.length) return [];
  return (db().prepare(`SELECT id FROM generations WHERE status IN ('queued', 'running') AND id IN (${placeholders(list.length)})`).all(...list) as { id: string }[]).map((r) => r.id);
}

export function restoreGenerations(list: string[]): number {
  const found = ids(list);
  if (!found.length) return 0;
  let n = 0;
  db().transaction(() => {
    n = db().prepare(`DELETE FROM generation_trash WHERE generation_id IN (${placeholders(found.length)})`).run(...found).changes;
    // A folder deleted meanwhile no longer holds it: it comes back to the library root.
    db().prepare(`DELETE FROM folder_items WHERE generation_id IN (${placeholders(found.length)}) AND folder_id NOT IN (SELECT id FROM folders)`).run(...found);
    touch(found);
  })();
  return n;
}

/** Delete for good; jobs still running are canceled first. */
export async function deleteForever(list: string[]): Promise<number> {
  const found = existing(ids(list));
  const active = new Set(activeIds(found));
  for (const id of found) {
    if (active.has(id)) await cancelGeneration(id).catch(() => {});
    deleteGeneration(id);
  }
  return found.length;
}

export function trashedIds(before?: number): string[] {
  const rows = before
    ? db().prepare("SELECT generation_id FROM generation_trash WHERE deleted_at < ?").all(before)
    : db().prepare("SELECT generation_id FROM generation_trash").all();
  return (rows as { generation_id: string }[]).map((r) => r.generation_id);
}

export async function emptyTrash(): Promise<number> {
  let n = 0;
  for (let batch = trashedIds().slice(0, MAX_IDS); batch.length; batch = trashedIds().slice(0, MAX_IDS)) {
    const done = await deleteForever(batch);
    // Ids whose generation row is already gone: drop the dangling trash entries.
    db().prepare(`DELETE FROM generation_trash WHERE generation_id IN (${placeholders(batch.length)})`).run(...batch);
    n += done;
  }
  return n;
}

/** Delete what has been in the Trash for more than 30 days. */
export async function purgeTrash(now = Date.now()): Promise<number> {
  const old = trashedIds(now - TRASH_DAYS * DAY);
  let n = 0;
  for (let i = 0; i < old.length; i += MAX_IDS) n += await deleteForever(old.slice(i, i + MAX_IDS));
  if (old.length) db().prepare("DELETE FROM generation_trash WHERE deleted_at < ?").run(now - TRASH_DAYS * DAY);
  return n;
}

declare global {
  var __fuobeTrashPurge: { timer: NodeJS.Timeout } | undefined;
}

/** Purge once at startup (the first library read) and then daily. */
export function ensureTrashPurge(): void {
  if (globalThis.__fuobeTrashPurge) return;
  const run = () => void purgeTrash().catch((e) => console.warn(`[fuobe] trash purge failed: ${(e as Error).message}`));
  const timer = setInterval(run, DAY);
  timer.unref?.();
  globalThis.__fuobeTrashPurge = { timer };
  run();
}

export function trashCount(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM generation_trash t JOIN generations g ON g.id = t.generation_id").get() as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Favorites, folders

export function setFavorites(list: string[], favorite: boolean): number {
  const found = ids(list);
  if (!found.length) return 0;
  return db().prepare(`UPDATE generations SET favorite = ?, updated_at = ? WHERE id IN (${placeholders(found.length)})`).run(favorite ? 1 : 0, Date.now(), ...found).changes;
}

interface FolderRow {
  id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
  count: number;
  cover_json: string | null;
}

const toFolder = (r: FolderRow): Folder => {
  const outputs = r.cover_json ? (JSON.parse(r.cover_json) as OutputFile[]) : [];
  return { id: r.id, name: r.name, color: r.color, count: r.count, cover: outputs[0] ?? null, createdAt: r.created_at, updatedAt: r.updated_at };
};

const FOLDER_SELECT = `SELECT f.*,
  (SELECT COUNT(*) FROM folder_items i JOIN generations g ON g.id = i.generation_id LEFT JOIN generation_trash t ON t.generation_id = g.id
    WHERE i.folder_id = f.id AND t.generation_id IS NULL) AS count,
  (SELECT g.outputs_json FROM folder_items i JOIN generations g ON g.id = i.generation_id LEFT JOIN generation_trash t ON t.generation_id = g.id
    WHERE i.folder_id = f.id AND t.generation_id IS NULL AND g.status = 'succeeded' AND g.outputs_json != '[]' ORDER BY g.created_at DESC LIMIT 1) AS cover_json
  FROM folders f`;

export function listFolders(): Folder[] {
  return (db().prepare(`${FOLDER_SELECT} ORDER BY f.created_at ASC`).all() as FolderRow[]).map(toFolder);
}

export function getFolder(id: string): Folder | null {
  const r = db().prepare(`${FOLDER_SELECT} WHERE f.id = ?`).get(id) as FolderRow | undefined;
  return r ? toFolder(r) : null;
}

const colorOf = (c: string | undefined) => (FOLDER_COLORS.some((x) => x.id === c) ? c! : DEFAULT_FOLDER_COLOR);

export function createFolder(input: { name: string; color?: string }): Folder {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Give the folder a name");
  if (db().prepare("SELECT 1 FROM folders WHERE lower(name) = lower(?)").get(name)) throw new Error(`There's already a folder called “${name}”`);
  const now = Date.now();
  const id = nanoid(10);
  db().prepare("INSERT INTO folders (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, colorOf(input.color), now, now);
  return getFolder(id)!;
}

export function updateFolder(id: string, patch: { name?: string; color?: string }): Folder | null {
  const f = getFolder(id);
  if (!f) return null;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 60) : f.name;
  if (!name) throw new Error("Give the folder a name");
  if (name.toLowerCase() !== f.name.toLowerCase() && db().prepare("SELECT 1 FROM folders WHERE lower(name) = lower(?) AND id != ?").get(name, id)) {
    throw new Error(`There's already a folder called “${name}”`);
  }
  db().prepare("UPDATE folders SET name = ?, color = ?, updated_at = ? WHERE id = ?").run(name, patch.color !== undefined ? colorOf(patch.color) : f.color, Date.now(), id);
  return getFolder(id);
}

/** Delete a folder; what was in it goes back to the library (nothing is deleted). */
export function deleteFolder(id: string): boolean {
  let n = 0;
  db().transaction(() => {
    const members = (db().prepare("SELECT generation_id FROM folder_items WHERE folder_id = ?").all(id) as { generation_id: string }[]).map((r) => r.generation_id);
    db().prepare("DELETE FROM folder_items WHERE folder_id = ?").run(id);
    n = db().prepare("DELETE FROM folders WHERE id = ?").run(id).changes;
    touch(members);
  })();
  return n > 0;
}

/** Move generations into a folder (each is in at most one), or back to the library root with null. */
export function moveToFolder(list: string[], folderId: string | null): number {
  if (folderId && !db().prepare("SELECT 1 FROM folders WHERE id = ?").get(folderId)) throw new Error("That folder doesn't exist anymore");
  const found = existing(ids(list));
  const now = Date.now();
  db().transaction(() => {
    const del = db().prepare("DELETE FROM folder_items WHERE generation_id = ?");
    const ins = db().prepare("INSERT INTO folder_items (generation_id, folder_id, added_at) VALUES (?, ?, ?)");
    for (const id of found) {
      del.run(id);
      if (folderId) ins.run(id, folderId, now);
    }
    if (folderId) db().prepare("UPDATE folders SET updated_at = ? WHERE id = ?").run(now, folderId);
    touch(found);
  })();
  return found.length;
}

// ---------------------------------------------------------------------------
// Facets for the filter menus

export interface LibraryFacets {
  models: { id: string; name: string; count: number }[];
  kinds: Partial<Record<MediaKind, number>>;
  total: number;
  favorites: number;
  failed: number;
  trash: number;
}

export function libraryFacets(): LibraryFacets {
  const live = "FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id WHERE t.generation_id IS NULL";
  const models = db().prepare(`SELECT g.model_id AS id, COUNT(*) AS n ${live} GROUP BY g.model_id ORDER BY n DESC`).all() as { id: string; n: number }[];
  const kinds = db().prepare(`SELECT g.kind AS kind, COUNT(*) AS n ${live} GROUP BY g.kind`).all() as { kind: MediaKind; n: number }[];
  const one = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    models: models.map((m) => ({ id: m.id, name: getModel(m.id)?.name ?? m.id, count: m.n })),
    kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.n])),
    total: one(`SELECT COUNT(*) AS n ${live}`),
    favorites: one(`SELECT COUNT(*) AS n ${live} AND g.favorite = 1`),
    failed: one(`SELECT COUNT(*) AS n ${live} AND g.status IN ('failed','canceled')`),
    trash: trashCount(),
  };
}

// ---------------------------------------------------------------------------
// Zip download

export const ZIP_MAX_BYTES = 4 * 1024 ** 3 - 1;

/** The finished output files of these generations, with readable, unique names. */
export function zipEntries(list: string[]): ZipEntry[] {
  const out: ZipEntry[] = [];
  const used = new Set<string>();
  for (const id of ids(list)) {
    const g = getGeneration(id, { includeDeleted: true });
    if (!g || g.status !== "succeeded") continue;
    g.outputs.forEach((o, i) => {
      if (!o.url.startsWith("/api/files/")) return;
      let file: string;
      try {
        file = absolutePath(decodeURIComponent(o.url.slice("/api/files/".length).split("?")[0]));
      } catch {
        return;
      }
      if (!fs.existsSync(file)) return;
      const base = downloadName(g, o, i);
      let name = base;
      for (let k = 2; used.has(name); k++) name = base.replace(/(\.[^.]+)?$/, (ext) => `-${k}${ext}`);
      used.add(name);
      out.push({ name, path: file, size: fs.statSync(file).size });
    });
  }
  return out;
}
