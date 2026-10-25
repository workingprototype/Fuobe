import "server-only";
import type { RecordRef } from "@/lib/record-pages";
import { db } from "./db";

/** The table and id columns behind each kind of record page (the ids are the page's segments, in order). */
const LOOKUPS: Record<RecordRef["kind"], string> = {
  cinema: "SELECT 1 FROM cinema_projects WHERE id = ?",
  canvas: "SELECT 1 FROM canvases WHERE id = ?",
  "assist-project": "SELECT 1 FROM assist_projects WHERE id = ?",
  layers: "SELECT 1 FROM layer_projects WHERE id = ?",
  shorts: "SELECT 1 FROM shorts_sessions WHERE id = ?",
  brand: "SELECT 1 FROM brand_kits WHERE id = ?",
  element: "SELECT 1 FROM characters WHERE id = ?",
  channel: "SELECT 1 FROM faceless_channels WHERE id = ?",
  episode: "SELECT 1 FROM faceless_episodes WHERE channel_id = ? AND id = ?",
  explainer: "SELECT 1 FROM faceless_episodes WHERE id = ?",
  series: "SELECT 1 FROM content_series WHERE id = ?",
};

/**
 * Whether the record a page names is stored (a primary-key lookup). Used by the proxy, so an
 * unknown id gets a real 404 before the page's shell streams, and by the pages themselves
 * (notFound() for client-side navigations). A database that can't be read counts as "exists": the
 * page then shows its own state rather than a wrong 404.
 */
export function recordExists(ref: RecordRef): boolean {
  try {
    return !!db().prepare(LOOKUPS[ref.kind]).get(...ref.ids);
  } catch {
    return true;
  }
}
