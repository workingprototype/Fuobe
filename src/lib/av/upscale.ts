/**
 * Upscale targets as plain math: a resolution tier names the result's shorter edge (1080p = 1080 px,
 * 4K = 2160 px, whatever the shape), and APIs that take a factor get target ÷ the clip's shorter edge.
 */

/** The shorter edge a tier asks for: "720p" 720, "1080p" 1080, "1440p" / "2K" 1440, "2160p" / "4K" 2160, "8K" 4320. */
export function targetShortEdge(resolution: string | undefined): number | undefined {
  const v = resolution?.trim().toLowerCase();
  if (!v) return undefined;
  const p = /^(\d{3,4})p$/.exec(v);
  if (p) return Number(p[1]);
  const k = /^(\d+(?:\.\d+)?)k$/.exec(v);
  if (!k) return undefined;
  // Marketing "K" tiers: 1K = 1080p, 2K = 1440p, 4K = 2160p, 6K = 3240p, 8K = 4320p.
  const n = Number(k[1]);
  return n === 1 ? 1080 : n === 2 ? 1440 : Math.round(n * 540);
}

/**
 * The factor an upscaler that takes one needs to reach `resolution` from a clip of `source` size: target ÷
 * shorter edge, kept within the API's min–max and rounded to 2 decimals. "Original" is 1 (enhance only).
 * Undefined when the size or the tier is unknown.
 */
export function upscaleFactorFor(resolution: string | undefined, source: { width: number; height: number } | undefined, min = 1, max = 4): number | undefined {
  const lo = Math.min(min, max);
  if (resolution?.trim().toLowerCase() === "original") return Math.max(lo, 1);
  const target = targetShortEdge(resolution);
  const short = source ? Math.min(source.width, source.height) : 0;
  if (!target || !(short > 0)) return undefined;
  return Math.round(Math.max(lo, Math.min(max, target / short)) * 100) / 100;
}

/** The size a clip comes out at for `resolution` (its shape kept, even numbers), or undefined when unknown. */
export function upscaledSize(source: { width: number; height: number } | undefined, resolution: string | undefined, factor?: number): { width: number; height: number } | undefined {
  if (!source?.width || !source.height) return undefined;
  const k = factor ?? (resolution?.trim().toLowerCase() === "original" ? 1 : (targetShortEdge(resolution) ?? 0) / Math.min(source.width, source.height));
  if (!(k > 0)) return undefined;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(source.width * k), height: even(source.height * k) };
}
