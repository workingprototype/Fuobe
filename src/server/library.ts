import "server-only";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import type { MediaKind, OutputFile, ReviewStatus } from "@/lib/catalog/types";
import {
  DEFAULT_FOLDER_COLOR,
  downloadName,
  FOLDER_COLORS,
  folderAndDescendants,
  folderMoveError,
  folderPath,
  freeName,
  HELPER_FEATURES,
  HELPER_SUFFIX,
  isReviewStatus,
  MAX_FOLDER_DEPTH,
  TRASH_DAYS,
  zipSegment,
  type AssetUse,
  type Folder,
  type ReviewFilter,
} from "@/lib/library";
import { asSystem, currentActor } from "./access/actor";
import { get, getMany, list as scopeList, personOf, stamp, usable } from "./access/scope";
import { db } from "./db";
import { assetUses, cancelGeneration, deleteGeneration, getGeneration, type ListOptions } from "./generations";
import { dropMarks, MARK_COLUMNS, markJoin, setMarks, viewerId } from "./marks";
import { absolutePath, deleteAsset, getAsset } from "./storage";
import type { ZipEntry } from "./zip";

/**
 * The Assets library on top of generations: the Trash (soft delete, kept 30 days), nested folders,
 * pins, review statuses, bulk actions, zip downloads and deleting uploads nothing uses. Every
 * generation reader leaves trashed rows out (listGenerations / getGeneration join generation_trash).
 *
 * Per workspace (docs/research/accounts-8.md §7.4): each workspace has its own folders and its own Trash, a folder and
 * its results share one workspace, and favorites and pins are each viewer's own (item_marks). Changing a result
 * needs Editor in its workspace; restoring it from the Trash or deleting it for good needs its creator or an admin
 * there. The routes refuse ids the person can't use first (scope.getMany: 404, 403); these functions also leave such
 * ids out, quietly, for the studios that tidy their own rows.
 */

const DAY = 86_400_000;
const MAX_IDS = 500;

const STATUSES = new Set(["queued", "running", "succeeded", "failed", "canceled"]);
const KINDS = new Set(["image", "video", "audio", "text", "model3d"]);

/** A library request that can't be done, with the HTTP status the routes answer with. */
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

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
  const reviews = list("reviews")?.filter((r): r is ReviewFilter => r === "none" || isReviewStatus(r));
  const pinned = sp.get("pinned");
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
    folderIds: list("folders")?.filter((id) => id.length <= 40).slice(0, MAX_IDS),
    trashed: sp.get("trash") === "1",
    space: sp.get("space")?.trim() || undefined,
    pinned: pinned === "1" ? true : pinned === "0" ? false : undefined,
    reviews: reviews?.length ? reviews : undefined,
    steps: sp.get("steps") === "1",
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


/** Touch rows so anything watching updated_at (the live stream) sees the change. */
function touch(list: string[]): void {
  if (list.length) db().prepare(`UPDATE generations SET updated_at = ? WHERE id IN (${placeholders(list.length)})`).run(Date.now(), ...list);
}

// ---------------------------------------------------------------------------
// Trash

/**
 * Move to the Trash of each result's workspace (Editor there). Jobs still queued or rendering are canceled (in the
 * background), so a deleted job doesn't keep running and billing out of sight; Restore brings them back as
 * canceled, with Retry.
 */
