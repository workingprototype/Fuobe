import type { Cue } from "@/lib/cues";

/**
 * Editing a cue list (Captions studio, Translate & dub review): pure reducer, so the editor, undo and
 * the tests share one set of rules. Cues stay in time order, never overlap and last at least MIN_CUE.
 */
export const MIN_CUE = 0.2;

export type CueAction =
  | { type: "text"; index: number; text: string }
  /** New start and/or end (seconds), clamped between the neighbours. */
  | { type: "time"; index: number; start?: number; end?: number }
  /** Split at a character offset of the text (at the nearest space); time is shared by the length of each half. */
  | { type: "split"; index: number; caret?: number }
  /** Merge with the next cue. */
  | { type: "merge"; index: number }
  | { type: "remove"; index: number }
  /** A new empty cue after `index` (-1 = at the start), in the gap if there's room. */
  | { type: "insert"; index: number }
  /** Move every cue by `seconds` (an audio offset), never before 0. */
  | { type: "shift"; seconds: number }
  | { type: "reset"; cues: Cue[] };

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Sorted, overlap-free copy with rounded times: what the editor starts from. */
export function normalizeCues(cues: Cue[]): Cue[] {
  const sorted = cues
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) => ({ start: Math.max(0, round(c.start)), end: round(c.end), text: c.text ?? "" }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const next = sorted[i + 1];
    if (next && c.end > next.start) c.end = next.start;
    if (c.end - c.start < MIN_CUE) c.end = round(c.start + MIN_CUE);
    if (next && next.start < c.end) next.start = c.end;
  }
  return sorted;
}

/** Where to split text near `caret`: the closest space, else the middle word boundary. */
function splitText(text: string, caret?: number): [string, string] | null {
  const t = text.trim();
  if (!t.includes(" ")) return null;
  const at = caret === undefined ? t.length / 2 : Math.max(0, Math.min(t.length, caret));
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (best < 0 || Math.abs(i - at) < Math.abs(best - at))) best = i;
  const a = t.slice(0, best).trim();
  const b = t.slice(best + 1).trim();
  return a && b ? [a, b] : null;
}

export function cueReducer(cues: Cue[], a: CueAction): Cue[] {
  if (a.type === "reset") return normalizeCues(a.cues);
  if (a.type === "shift") {
    const first = cues[0]?.start ?? 0;
    const by = Math.max(-first, a.seconds);
    return cues.map((c) => ({ ...c, start: round(c.start + by), end: round(c.end + by) }));
  }
  if (a.type === "insert") {
    const prevEnd = a.index >= 0 ? (cues[a.index]?.end ?? 0) : 0;
    const nextStart = cues[a.index + 1]?.start ?? prevEnd + 2;
    if (nextStart - prevEnd < MIN_CUE) return cues;
    const cue = { start: round(prevEnd), end: round(Math.min(nextStart, prevEnd + 2)), text: "" };
    return [...cues.slice(0, a.index + 1), cue, ...cues.slice(a.index + 1)];
  }
  const c = cues[a.index];
  if (!c) return cues;
  const out = cues.slice();
  switch (a.type) {
    case "text":
      out[a.index] = { ...c, text: a.text };
      return out;
    case "time": {
      const lo = a.index > 0 ? out[a.index - 1].end : 0;
      const hi = out[a.index + 1]?.start ?? Infinity;
      let start = a.start ?? c.start;
      let end = a.end ?? c.end;
      start = Math.max(lo, Math.min(start, hi - MIN_CUE));
      end = Math.min(hi, Math.max(end, start + MIN_CUE));
      if (a.start !== undefined && a.end === undefined && end - start < MIN_CUE) start = end - MIN_CUE;
      out[a.index] = { ...c, start: round(start), end: round(end) };
      return out;
    }
    case "split": {
      const parts = splitText(c.text, a.caret);
      const span = c.end - c.start;
      if (!parts || span < MIN_CUE * 2) return cues;
      const share = parts[0].length / (parts[0].length + parts[1].length);
      const mid = round(Math.min(c.end - MIN_CUE, Math.max(c.start + MIN_CUE, c.start + span * share)));
      out.splice(a.index, 1, { start: c.start, end: mid, text: parts[0] }, { start: mid, end: c.end, text: parts[1] });
      return out;
    }
    case "merge": {
      const next = out[a.index + 1];
      if (!next) return cues;
      out.splice(a.index, 2, { start: c.start, end: next.end, text: [c.text.trim(), next.text.trim()].filter(Boolean).join(" ") });
      return out;
    }
    case "remove":
      out.splice(a.index, 1);
      return out;
  }
  return cues;
}

/** What's wrong with a cue list before it's burned or voiced (empty lines, times past the clip). */
export function cueProblems(cues: Cue[], duration?: number): string[] {
  const problems: string[] = [];
  if (!cues.length) problems.push("There are no lines yet");
  const empty = cues.filter((c) => !c.text.trim()).length;
  if (empty) problems.push(`${empty} empty line${empty === 1 ? "" : "s"}`);
  if (duration && cues.some((c) => c.start >= duration)) problems.push("A line starts after the end of the video");
  return problems;
}

/** "1:02.5" for a time in seconds. */
export function formatCueTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/** Parse "1:02.5", "62.5" or "1:02" back into seconds; null when it isn't a time. */
export function parseCueTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return round(parts.reduce((acc, p) => acc * 60 + Number(p), 0));
}
