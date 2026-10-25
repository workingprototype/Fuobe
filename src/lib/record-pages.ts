/**
 * Pages whose URL names a stored record (/cinema/<id>, /faceless/<channel>/<episode>…), so an
 * unknown id can get a real 404. The page's own notFound() can't send one: the studio's loading
 * skeleton (and with Cache Components, the prerendered shell) has already streamed with a 200 by
 * the time the page looks the id up. The proxy checks first (src/proxy.ts → recordExists in
 * src/server/records.ts) and rewrites unknown ids to the not-found page with a 404.
 * Pure, so the route table is tested without a server.
 */
import { HUB_MODES, type HubKind } from "./hubs";

export type RecordKind = "cinema" | "canvas" | "assist-project" | "layers" | "shorts" | "brand" | "element" | "channel" | "episode" | "explainer" | "series";

/** A record a page needs, with its ids in the order the lookup takes them. */
export interface RecordRef {
  kind: RecordKind;
  ids: string[];
}

const SEG = "([^/]+)";

/** Path patterns → the record they name. Fixed sub-pages (/faceless/<id>/new) come before the catch-alls. */
const PAGES: [RegExp, (m: string[]) => RecordRef][] = [
  [new RegExp(`^/cinema/${SEG}$`), ([id]) => ({ kind: "cinema", ids: [id] })],
  [new RegExp(`^/canvas/${SEG}$`), ([id]) => ({ kind: "canvas", ids: [id] })],
  [new RegExp(`^/assist/projects/${SEG}$`), ([id]) => ({ kind: "assist-project", ids: [id] })],
  [new RegExp(`^/layers/${SEG}$`), ([id]) => ({ kind: "layers", ids: [id] })],
  [new RegExp(`^/shorts/${SEG}$`), ([id]) => ({ kind: "shorts", ids: [id] })],
  [new RegExp(`^/ads/${SEG}$`), ([id]) => ({ kind: "brand", ids: [id] })],
  [new RegExp(`^/elements/${SEG}$`), ([id]) => ({ kind: "element", ids: [id] })],
  [new RegExp(`^/faceless/${SEG}/new$`), ([id]) => ({ kind: "channel", ids: [id] })],
  [new RegExp(`^/faceless/${SEG}/${SEG}$`), ([id, episode]) => ({ kind: "episode", ids: [id, episode] })],
  [new RegExp(`^/faceless/${SEG}$`), ([id]) => ({ kind: "channel", ids: [id] })],
  [new RegExp(`^/explainer/${SEG}$`), ([id]) => ({ kind: "explainer", ids: [id] })],
  [new RegExp(`^/content-factory/${SEG}$`), ([id]) => ({ kind: "series", ids: [id] })],
];

/** Static pages that a record pattern would also match (/ads/multiplier is not a brand). */
const FIXED = new Set(["/ads/multiplier"]);

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The record a page path names (null for every other page). A trailing slash is ignored. */
export function recordForPath(pathname: string): RecordRef | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (FIXED.has(path)) return null;
  for (const [re, ref] of PAGES) {
    const m = re.exec(path);
    if (m) return ref(m.slice(1).map(decode));
  }
  return null;
}

/** /audio/<mode>, /video-tools/<mode> and /upscale/<mode> with a mode the hub doesn't have. */
export function unknownHubMode(pathname: string): boolean {
  const m = /^\/(audio|video-tools|upscale)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return false;
  const mode = decode(m[2]);
  return !HUB_MODES[m[1] as HubKind].some((x) => x.id === mode);
}
