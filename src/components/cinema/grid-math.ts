/**
 * Cutting a grid contact sheet into its tiles (pure; the browser feeds it canvas pixels).
 *
 * Image models draw the gutters between panels where they like, a few pixels off the even split, so
 * the cut lines are searched near each expected position: a band of rows/columns that is flat (low
 * spread) and near white or black. If an axis has no clear gutters, it falls back to an equal split.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

export interface LineStats {
  /** Mean luminance (0–255) of each line. */
  mean: number[];
  /** Standard deviation of the luminance along each line. */
  std: number[];
}

/** Luminance statistics of every column (axis "x") or row (axis "y") of RGBA pixels. */
export function lineStats(data: Uint8ClampedArray | number[], width: number, height: number, axis: "x" | "y"): LineStats {
  const n = axis === "x" ? width : height;
  const m = axis === "x" ? height : width;
  const mean = new Array<number>(n).fill(0);
  const std = new Array<number>(n).fill(0);
  // Sample at most ~400 pixels per line: plenty to tell a gutter from a picture.
  const step = Math.max(1, Math.floor(m / 400));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (let j = 0; j < m; j += step) {
      const x = axis === "x" ? i : j;
      const y = axis === "x" ? j : i;
      const o = (y * width + x) * 4;
      const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      s += l;
      s2 += l * l;
      c++;
    }
    mean[i] = s / c;
    std[i] = Math.sqrt(Math.max(0, s2 / c - (s / c) ** 2));
  }
  return { mean, std };
}

const isGutter = (st: LineStats, i: number) => st.std[i] < 14 && (st.mean[i] > 215 || st.mean[i] < 30);

/**
 * Where to cut one axis into `parts`: [start, end) spans of the panels, gutters excluded.
 * Returns null when the gutters can't be found (the caller then splits evenly).
 */
export function findCuts(st: LineStats, parts: number): [number, number][] | null {
  const len = st.mean.length;
  if (parts <= 1) return [[0, len]];
  // Outer margin: gutter lines running in from either edge.
  let lo = 0;
  while (lo < len * 0.1 && isGutter(st, lo)) lo++;
  let hi = len;
  while (hi > len * 0.9 && isGutter(st, hi - 1)) hi--;
  const span = hi - lo;
  const bands: [number, number][] = [];
  for (let k = 1; k < parts; k++) {
    const center = lo + Math.round((k * span) / parts);
    const window = Math.max(2, Math.round((span / parts) * 0.18));
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (let i = Math.max(lo + 1, center - window); i <= Math.min(hi - 2, center + window); i++) {
      if (!isGutter(st, i) || (i > 0 && isGutter(st, i - 1) && i - 1 >= center - window)) continue;
      // The whole run of flat lines, even where it starts before the search window.
      let a = i;
      while (a > lo + 1 && isGutter(st, a - 1)) a--;
      let j = i;
      while (j < hi && isGutter(st, j)) j++;
      // A band near the expected spot wins; a wider band beats a stray flat line.
      const mid = (a + j) / 2;
      const score = Math.abs(mid - center) - (j - a) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = [a, j];
      }
    }
    if (!best) return null;
    bands.push(best);
  }
  const spans: [number, number][] = [];
  let start = lo;
  for (const [a, b] of bands) {
    spans.push([start, a]);
    start = b;
  }
  spans.push([start, hi]);
  // Panels of a contact sheet are about the same size: reject wild cuts.
  const sizes = spans.map(([a, b]) => b - a);
  const avg = sizes.reduce((x, y) => x + y, 0) / sizes.length;
  if (sizes.some((s) => s < avg * 0.6 || s > avg * 1.4)) return null;
  return spans;
}

export function equalSpans(len: number, parts: number): [number, number][] {
  return Array.from({ length: parts }, (_, i) => [Math.round((i * len) / parts), Math.round(((i + 1) * len) / parts)] as [number, number]);
}

/** The tile rectangles of a rows × cols sheet, from detected gutters or an equal split. */
export function tileRects(width: number, height: number, rows: number, cols: number, stats?: { x?: LineStats; y?: LineStats }): { rects: Rect[]; detected: boolean } {
  const xs = (stats?.x && findCuts(stats.x, cols)) || null;
  const ys = (stats?.y && findCuts(stats.y, rows)) || null;
  const cx = xs ?? equalSpans(width, cols);
  const cy = ys ?? equalSpans(height, rows);
  const rects: Rect[] = [];
  cy.forEach(([y0, y1], row) => cx.forEach(([x0, x1], col) => rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, row, col })));
  return { rects, detected: !!xs && !!ys };
}
