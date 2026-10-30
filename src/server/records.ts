import "server-only";
import type { RecordRef } from "@/lib/record-pages";
import type { Actor } from "./access/actor";
import { accessTo, type Kind } from "./access/scope";
import { db } from "./db";

/** The scoped kind, table and id columns behind each kind of record page (the ids are the page's segments, in order). */
const LOOKUPS: Record<RecordRef["kind"], { kind: Kind; sql: string }> = {
  cinema: { kind: "cinema", sql: "SELECT id, workspace_id, created_by FROM cinema_projects WHERE id = ?" },
  canvas: { kind: "canvas", sql: "SELECT id, workspace_id, created_by FROM canvases WHERE id = ?" },
  "assist-project": { kind: "assist-project", sql: "SELECT id, workspace_id, created_by FROM assist_projects WHERE id = ?" },
  layers: { kind: "layers", sql: "SELECT id, workspace_id, created_by FROM layer_projects WHERE id = ?" },
  shorts: { kind: "shorts", sql: "SELECT id, workspace_id, created_by FROM shorts_sessions WHERE id = ?" },
  brand: { kind: "brand", sql: "SELECT id, workspace_id, created_by FROM brand_kits WHERE id = ?" },
  element: { kind: "element", sql: "SELECT id, workspace_id, created_by FROM characters WHERE id = ?" },
  channel: { kind: "channel", sql: "SELECT id, workspace_id, created_by FROM faceless_channels WHERE id = ?" },
  episode: { kind: "episode", sql: "SELECT id, workspace_id, created_by FROM faceless_episodes WHERE channel_id = ? AND id = ?" },
  explainer: { kind: "episode", sql: "SELECT id, workspace_id, created_by FROM faceless_episodes WHERE id = ?" },
  series: { kind: "series", sql: "SELECT id, workspace_id, created_by FROM content_series WHERE id = ?" },
  "swap-project": { kind: "swap-project", sql: "SELECT id, workspace_id, created_by FROM swap_projects WHERE id = ?" },
};

/** What a record page's id names, for this person: a record they can see, one they can't, or nothing at all. */
export type RecordState = "visible" | "hidden" | "missing";

/**
 * Whether the record a page names is stored and visible to `actor` (docs/research/accounts-8.md §7.6: recordVisible
 * replaces recordExists, so a page never tells someone that a record they can't see exists). Used by the proxy, so
 * an unknown or hidden id gets a real 404 before the page's shell streams, and by the pages themselves (notFound()
 * for client-side navigations). A database that can't be read counts as visible: the page then shows its own state
 * rather than a wrong 404, and its API answers for itself.
 */
export function recordState(ref: RecordRef, actor: Actor | null): RecordState {
  try {
    const l = LOOKUPS[ref.kind];
    const row = db().prepare(l.sql).get(...ref.ids) as { id: string; workspace_id: string; created_by: string | null } | undefined;
    if (!row) return "missing";
    if (!actor) return "hidden";
    return accessTo(actor, l.kind, row.id, row).visible ? "visible" : "hidden";
  } catch {
    return "visible";
  }
}

/** Whether the person can see the record a page names. */
export function recordVisible(ref: RecordRef, actor: Actor | null): boolean {
  return recordState(ref, actor) === "visible";
}
