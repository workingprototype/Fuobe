/**
 * Motion paths drawn on a start frame (Draw to Video). Stored normalised (0–1) to the image,
 * resampled for Wan-Move as one pixel point per output frame per track.
 */
export interface MotionPaths {
  /** Start image width and height (for its aspect ratio). */
  aspect: [number, number];
  /** Each path is a list of [x, y] in 0–1, in drawing order. */
  paths: [number, number][][];
}

/** Evenly spaced points along a polyline (constant speed over the clip). */
export function resample(path: [number, number][], count: number): [number, number][] {
  if (!path.length) return [];
  if (path.length === 1 || count === 1) return Array.from({ length: count }, () => path[0]);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
    out.push([path[j][0] + (path[j + 1][0] - path[j][0]) * t, path[j][1] + (path[j + 1][1] - path[j][1]) * t]);
  }
  return out;
}

export function tracksFor(m: MotionPaths, width: number, height: number, frames: number): { x: number; y: number }[][] {
  return m.paths
    .filter((p) => p.length)
    .map((p) => resample(p, frames).map(([x, y]) => ({ x: Math.round(x * (width - 1)), y: Math.round(y * (height - 1)) })));
}
