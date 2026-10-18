/**
 * The arithmetic behind the video trimmer (src/components/studio/video-trimmer.tsx): keeping a
 * selection inside the clip and within a min/max length while one edge or the whole window moves.
 * Pure, so it is shared and tested.
 */

export interface TrimRange {
  startTime: number;
  endTime: number;
}

export interface TrimLimits {
  duration: number;
  /** Shortest selection, in seconds. */
  min?: number;
  /** Longest selection, in seconds. */
  max?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The selection a fresh clip starts with: from the start, as long as allowed. */
export function initialRange(duration: number, max?: number): TrimRange {
  return { startTime: 0, endTime: r2(max ? Math.min(duration, max) : duration) };
}

/**
 * Keep a selection valid after an edit. `edge` says what the user moved: when an edge moves, the
 * other edge stays put and the moved one stops at the clip's ends and at the min/max length;
 * "move" keeps the length and slides the window within the clip.
 */
export function clampRange(r: TrimRange, limits: TrimLimits, edge: "start" | "end" | "move"): TrimRange {
  const d = Math.max(0, limits.duration);
  const min = Math.min(limits.min ?? 0, d);
  const max = Math.max(min, limits.max ?? d);
  let { startTime: s, endTime: e } = r;
  if (edge === "move") {
    const len = clamp(e - s, min, max);
    s = clamp(s, 0, Math.max(0, d - len));
    e = s + len;
  } else if (edge === "start") {
    e = clamp(e, Math.min(min, d), d);
    s = clamp(s, Math.max(0, e - max), Math.max(0, e - min));
  } else {
    s = clamp(s, 0, Math.max(0, d - min));
    e = clamp(e, s + min, Math.min(d, s + max));
  }
  return { startTime: r2(s), endTime: r2(e) };
}

/** Set one edge to a typed value (seconds), keeping the selection valid. */
export function setEdge(r: TrimRange, edge: "start" | "end", value: number, limits: TrimLimits): TrimRange {
  if (!Number.isFinite(value)) return r;
  return clampRange(edge === "start" ? { ...r, startTime: value } : { ...r, endTime: value }, limits, edge);
}

/** Slide the whole selection by `delta` seconds. */
export function moveRange(r: TrimRange, delta: number, limits: TrimLimits): TrimRange {
  return clampRange({ startTime: r.startTime + delta, endTime: r.endTime + delta }, limits, "move");
}

function spoken(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} minute${sec === 60 ? "" : "s"}`;
  return `${Number.isInteger(sec) ? sec : sec.toFixed(1)} second${sec === 1 ? "" : "s"}`;
}

/** What the trimmer asks for: "Select a 10-second segment", "Select up to 2 minutes", or nothing. */
export function trimHint(limits: TrimLimits): string | null {
  const { duration, min, max } = limits;
  if (min && duration < min - 0.05) return `This clip is ${duration.toFixed(1)} s — it needs at least ${spoken(min)}`;
  if (max && duration > max + 0.05) return max % 60 === 0 && max >= 60 ? `Select up to ${spoken(max)}` : `Select a ${Number.isInteger(max) ? max : max.toFixed(1)}-second segment`;
  return null;
}

/** When to grab the filmstrip's frames: the middle of `n` equal slices. */
export function thumbTimes(duration: number, n: number): number[] {
  if (!(duration > 0) || n < 1) return [];
  return Array.from({ length: n }, (_, i) => r2(((i + 0.5) * duration) / n));
}

/** "1:05.3" */
export function clock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}
