/** Slim rows for the Models page: what the table shows, computed on the server from the catalog. */
import { formatCost } from "./format";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef } from "./catalog/types";

export interface ModelRow {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  engine: Engine;
  kind: MediaKind;
  /** Display badges ("New", "Top"…), without the redundant "open". */
  badges: string[];
  /** What it can do, as labels ("Text to image", "Edit"…). */
  ops: string[];
  /** Provider routes ("fal: fal-ai/flux/dev"), shown in the row's details popover. */
  routes: string[];
  price: string;
  /** Where it runs when that's not the obvious place ("Runs on the isolated ComfyUI worker"). */
  note?: string;
}

/** The picker's and the Models page's note on models that run on the isolated ComfyUI worker. */
export const ISOLATED_NOTE = "Runs on the isolated ComfyUI worker";

const BADGE_LABEL: Record<string, string> = {
  new: "New",
  top: "Top",
  fast: "Fast",
  audio: "Audio",
  "4k": "4K",
  hd: "1080p",
  pro: "Pro",
  uncensored: "Uncensored",
  beta: "Beta",
};

export function toModelRow(m: ModelDef): ModelRow {
  return {
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    tagline: m.tagline,
    engine: m.engine,
    kind: m.kind,
    badges: (m.badges ?? []).filter((b) => b !== "open").map((b) => BADGE_LABEL[b] ?? b),
    ops: [...new Set(m.routes.map((r) => OPERATION_LABELS[r.op] ?? r.op))],
    routes: [...new Set(m.routes.map((r) => `${r.provider}: ${r.endpoint}`))],
    price: m.engine === "open" ? "Free" : m.pricing ? `${formatCost(m.pricing.usd)} / ${m.pricing.unit}` : "—",
    ...(m.worker === "isolated" && { note: ISOLATED_NOTE }),
  };
}

/** Lower-cased text the Models search matches against. */
export const modelSearchText = (r: ModelRow) => `${r.name} ${r.vendor} ${r.tagline} ${r.ops.join(" ")} ${r.id}`.toLowerCase();
