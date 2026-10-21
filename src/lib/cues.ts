/**
 * Timed text (transcripts, subtitles): the shape transcribe outputs carry in OutputFile.meta.cues,
 * and readers/writers for the formats people paste (JSON cue lists, SRT, WebVTT).
 */

export interface Cue {
  /** Seconds from the start. */
  start: number;
  end: number;
  text: string;
}

const isCue = (c: unknown): c is Cue =>
  !!c && typeof c === "object" && typeof (c as Cue).start === "number" && typeof (c as Cue).end === "number" && typeof (c as Cue).text === "string";

/** "00:01:02,500" / "01:02.500" / "62.5" → seconds. */
function seconds(t: string): number {
  const parts = t.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const TIME = /((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})/;

/** Read a cue list from JSON ([{start, end, text}] or {cues: [...]}), SRT or WebVTT; null for plain text. */
export function parseCues(input: string): Cue[] | null {
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as unknown;
      const list = Array.isArray(j) ? j : (j as { cues?: unknown }).cues;
      if (Array.isArray(list) && list.length && list.every(isCue)) return list.map((c) => ({ start: c.start, end: c.end, text: c.text }));
    } catch {
      // Not JSON: maybe a transcript that starts with a bracket.
    }
    return null;
  }
  if (!TIME.test(s)) return null;
  const cues: Cue[] = [];
  for (const block of s.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIME.test(l));
    if (at < 0) continue;
    const m = TIME.exec(lines[at])!;
    const text = lines
      .slice(at + 1)
      .join("\n")
      .trim();
    if (text) cues.push({ start: seconds(m[1]), end: seconds(m[2]), text });
  }
  return cues.length ? cues : null;
}

const stamp = (t: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms % 1000, 3)}`;
};

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text.trim()}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text.trim()}\n`).join("\n")}`;
}

/** The words alone, one cue per line. */
export const cueText = (cues: Cue[]) => cues.map((c) => c.text.trim()).join("\n");
