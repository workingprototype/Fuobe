import "server-only";
import { nanoid } from "nanoid";
import type { CinemaFolder, CinemaItem, CinemaProject, CinemaTile, DirectorMessage, DirectorSettings } from "@/lib/catalog/cinema";
import type { Generation } from "@/lib/catalog/types";
import { db } from "./db";
import { deleteGeneration, getGeneration, listGenerations } from "./generations";

/**
 * Cinema Studio projects: Director settings, brief and AI Director chat per project, nested folders
 * (scenes) and which generations live where. Generations stay ordinary rows in `generations`; a
 * project only records their ids (cinema_items), written when a take is made from the workspace.
 */

export class CinemaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  cost_cap_usd: number | null;
  director_json: string;
  palettes_json: string;
  brief_title: string;
  brief_body: string;
  chat_json: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

interface FolderRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  pinned: number;
  position: number;
  created_at: number;
  updated_at: number;
}

interface ItemRow {
  project_id: string;
  generation_id: string;
  folder_id: string | null;
  meta_json: string | null;
  created_at: number;
}

const parse = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toProject = (r: ProjectRow): CinemaProject => ({
  id: r.id,
  name: r.name,
  description: r.description,
  cover: r.cover_url,
  costCapUsd: r.cost_cap_usd,
  director: parse<DirectorSettings>(r.director_json, {}),
  palettes: parse(r.palettes_json, []),
  brief: { title: r.brief_title, body: r.brief_body },
  pinned: !!r.pinned,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toFolder = (r: FolderRow): CinemaFolder => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id,
  name: r.name,
  color: r.color,
  pinned: !!r.pinned,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toItem = (r: ItemRow): CinemaItem => {
  const meta = parse<{ tiles?: CinemaTile[] }>(r.meta_json, {});
  return { generationId: r.generation_id, folderId: r.folder_id, createdAt: r.created_at, ...(meta.tiles?.length ? { tiles: meta.tiles } : {}) };
};

/** A generation that still exists (soft-deleted rows from the Trash, when there is one, are left out). */
function liveGeneration(id: string): Generation | null {
  const g = getGeneration(id) as (Generation & { deletedAt?: number | null }) | null;
  return g && !g.deletedAt ? g : null;
}

// ---------------------------------------------------------------------------
// Projects

function projectRow(id: string): ProjectRow | undefined {
  return db().prepare("SELECT * FROM cinema_projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function getProject(id: string): CinemaProject | null {
  const r = projectRow(id);
  return r ? toProject(r) : null;
}

function requireProject(id: string): CinemaProject {
  const p = getProject(id);
  if (!p) throw new CinemaError("Project not found", 404);
  return p;
}

/** Estimated spend so far: the recorded cost of every take that didn't fail. */
export function spentUsd(projectId: string): number {
  const r = db()
    .prepare(
      `SELECT COALESCE(SUM(g.cost_usd), 0) AS s FROM cinema_items i JOIN generations g ON g.id = i.generation_id
       WHERE i.project_id = ? AND g.status NOT IN ('failed', 'canceled')`,
    )
    .get(projectId) as { s: number };
  return Math.round(r.s * 1000) / 1000;
}

/** Newest finished image (or video) of a project: the card cover when none was picked. */
function autoCover(projectId: string): string | null {
  const ids = db().prepare("SELECT generation_id FROM cinema_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 40").all(projectId) as { generation_id: string }[];
  let video: string | null = null;
  for (const { generation_id } of ids) {
    const g = db().prepare("SELECT status, outputs_json FROM generations WHERE id = ?").get(generation_id) as { status: string; outputs_json: string } | undefined;
    if (g?.status !== "succeeded") continue;
    const outs = parse<{ url: string; kind: string }[]>(g.outputs_json, []);
    const img = outs.find((o) => o.kind === "image");
    if (img) return img.url;
    video ??= outs.find((o) => o.kind === "video")?.url ?? null;
  }
  return video;
}

export function listProjects(): CinemaProject[] {
  const rows = db().prepare("SELECT * FROM cinema_projects ORDER BY pinned DESC, updated_at DESC").all() as ProjectRow[];
  return rows.map((r) => {
    const items = (db().prepare("SELECT COUNT(*) AS n FROM cinema_items WHERE project_id = ?").get(r.id) as { n: number }).n;
    return { ...toProject(r), stats: { items, spentUsd: spentUsd(r.id), cover: r.cover_url ?? autoCover(r.id) } };
  });
}

export function createProject(input: { name: string; description?: string | null; cover?: string | null; costCapUsd?: number | null }): CinemaProject {
  const now = Date.now();
  const row: ProjectRow = {
    id: nanoid(10),
    name: input.name.trim().slice(0, 80) || "Untitled project",
    description: input.description?.trim().slice(0, 140) || null,
    cover_url: input.cover ?? null,
    cost_cap_usd: input.costCapUsd ?? null,
    director_json: "{}",
    palettes_json: "[]",
    brief_title: "",
    brief_body: "",
    chat_json: "[]",
    pinned: 0,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO cinema_projects (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toProject(row);
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

export function updateProject(id: string, patch: ProjectPatch): CinemaProject {
  const cur = requireProject(id);
  const next = {
    id,
    name: patch.name?.trim().slice(0, 80) || cur.name,
    description: patch.description === undefined ? cur.description : patch.description?.trim().slice(0, 140) || null,
    cover_url: patch.cover === undefined ? cur.cover : patch.cover,
    cost_cap_usd: patch.costCapUsd === undefined ? cur.costCapUsd : patch.costCapUsd,
    director_json: JSON.stringify(patch.director ?? cur.director),
    palettes_json: JSON.stringify((patch.palettes ?? cur.palettes).slice(0, 60)),
    brief_title: patch.brief?.title === undefined ? cur.brief.title : patch.brief.title.slice(0, 120),
    brief_body: patch.brief?.body === undefined ? cur.brief.body : patch.brief.body.slice(0, 20_000),
    pinned: patch.pinned === undefined ? Number(cur.pinned) : Number(patch.pinned),
    updated_at: Date.now(),
  };
  db()
    .prepare(
      `UPDATE cinema_projects SET name = @name, description = @description, cover_url = @cover_url, cost_cap_usd = @cost_cap_usd,
       director_json = @director_json, palettes_json = @palettes_json, brief_title = @brief_title, brief_body = @brief_body,
       pinned = @pinned, updated_at = @updated_at WHERE id = @id`,
    )
    .run(next);
  return getProject(id)!;
}

/** Deletes the project and its folders; its generations stay in the library. */
export function deleteProject(id: string): void {
  db().transaction(() => {
    db().prepare("DELETE FROM cinema_items WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM cinema_folders WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM cinema_projects WHERE id = ?").run(id);
  })();
}

function touch(projectId: string): void {
  db().prepare("UPDATE cinema_projects SET updated_at = ? WHERE id = ?").run(Date.now(), projectId);
}

// ---------------------------------------------------------------------------
// AI Director chat (kept on the project: one production, one conversation)

export function getChat(projectId: string): DirectorMessage[] {
  const r = projectRow(projectId);
  if (!r) throw new CinemaError("Project not found", 404);
  return parse<DirectorMessage[]>(r.chat_json, []);
}

export function appendChat(projectId: string, ...messages: DirectorMessage[]): DirectorMessage[] {
  const next = [...getChat(projectId), ...messages].slice(-100);
  db().prepare("UPDATE cinema_projects SET chat_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), Date.now(), projectId);
  return next;
}

export function clearChat(projectId: string): void {
  db().prepare("UPDATE cinema_projects SET chat_json = '[]' WHERE id = ?").run(projectId);
}

// ---------------------------------------------------------------------------
// Folders (scenes)

export function listFolders(projectId: string): CinemaFolder[] {
  return (db().prepare("SELECT * FROM cinema_folders WHERE project_id = ? ORDER BY pinned DESC, position ASC, created_at ASC").all(projectId) as FolderRow[]).map(toFolder);
}

function folderRow(id: string): FolderRow | undefined {
  return db().prepare("SELECT * FROM cinema_folders WHERE id = ?").get(id) as FolderRow | undefined;
}

/** A folder and everything nested in it. */
export function descendants(projectId: string, folderId: string): Set<string> {
  const folders = listFolders(projectId);
  const out = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

function checkParent(projectId: string, parentId: string | null | undefined, self?: string): void {
  if (!parentId) return;
  const p = folderRow(parentId);
  if (!p || p.project_id !== projectId) throw new CinemaError("That folder doesn't exist", 404);
  if (self && descendants(projectId, self).has(parentId)) throw new CinemaError("Cannot move into a subfolder");
}

export function createFolder(projectId: string, input: { name: string; parentId?: string | null; color?: string | null }): CinemaFolder {
  requireProject(projectId);
  checkParent(projectId, input.parentId);
  const now = Date.now();
  const position = (db().prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cinema_folders WHERE project_id = ?").get(projectId) as { p: number }).p;
  const row: FolderRow = {
    id: nanoid(10),
    project_id: projectId,
    parent_id: input.parentId ?? null,
    name: input.name.trim().slice(0, 60) || "New scene",
    color: input.color ?? null,
    pinned: 0,
    position,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO cinema_folders (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  touch(projectId);
  return toFolder(row);
}

export function updateFolder(projectId: string, id: string, patch: { name?: string; color?: string | null; pinned?: boolean; parentId?: string | null; position?: number }): CinemaFolder {
  const cur = folderRow(id);
  if (!cur || cur.project_id !== projectId) throw new CinemaError("Folder not found", 404);
  if (patch.parentId !== undefined) checkParent(projectId, patch.parentId, id);
  db()
    .prepare("UPDATE cinema_folders SET name = ?, color = ?, pinned = ?, parent_id = ?, position = ?, updated_at = ? WHERE id = ?")
    .run(
      patch.name?.trim().slice(0, 60) || cur.name,
      patch.color === undefined ? cur.color : patch.color,
      patch.pinned === undefined ? cur.pinned : Number(patch.pinned),
      patch.parentId === undefined ? cur.parent_id : patch.parentId,
      patch.position ?? cur.position,
      Date.now(),
      id,
    );
  touch(projectId);
  return toFolder(folderRow(id)!);
}

/** Deleting a folder moves its takes and subfolders up to its parent (as Higgsfield does). */
export function deleteFolder(projectId: string, id: string): void {
  const cur = folderRow(id);
  if (!cur || cur.project_id !== projectId) throw new CinemaError("Folder not found", 404);
  db().transaction(() => {
    db().prepare("UPDATE cinema_items SET folder_id = ? WHERE project_id = ? AND folder_id = ?").run(cur.parent_id, projectId, id);
    db().prepare("UPDATE cinema_folders SET parent_id = ? WHERE project_id = ? AND parent_id = ?").run(cur.parent_id, projectId, id);
    db().prepare("DELETE FROM cinema_folders WHERE id = ?").run(id);
  })();
  touch(projectId);
}

// ---------------------------------------------------------------------------
// Items: the project's generations

export type CinemaGeneration = Generation & { folderId: string | null; tiles?: CinemaTile[] };

export interface ItemQuery {
  /** A folder id; null = the project root only; undefined = everything in the project. */
  folderId?: string | null;
  /** With a folder: also the takes in its subfolders. */
  nested?: boolean;
  favorites?: boolean;
}

export function listItems(projectId: string, q: ItemQuery = {}): CinemaGeneration[] {
  requireProject(projectId);
  let rows = db().prepare("SELECT * FROM cinema_items WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as ItemRow[];
  if (q.folderId === null) rows = rows.filter((r) => !r.folder_id);
  else if (q.folderId) {
    const set = q.nested ? descendants(projectId, q.folderId) : new Set([q.folderId]);
    rows = rows.filter((r) => r.folder_id && set.has(r.folder_id));
  }
  const out: CinemaGeneration[] = [];
  for (const r of rows) {
    const g = liveGeneration(r.generation_id);
    if (!g) continue;
    if (q.favorites && !g.favorite) continue;
    const item = toItem(r);
    out.push({ ...g, folderId: item.folderId, ...(item.tiles ? { tiles: item.tiles } : {}) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Every Cinema Studio generation, whichever project it's in ("My Generations"). */
export function listStudioGenerations(): CinemaGeneration[] {
  const folders = new Map(
    (db().prepare("SELECT generation_id, folder_id FROM cinema_items").all() as { generation_id: string; folder_id: string | null }[]).map((r) => [r.generation_id, r.folder_id]),
  );
  return listGenerations({ features: ["cinema*"], limit: 200 })
    .filter((g) => !(g as Generation & { deletedAt?: number | null }).deletedAt)
    .map((g) => ({ ...g, folderId: folders.get(g.id) ?? null }));
}

export function addItems(projectId: string, generationIds: string[], folderId: string | null = null): void {
  requireProject(projectId);
  if (folderId) checkParent(projectId, folderId);
  const now = Date.now();
  const ins = db().prepare("INSERT OR IGNORE INTO cinema_items (project_id, generation_id, folder_id, meta_json, created_at) VALUES (?, ?, ?, NULL, ?)");
  db().transaction(() => generationIds.forEach((id, i) => ins.run(projectId, id, folderId, now + i)))();
  touch(projectId);
}

export function moveItems(projectId: string, generationIds: string[], folderId: string | null): number {
  requireProject(projectId);
  if (folderId) checkParent(projectId, folderId);
  const up = db().prepare("UPDATE cinema_items SET folder_id = ? WHERE project_id = ? AND generation_id = ?");
  let n = 0;
  db().transaction(() => generationIds.forEach((id) => (n += up.run(folderId, projectId, id).changes)))();
  touch(projectId);
  return n;
}

/** Remove takes from the project; with `deleteGenerations` they are deleted from the library too. */
export function removeItems(projectId: string, generationIds: string[], opts: { deleteGenerations?: boolean } = {}): number {
  requireProject(projectId);
  const del = db().prepare("DELETE FROM cinema_items WHERE project_id = ? AND generation_id = ?");
  let n = 0;
  db().transaction(() => generationIds.forEach((id) => (n += del.run(projectId, id).changes)))();
  if (opts.deleteGenerations) for (const id of generationIds) deleteGeneration(id);
  touch(projectId);
  return n;
}

export function setFavorites(projectId: string, generationIds: string[], favorite: boolean): void {
  requireProject(projectId);
  const up = db().prepare("UPDATE generations SET favorite = ?, updated_at = ? WHERE id = ? AND id IN (SELECT generation_id FROM cinema_items WHERE project_id = ?)");
  db().transaction(() => generationIds.forEach((id) => up.run(favorite ? 1 : 0, Date.now(), id, projectId)))();
}

export function setTiles(projectId: string, generationId: string, tiles: CinemaTile[]): CinemaItem {
  const r = db().prepare("SELECT * FROM cinema_items WHERE project_id = ? AND generation_id = ?").get(projectId, generationId) as ItemRow | undefined;
  if (!r) throw new CinemaError("That take isn't in this project", 404);
  const meta = { ...parse<Record<string, unknown>>(r.meta_json, {}), tiles: tiles.slice(0, 16) };
  db().prepare("UPDATE cinema_items SET meta_json = ? WHERE project_id = ? AND generation_id = ?").run(JSON.stringify(meta), projectId, generationId);
  return toItem({ ...r, meta_json: JSON.stringify(meta) });
}
