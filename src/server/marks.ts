import "server-only";
import { maybeActor } from "./access/actor";
import { db } from "./db";

/**
 * Favorites and pins, per viewer (docs/research/accounts-8.md §7.4): each person's own marks on results and folders,
 * kept in item_marks, so one person's favorites and pinned folders are never another's. Reads take the viewer from
 * the request (no one, or the server, has none); a row with neither mark is removed.
 */

export type MarkKind = "generation" | "folder";

export interface Mark {
  favorite: boolean;
  pinnedAt: number | null;
}

/** Whose marks a read shows: the person acting ("" for nobody and for the server's own work, who have none). */
export function viewerId(): string {
  const a = maybeActor();
  return a && a.via !== "system" ? a.userId : "";
}

/**
 * The join that adds the viewer's marks to a query on `alias` (as m_favorite, m_pinned_at): bind viewerId() at its
 * one `?`, which comes before the WHERE clause's own.
 */
export const markJoin = (kind: MarkKind, alias: string, m = "m") => `LEFT JOIN item_marks ${m} ON ${m}.user_id = ? AND ${m}.item_kind = '${kind}' AND ${m}.item_id = ${alias}.id`;

export const MARK_COLUMNS = (m = "m") => `${m}.favorite AS m_favorite, ${m}.pinned_at AS m_pinned_at`;

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** The viewer's marks on these items. */
export function marksFor(kind: MarkKind, ids: string[], viewer = viewerId()): Map<string, Mark> {
  const out = new Map<string, Mark>();
  if (!viewer || !ids.length) return out;
  const rows = db()
    .prepare(`SELECT item_id, favorite, pinned_at FROM item_marks WHERE user_id = ? AND item_kind = ? AND item_id IN (${marks(ids.length)})`)
    .all(viewer, kind, ...ids) as { item_id: string; favorite: number; pinned_at: number | null }[];
  for (const r of rows) out.set(r.item_id, { favorite: !!r.favorite, pinnedAt: r.pinned_at ?? null });
  return out;
}

/**
 * Set the viewer's favorite or pin on these items (a pin already set keeps its time, so its place). Returns how many
 * were given. Nothing is written for nobody.
 */
export function setMarks(kind: MarkKind, ids: string[], patch: { favorite?: boolean; pinned?: boolean }, now = Date.now(), viewer = viewerId()): number {
  if (!viewer || !ids.length) return 0;
  const upsert = db().prepare(
    `INSERT INTO item_marks (user_id, item_kind, item_id, favorite, pinned_at) VALUES (@user, @kind, @id, @favorite, @pinned)
     ON CONFLICT(user_id, item_kind, item_id) DO UPDATE SET
       favorite = CASE WHEN @setFavorite THEN excluded.favorite ELSE favorite END,
       pinned_at = CASE WHEN @setPinned THEN (CASE WHEN excluded.pinned_at IS NULL THEN NULL ELSE COALESCE(pinned_at, excluded.pinned_at) END) ELSE pinned_at END`,
  );
  const setFavorite = patch.favorite !== undefined ? 1 : 0;
  const setPinned = patch.pinned !== undefined ? 1 : 0;
  db().transaction(() => {
    for (const id of ids) upsert.run({ user: viewer, kind, id, favorite: patch.favorite ? 1 : 0, pinned: patch.pinned ? now : null, setFavorite, setPinned });
    db().prepare(`DELETE FROM item_marks WHERE user_id = ? AND item_kind = ? AND favorite = 0 AND pinned_at IS NULL AND item_id IN (${marks(ids.length)})`).run(viewer, kind, ...ids);
  })();
  return ids.length;
}

/** Forget every mark on items deleted for good. */
export function dropMarks(kind: MarkKind, ids: string[]): void {
  if (ids.length) db().prepare(`DELETE FROM item_marks WHERE item_kind = ? AND item_id IN (${marks(ids.length)})`).run(kind, ...ids);
}
