import "server-only";
/**
 * Share links and published pages (R4-28): create, list, change, revoke, and build the public
 * page. A share names what it shows (a result, a folder with its subfolders, a Cinema project, or
 * a published selection of results), never files, so its page always shows what still exists:
 * finished results that aren't in the Trash, without helper steps. The files route serves exactly
 * the files that page shows (`files` of buildPublicShare), nothing else.
 */
import { getModel } from "@/lib/catalog";
import { OPERATION_LABELS, type Generation, type OutputFile } from "@/lib/catalog/types";
import { HELPER_FEATURES, HELPER_SUFFIX, extensionOf, userTitle } from "@/lib/library";
import { shownOutputs } from "@/lib/output-actions";
import {
  expiryFrom,
  fileName,
  MAX_EXPIRY_DAYS,
  outputFiles,
  parseTags,
  SHARE_KINDS,
  shareFileUrl,
  sharePath,
  storedPath,
  type PublicItem,
  type PublicMedia,
  type PublicShare,
  type ShareInfo,
  type ShareKind,
  type ShareLayout,
  type ShareListItem,
} from "@/lib/share";
import { db } from "./db";
import { toGeneration } from "./generations";
import { NOT_TRASHED, newToken, shareTargetExists, toShareInfo, type ShareRow } from "./share-access";

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** A folder or project page shows its newest 200 results; a published page up to 100 picked ones. */
export const SCOPE_LIMIT = 200;
export const MAX_PUBLISH_ITEMS = 100;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;

const HELPER_SQL = `(g.feature LIKE '%${HELPER_SUFFIX}' OR g.feature IN (${HELPER_FEATURES.map((f) => `'${f}'`).join(", ")}))`;
const SHOWN = `g.status = 'succeeded' AND g.outputs_json != '[]' AND ${NOT_TRASHED}`;
const COLUMNS = "g.*, NULL AS deleted_at, NULL AS folder_id";

type GenRow = Parameters<typeof toGeneration>[0];

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** The results a share shows, in page order (null: what it shares is gone), and whether there are more. */
function scope(s: Pick<ShareRow, "kind" | "target_id" | "items_json">): { list: Generation[]; truncated: boolean } | null {
  if (!shareTargetExists(s)) return null;
  const all = (sql: string, ...args: unknown[]) => (db().prepare(sql).all(...args) as GenRow[]).map(toGeneration);
  const capped = (list: Generation[]) => ({ list: list.slice(0, SCOPE_LIMIT), truncated: list.length > SCOPE_LIMIT });
  switch (s.kind) {
    case "result":
      return { list: all(`SELECT ${COLUMNS} FROM generations g WHERE g.id = ? AND ${SHOWN}`, s.target_id), truncated: false };
    case "folder":
      return capped(
        all(
          `WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
           SELECT ${COLUMNS} FROM generations g JOIN folder_items fi ON fi.generation_id = g.id
           WHERE fi.folder_id IN (SELECT id FROM sub) AND ${SHOWN} AND NOT ${HELPER_SQL}
           ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
          s.target_id,
          SCOPE_LIMIT + 1,
        ),
      );
    case "cinema":
      return capped(
        all(
          `SELECT ${COLUMNS} FROM generations g JOIN cinema_items i ON i.generation_id = g.id
           WHERE i.project_id = ? AND json_extract(i.meta_json, '$.removed') IS NULL AND ${SHOWN} AND NOT ${HELPER_SQL}
           ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
          s.target_id,
          SCOPE_LIMIT + 1,
        ),
      );
    case "publish": {
      const ids = parseIds(s.items_json);
      if (!ids.length) return { list: [], truncated: false };
      const found = new Map(all(`SELECT ${COLUMNS} FROM generations g WHERE g.id IN (${marks(ids.length)}) AND ${SHOWN}`, ...ids).map((g) => [g.id, g]));
      return { list: ids.map((id) => found.get(id)).filter((g): g is Generation => !!g), truncated: false };
    }
  }
}

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_PUBLISH_ITEMS) : [];
  } catch {
    return [];
  }
}

