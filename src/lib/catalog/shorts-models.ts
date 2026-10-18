/**
 * What the Shorts Studio and Mixed Media restyle models can take, read from their routes (field
 * maps), and slim rows for the pages. Uses the full catalog, so it runs on the server (pages and
 * src/server/shorts.ts, src/server/mixed-media.ts); the browser gets the rows.
 */
import { getModel } from "./index";
import { routesFor } from "./plan";
import { SHORTS } from "./shorts";
import type { Engine, ModelDef } from "./types";

/** How many reference images a restyle model takes on every route (0: it restyles from words only). */
export function maxRefsFor(modelId: string): number {
  const m = getModel(modelId);
  if (!m) return 0;
  if (m.engine === "open") return SHORTS.openReferences;
  const routes = routesFor(m, "v2v");
  if (!routes.length || !routes.every((r) => r.map?.images)) return 0;
  return Math.min(SHORTS.maxReferences, m.options.maxImages ?? 4);
}

/** Whether every v2v route of a cloud model reads an image (LTX: the first frame; Kling, Happy Horse: references). */
export function takesImage(modelId: string): boolean {
  const m = getModel(modelId);
  if (!m || m.engine !== "cloud") return false;
  const routes = routesFor(m, "v2v");
  return routes.length > 0 && routes.every((r) => r.map?.image || r.map?.images);
}

/** Whether every v2v route can be asked for an aspect ratio (else the output keeps the clip's shape). */
export function reframes(modelId: string): boolean {
  const m = getModel(modelId);
  if (!m) return false;
  if (m.engine === "open") return true;
  const routes = routesFor(m, "v2v");
  return routes.length > 0 && routes.every((r) => r.map?.aspectRatio);
}

/** The cloud model's 720p setting, when it has one (Higgsfield renders Shorts at 720p). */
export function resolutionFor(modelId: string): string | undefined {
  const m = getModel(modelId);
  return m?.engine === "cloud" && m.options.resolutions?.includes("720p") ? "720p" : undefined;
}

export interface RestyleModelInfo {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  engine: Engine;
  /** Reference images it takes (0: words only). */
  refs: number;
  /** Takes a still (first frame or style reference). */
  image: boolean;
  /** Can be asked for 9:16 / 16:9. */
  reframes: boolean;
  price: string | null;
  resolutions?: string[];
}

function priceLine(m: ModelDef): string | null {
  if (m.engine === "open") return "Free · your GPU";
  const p = m.pricing;
  if (!p) return null;
  const usd = p.usd < 0.1 ? p.usd.toFixed(3).replace(/0$/, "") : p.usd.toFixed(2);
  return `$${usd} / ${p.unit === "second" ? "s" : p.unit}`;
}

/** Slim model rows for a studio page (so the browser needs no catalog). */
export function modelInfos(ids: string[]): RestyleModelInfo[] {
  return ids.flatMap((id) => {
    const m = getModel(id);
    if (!m) return [];
    return [
      {
        id,
        name: m.name,
        vendor: m.vendor,
        tagline: m.tagline,
        engine: m.engine,
        refs: maxRefsFor(id),
        image: takesImage(id),
        reframes: reframes(id),
        price: priceLine(m),
        ...(m.options.resolutions ? { resolutions: m.options.resolutions } : {}),
      },
    ];
  });
}