export function trashGenerations(list: string[], now = Date.now()): number {
  const found = usable("generation", ids(list), "edit");
  const by = personOf(currentActor());
  const insert = db().prepare("INSERT OR IGNORE INTO generation_trash (generation_id, deleted_at, trashed_by) VALUES (?, ?, ?)");
  let n = 0;
  db().transaction(() => {
    for (const id of found) n += insert.run(id, now, by).changes;
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

/** Bring back from the Trash: the person who made it, or an admin of its workspace. */
export function restoreGenerations(list: string[]): number {
  const found = usable("generation", ids(list), "manage");
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

/** Delete for good (the creator or an admin of its workspace); jobs still running are canceled first. */
export async function deleteForever(list: string[]): Promise<number> {
  return deleteNow(usable("generation", ids(list), "manage"));
}

async function deleteNow(found: string[]): Promise<number> {
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

/** The trashed results of a space (the active workspace by default) that the person may delete for good. */
function trashedHere(space?: string | null): string[] {
  const scope = scopeList("generation", "g", { space });
  const rows = db()
    .prepare(`SELECT t.generation_id AS id FROM generation_trash t JOIN generations g ON g.id = t.generation_id WHERE ${scope.sql} ORDER BY t.deleted_at`)
    .all(...scope.args) as { id: string }[];
  return usable("generation", rows.map((r) => r.id), "manage");
}

/**
 * Empty the Trash of a space (the workspace the request works in): what the person made, and everything when they
 * are an admin there. Returns how many were deleted for good.
 */
export async function emptyTrash(space?: string | null): Promise<number> {
  const all = trashedHere(space);
  let n = 0;
  for (let i = 0; i < all.length; i += MAX_IDS) {
    const batch = all.slice(i, i + MAX_IDS);
    n += await deleteNow(batch);
    db().prepare(`DELETE FROM generation_trash WHERE generation_id IN (${placeholders(batch.length)})`).run(...batch);
  }
  // Trash entries whose result is already gone belong to nobody: dropped.
  db().prepare("DELETE FROM generation_trash WHERE generation_id NOT IN (SELECT id FROM generations)").run();
  return n;
}

/** Delete what has been in the Trash for more than 30 days. */
export async function purgeTrash(now = Date.now()): Promise<number> {
  const old = trashedIds(now - TRASH_DAYS * DAY);
  let n = 0;
  // Everyone's Trash: the server's housekeeping (ensureTrashPurge runs it as the system).
  for (let i = 0; i < old.length; i += MAX_IDS) n += await deleteNow(usable("generation", old.slice(i, i + MAX_IDS), "manage"));
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
  // Housekeeping for everyone's Trash: the server's work, whichever library read started it.
  asSystem(() => {
    const timer = setInterval(run, DAY);
    timer.unref?.();
    globalThis.__fuobeTrashPurge = { timer };
    run();
  });
}

/** How many results are in a space's Trash (the active workspace by default). */
export function trashCount(space?: string | null): number {
  const scope = scopeList("generation", "g", { space });
  return (db().prepare(`SELECT COUNT(*) AS n FROM generation_trash t JOIN generations g ON g.id = t.generation_id WHERE ${scope.sql}`).get(...scope.args) as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Favorites, pins (each viewer's own), review status (on the result, for its workspace)

/** Favorite or unfavorite, for the person asking: anything they can see. */
export function setFavorites(list: string[], favorite: boolean): number {
  const found = usable("generation", ids(list), "view");
  setMarks("generation", found, { favorite });
  touch(found);
  return found.length;
}

/** Pin to the top of the person's Library views (one already pinned keeps its place), or unpin. */
export function setPinned(list: string[], pinned: boolean, now = Date.now()): number {
  const found = usable("generation", ids(list), "view");
  setMarks("generation", found, { pinned }, now);
  touch(found);
  return found.length;
}

/** Set a review status (null clears it): Editor in the result's workspace. */
export function setReview(list: string[], review: ReviewStatus | null): number {
  if (review !== null && !isReviewStatus(review)) throw new LibraryError("Pick a review status", 400);
  const found = usable("generation", ids(list), "edit");
  if (!found.length) return 0;
  return db().prepare(`UPDATE generations SET review = ?, updated_at = ? WHERE id IN (${placeholders(found.length)})`).run(review, Date.now(), ...found).changes;
}

// ---------------------------------------------------------------------------
// Folders (nested: each has a parent, null at the library root; one folder per generation)

/** The SQL test for a helper step of `g` (isHelperFeature); the names are constants, not input. */
const HELPER_SQL = `(g.feature LIKE '%${HELPER_SUFFIX}' OR g.feature IN (${HELPER_FEATURES.map((f) => `'${f}'`).join(", ")}))`;

interface FolderRow {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  workspace_id: string;
  /** The viewer's pin (item_marks). */
  m_pinned_at: number | null;
  created_at: number;
  updated_at: number;
  count: number;
  folders: number;
  cover_json: string | null;
}

const toFolder = (r: FolderRow): Folder => {
  const outputs = r.cover_json ? (JSON.parse(r.cover_json) as OutputFile[]) : [];
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    count: r.count,
    folders: r.folders,
    cover: outputs[0] ?? null,
    parentId: r.parent_id || null,
    pinnedAt: r.m_pinned_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

/**
 * A folder's count and cover are what its page shows by default: not the Trash, not helper steps (as the lists). The
 * pin is the viewer's own: bind viewerId() first.
 */
const FOLDER_SELECT = `SELECT f.*, ${MARK_COLUMNS()},
  (SELECT COUNT(*) FROM folder_items i JOIN generations g ON g.id = i.generation_id LEFT JOIN generation_trash t ON t.generation_id = g.id
    WHERE i.folder_id = f.id AND t.generation_id IS NULL AND NOT ${HELPER_SQL}) AS count,
  (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) AS folders,
  (SELECT g.outputs_json FROM folder_items i JOIN generations g ON g.id = i.generation_id LEFT JOIN generation_trash t ON t.generation_id = g.id
    WHERE i.folder_id = f.id AND t.generation_id IS NULL AND NOT ${HELPER_SQL} AND g.status = 'succeeded' AND g.outputs_json != '[]' ORDER BY g.created_at DESC, g.id DESC LIMIT 1) AS cover_json
  FROM folders f ${markJoin("folder", "f")}`;

/**
 * Every folder of a space (the active workspace by default), flat (each with its parentId): the viewer's pinned
 * ones first in the order they pinned them, then oldest first.
 */
export function listFolders(opts: { space?: string | null } = {}): Folder[] {
  const scope = scopeList("folder", "f", { space: opts.space, install: "none" });
  return (
    db()
      .prepare(`${FOLDER_SELECT} WHERE ${scope.sql} ORDER BY m.pinned_at IS NULL, m.pinned_at ASC, f.created_at ASC, f.id ASC`)
      .all(viewerId(), ...scope.args) as FolderRow[]
  ).map(toFolder);
}

/** One folder as the viewer sees it (no access check: callers ask scope.get first). */
export function getFolder(id: string): Folder | null {
  const r = db().prepare(`${FOLDER_SELECT} WHERE f.id = ?`).get(viewerId(), id) as FolderRow | undefined;
  return r ? toFolder(r) : null;
}

/** A workspace's folder tree without counts or covers (moves, deletes and zips walk it). */
function folderLinks(workspaceId: string): { id: string; name: string; parentId: string | null }[] {
  return (db().prepare("SELECT id, name, parent_id FROM folders WHERE workspace_id = ?").all(workspaceId) as { id: string; name: string; parent_id: string | null }[]).map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id || null,
  }));
}

/** Folder names are unique among siblings (case-insensitive), like files in a folder; each workspace has its own root. */
const nameTaken = (workspaceId: string, name: string, parentId: string | null, except = "") =>
  !!db().prepare("SELECT 1 FROM folders WHERE workspace_id = ? AND lower(name) = lower(?) AND parent_id IS ? AND id != ?").get(workspaceId, name, parentId, except);

const GONE = "That folder doesn't exist anymore";
const colorOf = (c: string | undefined) => (FOLDER_COLORS.some((x) => x.id === c) ? c! : DEFAULT_FOLDER_COLOR);

/**
 * A new folder: inside `parentId` (in the parent's workspace, Editor there), or at the root of the workspace the
 * request works in ("" counts as the root, like null).
 */
export function createFolder(input: { name: string; color?: string; parentId?: string | null }): Folder {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new LibraryError("Give the folder a name", 400);
  const parentId = input.parentId || null;
  const where = parentId ? stamp({ workspaceId: get("folder", parentId, "edit", { missing: GONE }).workspaceId }) : stamp();
  if (parentId && folderPath(folderLinks(where.workspace_id), parentId).length >= MAX_FOLDER_DEPTH) throw new LibraryError(`Folders go ${MAX_FOLDER_DEPTH} levels deep at most`);
  if (nameTaken(where.workspace_id, name, parentId)) throw new LibraryError(`There's already a folder called “${name}”${parentId ? " here" : ""}`);
  const now = Date.now();
  const id = nanoid(10);
  db()
    .prepare("INSERT INTO folders (id, name, color, parent_id, created_at, updated_at, workspace_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, name, colorOf(input.color), parentId, now, now, where.workspace_id, where.created_by);
  return getFolder(id)!;
}

/**
 * Rename, recolour, pin or move a folder. Pinning is the viewer's own (anyone who sees it); the rest needs Editor in
 * its workspace. A move (`parentId`, null or "" for the root) stays in the folder's workspace, and is refused into
 * itself or one of its own subfolders, deeper than MAX_FOLDER_DEPTH, or next to a folder of the same name.
 */
export function updateFolder(id: string, patch: { name?: string; color?: string; parentId?: string | null; pinned?: boolean }): Folder | null {
  const changes = patch.name !== undefined || patch.color !== undefined || patch.parentId !== undefined;
  const access = get("folder", id, changes ? "edit" : "view", { missing: GONE });
  const f = getFolder(id);
  if (!f) return null;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 60) : f.name;
  if (!name) throw new LibraryError("Give the folder a name", 400);
  const parentId = patch.parentId !== undefined ? patch.parentId || null : f.parentId;
  if (parentId !== f.parentId) {
    // The new parent must be one the person can change, in the same workspace (another space's folder: Move, later).
    if (parentId && get("folder", parentId, "edit", { missing: GONE }).workspaceId !== access.workspaceId) throw new LibraryError("That folder is in another space", 409);
    const err = folderMoveError(folderLinks(access.workspaceId), id, parentId);
    if (err) throw new LibraryError(err, err === GONE ? 404 : 409);
  }
  if ((name.toLowerCase() !== f.name.toLowerCase() || parentId !== f.parentId) && nameTaken(access.workspaceId, name, parentId, id)) {
    throw new LibraryError(`There's already a folder called “${name}”${parentId !== f.parentId ? " there" : ""}`);
  }
  if (patch.pinned !== undefined) setMarks("folder", [id], { pinned: patch.pinned });
  const color = patch.color !== undefined ? colorOf(patch.color) : f.color;
  db().prepare("UPDATE folders SET name = ?, color = ?, parent_id = ?, updated_at = ? WHERE id = ?").run(name, color, parentId, Date.now(), id);
  return getFolder(id);
}

/** Move a folder into another (null: the library root); see updateFolder for what's refused. */
export const moveFolder = (id: string, parentId: string | null) => updateFolder(id, { parentId });

/**
 * Delete a folder (Editor in its workspace); nothing in it is deleted. Its results and its subfolders move up to its
 * parent (the library root for a top-level folder); a subfolder whose name the parent already has becomes "Name 2".
 */
export function deleteFolder(id: string): boolean {
  const access = get("folder", id, "edit", { missing: GONE });
  const f = db().prepare("SELECT parent_id FROM folders WHERE id = ?").get(id) as { parent_id: string | null } | undefined;
  if (!f) return false;
  const parentId = f.parent_id || null;
  const now = Date.now();
  db().transaction(() => {
    const members = (db().prepare("SELECT generation_id FROM folder_items WHERE folder_id = ?").all(id) as { generation_id: string }[]).map((r) => r.generation_id);
    if (parentId) db().prepare("UPDATE folder_items SET folder_id = ?, added_at = ? WHERE folder_id = ?").run(parentId, now, id);
    else db().prepare("DELETE FROM folder_items WHERE folder_id = ?").run(id);
    const taken = (db().prepare("SELECT name FROM folders WHERE workspace_id = ? AND parent_id IS ? AND id != ?").all(access.workspaceId, parentId, id) as { name: string }[]).map((r) => r.name);
    const kids = db().prepare("SELECT id, name FROM folders WHERE parent_id = ? ORDER BY created_at ASC, id ASC").all(id) as { id: string; name: string }[];
    for (const k of kids) {
      const name = freeName(k.name, taken);
      taken.push(name);
      db().prepare("UPDATE folders SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?").run(parentId, name, now, k.id);
    }
    db().prepare("DELETE FROM folders WHERE id = ?").run(id);
    dropMarks("folder", [id]);
    if (parentId) db().prepare("UPDATE folders SET updated_at = ? WHERE id = ?").run(now, parentId);
    touch(members);
  })();
  return true;
}

/**
 * Move generations into a folder (each is in at most one), or back to the library root with null: Editor on each.
 * A folder holds results of its own workspace only (a result from another space is moved there first: Move).
 */
export function moveToFolder(list: string[], folderId: string | null): number {
  const folder = folderId ? get("folder", folderId, "edit", { missing: GONE }) : null;
  const found = usable("generation", ids(list), "edit");
  if (folder && found.length) {
    const other = db()
      .prepare(`SELECT 1 FROM generations WHERE id IN (${placeholders(found.length)}) AND workspace_id != ? LIMIT 1`)
      .get(...found, folder.workspaceId);
    if (other) throw new LibraryError("Some of these are in another space. Move them to this one first.", 409);
  }
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
  pinned: number;
  /** Helper steps (counted whether they're shown or not, for the "Show steps" toggle). */
  steps: number;
  reviews: Partial<Record<ReviewStatus, number>>;
}

/**
 * Counts for the Library's tabs and filters in a space (the active workspace by default); helper steps are left out
 * unless `steps` (as the lists do). Favorites and pins are the viewer's own.
 */
export function libraryFacets(opts: { steps?: boolean; space?: string | null } = {}): LibraryFacets {
  const scope = scopeList("generation", "g", { space: opts.space });
  const all = `FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id ${markJoin("generation", "g")} WHERE t.generation_id IS NULL AND ${scope.sql}`;
  const args = [viewerId(), ...scope.args];
  const live = opts.steps ? all : `${all} AND NOT ${HELPER_SQL}`;
  const models = db().prepare(`SELECT g.model_id AS id, COUNT(*) AS n ${live} GROUP BY g.model_id ORDER BY n DESC`).all(...args) as { id: string; n: number }[];
  const kinds = db().prepare(`SELECT g.kind AS kind, COUNT(*) AS n ${live} GROUP BY g.kind`).all(...args) as { kind: MediaKind; n: number }[];
  const reviews = db().prepare(`SELECT g.review AS review, COUNT(*) AS n ${live} AND g.review IS NOT NULL GROUP BY g.review`).all(...args) as { review: string; n: number }[];
  const one = (sql: string) => (db().prepare(sql).get(...args) as { n: number }).n;
  return {
    models: models.map((m) => ({ id: m.id, name: getModel(m.id)?.name ?? m.id, count: m.n })),
    kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.n])),
    total: one(`SELECT COUNT(*) AS n ${live}`),
    favorites: one(`SELECT COUNT(*) AS n ${live} AND m.favorite = 1`),
    failed: one(`SELECT COUNT(*) AS n ${live} AND g.status IN ('failed','canceled')`),
    trash: trashCount(opts.space),
    pinned: one(`SELECT COUNT(*) AS n ${live} AND m.pinned_at IS NOT NULL`),
    steps: one(`SELECT COUNT(*) AS n ${all} AND ${HELPER_SQL}`),
    reviews: Object.fromEntries(reviews.filter((r) => isReviewStatus(r.review)).map((r) => [r.review, r.n])),
  };
}

// ---------------------------------------------------------------------------
// Zip download

export const ZIP_MAX_BYTES = 4 * 1024 ** 3 - 1;
/** Results a folder zip takes at most, its subfolders' included (the zip format counts entries in 16 bits). */
export const FOLDER_ZIP_MAX = 5000;

/** Add the finished output files of these generations under `prefix`, with readable names unique in the zip. */
function addEntries(list: string[], prefix: string, used: Set<string>, out: ZipEntry[]): void {
  for (const id of list) {
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
      const base = `${prefix}${downloadName(g, o, i)}`;
      let name = base;
      for (let k = 2; used.has(name); k++) name = base.replace(/(\.[^./]+)?$/, (ext) => `-${k}${ext}`);
      used.add(name);
      out.push({ name, path: file, size: fs.statSync(file).size });
    });
  }
}

/** The finished output files of these generations (the ones the person can see), with readable, unique names. */
export function zipEntries(list: string[]): ZipEntry[] {
  const out: ZipEntry[] = [];
  addEntries(usable("generation", ids(list), "view"), "", new Set(), out);
  return out;
}

/**
 * A folder as a zip: its finished outputs at the top and each subfolder's in a folder of its own
 * ("Shots/Close-ups/fox-ab12cd.png"), at any depth. It holds what the folder pages show: results in
 * the Trash are left out, and helper steps too unless `steps` (the Library's Show steps is on).
 */
export function folderZipEntries(id: string, opts: { steps?: boolean } = {}): { name: string; entries: ZipEntry[] } | null {
  const access = get("folder", id, "view", { missing: GONE });
  const links = folderLinks(access.workspaceId);
  const root = links.find((f) => f.id === id);
  if (!root) return null;
  const tree = folderAndDescendants(links, id);
  const members = db()
    .prepare(
      `SELECT i.generation_id AS id, i.folder_id AS folder FROM folder_items i JOIN generations g ON g.id = i.generation_id LEFT JOIN generation_trash t ON t.generation_id = g.id
       WHERE t.generation_id IS NULL${opts.steps ? "" : ` AND NOT ${HELPER_SQL}`} AND i.folder_id IN (${placeholders(tree.length)}) ORDER BY g.created_at DESC, g.id DESC`,
    )
    .all(...tree) as { id: string; folder: string }[];
  if (members.length > FOLDER_ZIP_MAX) throw new LibraryError(`“${root.name}” and its subfolders hold over ${FOLDER_ZIP_MAX.toLocaleString("en-US")} results. Download its subfolders one at a time.`, 413);
  const depth = folderPath(links, id).length;
  const out: ZipEntry[] = [];
  const used = new Set<string>();
  for (const fid of tree) {
    const prefix = folderPath(links, fid)
      .slice(depth)
      .map((f) => `${zipSegment(f.name)}/`)
      .join("");
    addEntries(
      members.filter((m) => m.folder === fid).map((m) => m.id),
      prefix,
      used,
      out,
    );
  }
  return { name: root.name, entries: out };
}

// ---------------------------------------------------------------------------
// Uploads

/**
 * Delete a stored file for good (the Uploads tab), its file on disk included, but only when nothing
 * refers to it (assetUses: results' requests and outputs, in the Trash too, elements, chats, every
 * studio). Otherwise nothing changes and `uses` says where it's used. null: no such file. Only the person who
 * stored it, or an admin of its workspace (404 for a file they can't see, 403 for one they can't delete).
 */
export function deleteUnusedAsset(id: string): { deleted: boolean; uses: AssetUse[] } | null {
  if (!getAsset(id)) return null;
  get("asset", id, "manage", { missing: "That file is already gone" });
  const uses = assetUses(id);
  if (uses.length) return { deleted: false, uses };
  deleteAsset(id);
  return { deleted: true, uses: [] };
}