/** A user's own words, unless a chained step's prompt is data (a cue list). */
function promptOf(g: Generation): string | undefined {
  const p = (g.request.prompt?.trim() || g.prompt?.trim() || "").slice(0, 4000);
  return p && !/^[[{]/.test(p) ? p : undefined;
}

/** What an item is called on the page: its title or prompt when prompts are shared, else what was made and with what. */
function itemTitle(g: Generation, showPrompts: boolean): string {
  if (showPrompts) return userTitle(g).slice(0, 140);
  return OPERATION_LABELS[g.op] ?? (g.kind === "video" ? "Video" : g.kind === "audio" ? "Audio" : g.kind === "model3d" ? "3D model" : g.kind === "text" ? "Text" : "Image");
}

/**
 * The public page for a share, and every stored file it may serve (relative paths under the files
 * folder). Null when what it shares is gone. Prompts (and titles made from them) are left out
 * unless the share shows prompts; file names are made from the page's own titles.
 */
export function buildPublicShare(row: ShareRow, token: string): { page: PublicShare; files: Set<string> } | null {
  const sc = scope(row);
  if (!sc) return null;
  const share = toShareInfo(row);
  const files = new Set<string>();
  const media = (o: OutputFile, index: number, title: string): PublicMedia | null => {
    const url = shareFileUrl(token, o.url);
    if (!url) return null;
    for (const f of outputFiles(o)) files.add(f);
    const posterSrc = ["poster", "thumbnail", "preview"].map((k) => o.meta?.[k]).find((v): v is string => typeof v === "string" && !!storedPath(v));
    return {
      url,
      kind: o.kind,
      ...(o.contentType && { contentType: o.contentType }),
      ...(o.width && { width: o.width }),
      ...(o.height && { height: o.height }),
      ...(o.kind === "video" && posterSrc && { poster: shareFileUrl(token, posterSrc)! }),
      ...(o.kind === "text" && typeof o.text === "string" && { text: o.text.slice(0, 20_000) }),
      download: fileName(title, index, extensionOf(o)),
    };
  };
  let cover: PublicMedia | null = null;
  let coverKey: string | null = null;
  const items: PublicItem[] = [];
  for (const [n, g] of sc.list.entries()) {
    const key = String(n + 1);
    const title = itemTitle(g, share.showPrompts);
    // A 3D result shows its turntable (a video output) with the model as a download.
    const shown = g.kind === "model3d" ? g.outputs.map((_, i) => i) : shownOutputs(g);
    const list = shown.map((i) => ({ i, m: media(g.outputs[i], i, title) })).filter((x): x is { i: number; m: PublicMedia } => !!x.m);
    if (!list.length) continue;
    if (share.cover?.generationId === g.id) {
      cover = (list.find((x) => x.i === share.cover!.index) ?? list[0]).m;
      coverKey = key;
    }
    const prompt = share.showPrompts ? promptOf(g) : undefined;
    items.push({
      key,
      title,
      model: getModel(g.modelId)?.name ?? g.modelName ?? g.modelId,
      kind: g.kind,
      ...(prompt && { prompt }),
      aspectRatio: g.aspectRatio ?? null,
      media: list.map((x) => x.m),
      createdAt: g.createdAt,
    });
  }
  if (!cover) {
    for (const it of items) {
      const m = it.media.find((x) => x.kind === "image" || x.poster);
      if (m) {
        cover = m;
        coverKey = it.key;
        break;
      }
    }
  }
  return {
    page: {
      kind: share.kind,
      title: share.title,
      description: share.description,
      tags: share.tags,
      layout: share.layout,
      showPrompts: share.showPrompts,
      cover,
      coverKey,
      items,
      truncated: sc.truncated,
      updatedAt: share.updatedAt,
    },
    files,
  };
}

/** Whether a share may serve this stored file: only one its page shows. */
export function shareServesFile(row: ShareRow, token: string, rel: string): boolean {
  return buildPublicShare(row, token)?.files.has(rel) ?? false;
}

/** A page view by someone other than the signed-in owner. */
export function recordView(id: string, now = Date.now()): void {
  db().prepare("UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE id = ?").run(now, id);
}

// ---------------------------------------------------------------------------
// The owner's side

export interface CreateShareInput {
  kind: ShareKind;
  /** The result, folder or Cinema project (not for a published selection). */
  targetId?: string | null;
  /** A published selection's results, in page order. */
  items?: string[];
  title?: string;
  description?: string;
  tags?: string[] | string;
  layout?: ShareLayout;
  cover?: { generationId: string; index: number } | null;
  showPrompts?: boolean;
  /** Days until the link stops working; null or left out: until revoked. */
  expiresInDays?: number | null;
}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, (w) => (w.includes("\n") ? "\n" : " ")).trim().slice(0, max);

/** What a link is called when the owner leaves the title empty: the result, folder or project's own name. */
function defaultTitle(kind: ShareKind, targetId: string | null): string {
  const get = (sql: string) => (targetId ? (db().prepare(sql).get(targetId) as { name?: string } | undefined)?.name : undefined);
  if (kind === "folder") return get("SELECT name FROM folders WHERE id = ?") ?? "Shared folder";
  if (kind === "cinema") return get("SELECT name FROM cinema_projects WHERE id = ?") ?? "Shared project";
  if (kind === "result") {
    const g = targetId ? scope({ kind, target_id: targetId, items_json: "[]" })?.list[0] : undefined;
    return g ? itemTitle(g, false) : "Shared result";
  }
  return "Untitled";
}

function validCover(cover: CreateShareInput["cover"], items: Generation[]): { generationId: string; index: number } | null {
  if (!cover) return null;
  const g = items.find((x) => x.id === cover.generationId);
  if (!g) throw new ShareError("Pick the cover from the results you're publishing");
  const index = Number.isInteger(cover.index) && cover.index >= 0 && cover.index < g.outputs.length ? cover.index : 0;
  return { generationId: g.id, index };
}

/** A new link. The token is in the answer only: it can't be read back later (only its hash is kept). */
export function createShare(input: CreateShareInput, now = Date.now()): { share: ShareInfo; token: string; path: string } {
  if (!SHARE_KINDS.includes(input.kind)) throw new ShareError("Share a result, a folder, a Cinema project or a selection");
  const publish = input.kind === "publish";
  const targetId = publish ? null : (input.targetId ?? "").trim();
  let items: string[] = [];
  let cover: ShareInfo["cover"] = null;
  if (publish) {
    items = [...new Set((input.items ?? []).filter((x) => typeof x === "string" && x))];
    if (!items.length) throw new ShareError("Pick at least one result to publish");
    if (items.length > MAX_PUBLISH_ITEMS) throw new ShareError(`A page holds up to ${MAX_PUBLISH_ITEMS} results; pick fewer`);
    const found = scope({ kind: "publish", target_id: null, items_json: JSON.stringify(items) })!.list;
    if (found.length < items.length) {
      const n = items.length - found.length;
      throw new ShareError(`${n === 1 ? "One result isn't" : `${n} results aren't`} finished or ${n === 1 ? "is" : "are"} in the Trash: take ${n === 1 ? "it" : "them"} out of the selection`);
    }
    cover = validCover(input.cover, found);
  } else if (!targetId || !shareTargetExists({ kind: input.kind, target_id: targetId })) {
    throw new ShareError(input.kind === "result" ? "Only a finished result that isn't in the Trash can be shared" : `That ${input.kind === "folder" ? "folder" : "project"} doesn't exist anymore`, 404);
  }
  const layout: ShareLayout = publish ? (input.layout && input.layout !== "grid" ? input.layout : "feature") : "grid";
  const title = clean(input.title, MAX_TITLE) || defaultTitle(input.kind, targetId);
  const { id, token, hash } = newToken();
  db()
    .prepare(
      `INSERT INTO shares (id, token_hash, kind, target_id, title, description, tags_json, layout, items_json, cover_id, cover_index, show_prompts, expires_at, created_at, updated_at)
       VALUES (@id, @hash, @kind, @target, @title, @description, @tags, @layout, @items, @coverId, @coverIndex, @prompts, @expires, @now, @now)`,
    )
    .run({
      id,
      hash,
      kind: input.kind,
      target: targetId,
      title,
      description: clean(input.description, MAX_DESCRIPTION),
      tags: JSON.stringify(parseTags(input.tags ?? [])),
      layout,
      items: JSON.stringify(items),
      coverId: cover?.generationId ?? null,
      coverIndex: cover?.index ?? 0,
      prompts: input.showPrompts ? 1 : 0,
      expires: expiryFrom(input.expiresInDays, now),
      now,
    });
  return { share: getShare(id)!, token, path: sharePath(token) };
}

function rowOf(id: string): ShareRow | undefined {
  return db().prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow | undefined;
}

export function getShare(id: string): ShareInfo | null {
  const r = rowOf(id);
  return r ? toShareInfo(r) : null;
}

/** Every link, newest first, with what its page shows now (Library → Shared). */
export function listShares(): ShareListItem[] {
  const rows = db().prepare("SELECT * FROM shares ORDER BY created_at DESC, id DESC").all() as ShareRow[];
  return rows.map((r) => {
    const sc = scope(r);
    const info = toShareInfo(r);
    const coverGen = (info.cover && sc?.list.find((g) => g.id === info.cover!.generationId)) || sc?.list.find((g) => g.outputs.some((o) => (o.kind === "image" || o.kind === "video") && storedPath(o.url)));
    const out = coverGen?.outputs[coverGen.id === info.cover?.generationId ? info.cover.index : coverGen.outputs.findIndex((o) => (o.kind === "image" || o.kind === "video") && storedPath(o.url))];
    return { ...info, count: sc?.list.length ?? 0, thumb: out && storedPath(out.url) ? { url: out.url, kind: out.kind } : null, gone: !sc };
  });
}

export interface SharePatch {
  title?: string;
  description?: string;
  tags?: string[] | string;
  layout?: ShareLayout;
  showPrompts?: boolean;
  /** Days from now; null: never expires. */
  expiresInDays?: number | null;
  /** A new token: the old link stops working. */
  newLink?: boolean;
}

/** Change a link (its words, prompts on or off, a new expiry from now), or give it a new token. */
export function updateShare(id: string, patch: SharePatch, now = Date.now()): { share: ShareInfo; token?: string; path?: string } | null {
  const r = rowOf(id);
  if (!r) return null;
  const sets: Record<string, unknown> = {};
  if (patch.title !== undefined) sets.title = clean(patch.title, MAX_TITLE) || r.title;
  if (patch.description !== undefined) sets.description = clean(patch.description, MAX_DESCRIPTION);
  if (patch.tags !== undefined) sets.tags_json = JSON.stringify(parseTags(patch.tags));
  if (patch.layout !== undefined && r.kind === "publish" && patch.layout !== "grid") sets.layout = patch.layout;
  if (patch.showPrompts !== undefined) sets.show_prompts = patch.showPrompts ? 1 : 0;
  if (patch.expiresInDays !== undefined) {
    if (patch.expiresInDays !== null && !(patch.expiresInDays > 0 && patch.expiresInDays <= MAX_EXPIRY_DAYS)) throw new ShareError(`Pick 1 to ${MAX_EXPIRY_DAYS} days, or never`);
    sets.expires_at = expiryFrom(patch.expiresInDays, now);
  }
  let fresh: ReturnType<typeof newToken> | undefined;
  // A new token keeps the row (and its views); its id is the token's start, so the row's key changes too.
  if (patch.newLink) fresh = newToken();
  const keys = Object.keys(sets);
  db().transaction(() => {
    if (keys.length) db().prepare(`UPDATE shares SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`).run({ ...sets, __now: now, __id: id });
    if (fresh) db().prepare("UPDATE shares SET id = ?, token_hash = ?, updated_at = ? WHERE id = ?").run(fresh.id, fresh.hash, now, id);
  })();
  const share = getShare(fresh?.id ?? id)!;
  return fresh ? { share, token: fresh.token, path: sharePath(fresh.token) } : { share };
}

/** Revoke: the link stops working at once (its row is deleted). */
export function revokeShare(id: string): boolean {
  return db().prepare("DELETE FROM shares WHERE id = ?").run(id).changes > 0;
}
