/**
 * Reading what an open OCR model answers (`ocr-lines-qwen35`: OvisOCR3 or a Qwen3.5 checkpoint through
 * ComfyUI's TextGenerate) into Fuobe's OCR output: `OutputFile.text` = the lines, `meta.lines` =
 * `[{text, bbox: [x, y, w, h]}]` as fractions of the image (what Florence-2's cloud route gives too).
 *
 * The models are asked for a bare JSON array `[{"bbox": [x0, y0, x1, y1], "text"}]` with corners scaled
 * to 0–1000, and mostly answer that way. The general Qwen3.5 checkpoints wrap it in ```json fences and
 * use `bbox_2d` / `text_content`; a long answer can stop mid-list at the token limit. All of that reads.
 */

export interface OcrLine {
  text: string;
  /** [x, y, w, h] as 0–1 fractions of the image; absent when the model gave no usable box. */
  bbox?: [number, number, number, number];
}

export interface OcrFrame {
  width?: number;
  height?: number;
  /** "relative-1000" (the default) or "pixels". */
  coords?: string;
}

export interface OcrParse {
  lines: OcrLine[];
  /** False when the answer held no list of lines at all (prose, an error, an empty answer). */
  ok: boolean;
}

const FENCE = /```[a-z]*\s*([\s\S]*?)(?:```|$)/i;

/** The JSON inside an answer: the fenced part when there is one, from the first bracket on. */
function jsonPart(answer: string): string {
  const fenced = FENCE.exec(answer);
  const body = (fenced ? fenced[1] : answer).trim();
  const start = body.search(/[[{]/);
  return start < 0 ? "" : body.slice(start);
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Parse the JSON of an answer, keeping what it finished when it was cut off: a list that stops in the
 * middle of an item keeps the items before it.
 */
function parseLenient(s: string): unknown {
  const whole = tryJson(s);
  if (whole !== undefined) return whole;
  // Text after the JSON ("Here are the lines: [...] Hope this helps").
  const end = s.lastIndexOf("]");
  if (end > 0) {
    const cut = tryJson(s.slice(0, end + 1));
    if (cut !== undefined) return cut;
  }
  // Cut off at the token limit: close the list after the last complete item.
  if (s.startsWith("[")) {
    for (let i = s.lastIndexOf("}"); i > 0; i = s.lastIndexOf("}", i - 1)) {
      const v = tryJson(`${s.slice(0, i + 1)}]`);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const toNum = (v: unknown): number | undefined => (finite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The four corners of a box in any of the shapes the models use: [x0, y0, x1, y1], {x0…} / {x_min…}, or a quad of points. */
function corners(v: unknown): [number, number, number, number] | undefined {
  if (Array.isArray(v)) {
    if (v.length === 4 && v.every((n) => toNum(n) !== undefined)) return v.map((n) => toNum(n)!) as [number, number, number, number];
    // A polygon: [[x, y], …] or a flat [x0, y0, x1, y1, …] of 8 numbers.
    const pts = v.every((p) => Array.isArray(p) && p.length >= 2) ? (v as unknown[][]).map((p) => [toNum(p[0]), toNum(p[1])]) : v.length >= 6 && v.length % 2 === 0 ? Array.from({ length: v.length / 2 }, (_, i) => [toNum(v[2 * i]), toNum(v[2 * i + 1])]) : [];
    if (pts.length >= 3 && pts.every(([x, y]) => x !== undefined && y !== undefined)) {
      const xs = pts.map(([x]) => x!);
      const ys = pts.map(([, y]) => y!);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return undefined;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const x0 = toNum(o.x0 ?? o.x_min ?? o.xmin ?? o.left);
    const y0 = toNum(o.y0 ?? o.y_min ?? o.ymin ?? o.top);
    const x1 = toNum(o.x1 ?? o.x_max ?? o.xmax ?? o.right);
    const y1 = toNum(o.y1 ?? o.y_max ?? o.ymax ?? o.bottom);
    if ([x0, y0, x1, y1].every((n) => n !== undefined)) return [x0!, y0!, x1!, y1!];
  }
  return undefined;
}

const TEXT_KEYS = ["text", "text_content", "content", "label", "words", "transcription"] as const;
const BOX_KEYS = ["bbox", "bbox_2d", "box", "bounding_box", "quad", "polygon", "points"] as const;

/** The list of items in a parsed answer: the array itself, or the first array under a known key. */
function itemsOf(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  for (const k of ["lines", "text_lines", "results", "items", "data", "ocr"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  // A single line on its own.
  return TEXT_KEYS.some((k) => typeof o[k] === "string") ? [o] : undefined;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The size the corners are measured in: 1000 for the relative boxes the instruction asks for, 1 for
 * boxes that are already fractions, the frame's pixels when it says the corners are pixels.
 */
function unitsFor(all: [number, number, number, number][], frame?: OcrFrame): [number, number] {
  const sized = !!frame && finite(frame.width) && finite(frame.height) && frame.width > 0 && frame.height > 0;
  if (sized && frame.coords === "pixels") return [frame.width!, frame.height!];
  const max = Math.max(0, ...all.flat());
  if (max <= 1.0001) return [1, 1];
  // Past 1000 the model answered in the pixels of the picture it saw (older Qwen-VL habits).
  return max > 1000.5 && sized ? [frame.width!, frame.height!] : [1000, 1000];
}

/** A model's OCR answer as lines with 0–1 boxes, in the order it read them. */
export function parseOcrLines(answer: string | null | undefined, frame?: OcrFrame): OcrParse {
  const items = itemsOf(parseLenient(jsonPart(answer ?? "")));
  if (!items) return { lines: [], ok: false };
  const read = items.flatMap((it): { text: string; box?: [number, number, number, number] }[] => {
    if (typeof it === "string") return it.trim() ? [{ text: it.trim() }] : [];
    if (!it || typeof it !== "object") return [];
    const o = it as Record<string, unknown>;
    const key = TEXT_KEYS.find((k) => typeof o[k] === "string");
    const text = key ? (o[key] as string).replace(/\s+/g, " ").trim() : "";
    if (!text) return [];
    const box = BOX_KEYS.map((k) => corners(o[k])).find(Boolean);
    return [{ text, box }];
  });
  const [ux, uy] = unitsFor(
    read.flatMap((l) => (l.box ? [l.box] : [])),
    frame,
  );
  const lines = read.map(({ text, box }): OcrLine => {
    if (!box) return { text };
    // Corners in either order; boxes that reach past the image are kept to it.
    const x0 = clamp01(Math.min(box[0], box[2]) / ux);
    const y0 = clamp01(Math.min(box[1], box[3]) / uy);
    const x1 = clamp01(Math.max(box[0], box[2]) / ux);
    const y1 = clamp01(Math.max(box[1], box[3]) / uy);
    return x1 > x0 && y1 > y0 ? { text, bbox: [r4(x0), r4(y0), r4(x1 - x0), r4(y1 - y0)] } : { text };
  });
  return { lines, ok: true };
}

/** The workflow's second output: the size the model saw, `{"width", "height", "coords"}`. */
export function parseOcrFrame(text: string | null | undefined): OcrFrame | undefined {
  const v = tryJson(jsonPart(text ?? ""));
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const width = toNum(o.width);
  const height = toNum(o.height);
  const coords = typeof o.coords === "string" ? o.coords : undefined;
  if (width === undefined && height === undefined && !coords) return undefined;
  return { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), ...(coords ? { coords } : {}) };
}

/** OutputFile.text of an OCR result: one line per line read. */
export const ocrText = (lines: OcrLine[]): string => lines.map((l) => l.text).join("\n");
