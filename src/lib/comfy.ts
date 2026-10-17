/**
 * Pure helpers for ComfyUI API-format workflows: manifest types, binding application,
 * LoRA injection and size/frame math. No I/O here so it is easy to unit test.
 */
import type { LoraRef, MediaKind } from "./catalog/types";

export type ComfyNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ComfyWorkflow = Record<string, ComfyNode>;

export interface BindingTarget {
  node: string;
  input: string;
}

export type BindingKey =
  | "prompt"
  | "negativePrompt"
  | "image"
  | "image2"
  | "image3"
  | "image4"
  | "mask"
  | "endImage"
  | "video"
  | "audio"
  | "width"
  | "height"
  | "frames"
  | "fps"
  | "seed"
  | "steps"
  | "cfg"
  | "guidance"
  | "denoise"
  | "shift"
  | "loraHigh"
  | "loraLow"
  | "lora"
  | "loraStrength"
  | "upscaleModel"
  | "scale"
  | "duration"
  | "lyrics"
  | "tags"
  | (string & {});

export interface ManifestModel {
  file: string;
  folder: string;
  url?: string;
  sizeGb?: number;
}

export interface ManifestOutput {
  node: string;
  kind: MediaKind;
  /** Audio stems of a voice/background separation. */
  stem?: "voice" | "background";
  /** What a text or image output is: timed caption cues, a plain transcript, the detected language, layers, a grid's sheet or tiles… */
  role?: "cues" | "transcript" | "language" | "layers" | "sheet" | "tiles" | "first-frame" | "turntable";
}

export interface ManifestWorkflow {
  id: string;
  title: string;
  capability: string;
  file: string;
  source: string;
  bindings: Partial<Record<BindingKey, BindingTarget[]>>;
  outputs: ManifestOutput[];
  defaults: Record<string, number | string>;
  limits?: Record<string, number>;
  models: ManifestModel[];
  customNodes: { name: string; repo: string }[];
  vramGb?: number | string;
  license?: string;
  /** Node-managed downloads that happen on the first run (not in `models`). */
  autoDownloads?: string[];
  /** "isolated": the node pack has process-wide side effects and runs on a separate ComfyUI. */
  worker?: "isolated";
  /** The provider rewrites the graph before submitting ("captions": one segment per caption cue). */
  expand?: "captions";
  validated: boolean;
  notes?: string;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  comfyuiCommit?: string;
  workflows: ManifestWorkflow[];
}

export function cloneWorkflow(wf: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(wf)) as ComfyWorkflow;
}

/** Write values into the workflow. Unknown nodes are reported, not silently ignored. */
export function applyBindings(
  wf: ComfyWorkflow,
  bindings: ManifestWorkflow["bindings"],
  values: Partial<Record<BindingKey, unknown>>,
): { workflow: ComfyWorkflow; missing: string[] } {
  const out = cloneWorkflow(wf);
  const missing: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const targets = bindings[key as BindingKey];
    if (!targets) continue;
    for (const t of targets) {
      const node = out[t.node];
      if (!node) {
        missing.push(`${key} → node ${t.node}`);
        continue;
      }
      node.inputs[t.input] = value;
    }
  }
  return { workflow: out, missing };
}

const MODEL_LOADERS = new Set(["UNETLoader", "CheckpointLoaderSimple", "UnetLoaderGGUF", "ImageOnlyCheckpointLoader"]);

/**
 * Insert LoraLoaderModelOnly nodes after every diffusion model loader (or only the
 * high/low-noise expert for Wan 2.2 MoE when a LoRA targets one of them) and rewire
 * all consumers of the loader's MODEL output.
 */
export function injectLoras(
  wf: ComfyWorkflow,
  loras: (LoraRef & { target?: "high" | "low" | "both" })[],
): ComfyWorkflow {
  if (!loras.length) return wf;
  const out = cloneWorkflow(wf);
  const loaders = Object.entries(out).filter(([, n]) => MODEL_LOADERS.has(n.class_type));
  let nextId = Math.max(1000, ...Object.keys(out).map((k) => Number(k.split(":").pop()) || 0)) + 1;
  for (const [loaderId, loader] of loaders) {
    const fileName = String(loader.inputs.unet_name ?? loader.inputs.ckpt_name ?? "");
    const expert = /high[_-]?noise/i.test(fileName) ? "high" : /low[_-]?noise/i.test(fileName) ? "low" : "both";
    const applicable = loras.filter((l) => !l.target || l.target === "both" || expert === "both" || l.target === expert);
    if (!applicable.length) continue;
    let upstream: [string, number] = [loaderId, 0];
    const chainIds: string[] = [];
    for (const lora of applicable) {
      const id = String(nextId++);
      out[id] = {
        class_type: "LoraLoaderModelOnly",
        inputs: { model: upstream, lora_name: lora.file, strength_model: lora.strength ?? 1 },
        _meta: { title: `LoRA ${lora.file}` },
      };
      chainIds.push(id);
      upstream = [id, 0];
    }
    for (const [id, node] of Object.entries(out)) {
      if (chainIds.includes(id)) continue;
      for (const [k, v] of Object.entries(node.inputs)) {
        if (Array.isArray(v) && v[0] === loaderId && v[1] === 0) node.inputs[k] = upstream;
      }
    }
  }
  return out;
}

const RES_SHORT_SIDE: Record<string, number> = {
  "360p": 360,
  "480p": 480,
  "540p": 544,
  "580p": 576,
  "720p": 720,
  "768p": 768,
  "1080p": 1088,
};

const RES_AREA: Record<string, number> = {
  "0.5K": 512 * 512,
  "1K": 1024 * 1024,
  "1MP": 1024 * 1024,
  "1.5K": 1536 * 1536,
  "2K": 2048 * 2048,
  "4K": 4096 * 4096,
};

function parseRatio(ar: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

const roundTo = (v: number, m: number) => Math.max(m, Math.round(v / m) * m);

/** Width/height for an aspect ratio, keeping the workflow's default pixel budget unless a resolution tier is given. */
export function computeDimensions(
  aspectRatio: string | undefined,
  resolution: string | undefined,
  defaults: { width?: number; height?: number },
  multiple = 16,
): { width: number; height: number } {
  const dw = Number(defaults.width ?? 1024);
  const dh = Number(defaults.height ?? 1024);
  const ratio = (aspectRatio && parseRatio(aspectRatio)) || dw / dh;
  if (resolution && RES_SHORT_SIDE[resolution]) {
    const short = RES_SHORT_SIDE[resolution];
    return ratio >= 1
      ? { width: roundTo(short * ratio, multiple), height: roundTo(short, multiple) }
      : { width: roundTo(short, multiple), height: roundTo(short / ratio, multiple) };
  }
  const area = (resolution && RES_AREA[resolution]) || dw * dh;
  const height = Math.sqrt(area / ratio);
  return { width: roundTo(height * ratio, multiple), height: roundTo(height, multiple) };
}

/** Frame count for a duration. Wan/Hunyuan want 4n+1, LTX wants 8n+1. */
export function computeFrames(durationSec: number, fps: number, step = 4, maxFrames?: number): number {
  let frames = Math.round((durationSec * fps) / step) * step + 1;
  if (maxFrames) while (frames > maxFrames) frames -= step;
  return Math.max(step + 1, frames);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48);
}

/** Collect every model filename referenced by loader nodes in a workflow. */
export function referencedModels(wf: ComfyWorkflow): string[] {
  const keys = ["unet_name", "ckpt_name", "clip_name", "clip_name1", "clip_name2", "clip_name3", "vae_name", "lora_name", "model_name", "audio_encoder_name", "clip_vision_name"];
  const files = new Set<string>();
  for (const n of Object.values(wf)) {
    for (const k of keys) {
      const v = n.inputs[k];
      if (typeof v === "string" && /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(v)) files.add(v);
    }
  }
  return [...files];
}

/** Turn a ComfyUI validation error into a human sentence with a fix. */
export function explainComfyError(nodeErrors: unknown, manifest?: ManifestWorkflow): string {
  const parts: string[] = [];
  const errs = (nodeErrors ?? {}) as Record<string, { errors?: { message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }[]; class_type?: string }>;
  for (const [nodeId, ne] of Object.entries(errs)) {
    for (const e of ne.errors ?? []) {
      const received = e.extra_info?.received_value;
      if (e.message?.includes("not in list") && typeof received === "string") {
        const m = manifest?.models.find((mm) => mm.file === received);
        parts.push(
          m
            ? `Missing model "${received}" — put it in ComfyUI/models/${m.folder}${m.url ? ` (download: ${m.url})` : ""}`
            : `ComfyUI can't find "${received}" (${ne.class_type ?? nodeId}.${e.extra_info?.input_name ?? "input"})`,
        );
      } else {
        parts.push(`${ne.class_type ?? `node ${nodeId}`}: ${e.message ?? "error"}${e.details ? ` — ${e.details}` : ""}`);
      }
    }
  }
  return [...new Set(parts)].join("\n") || "ComfyUI rejected the workflow";
}

// ---------------------------------------------------------------------------
// Round-3 helpers: caption cues, caption burn-in graphs, languages, palettes, layer bounding boxes.

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

const CUE_LINE = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s?(.*)$/;
const SRT_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

const srtSeconds = (h: string | undefined, m: string, s: string, ms: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;

/**
 * Timed caption cues from text: Qwen3-ASR's "start-end: text" lines (seconds) or SRT / WebVTT blocks.
 * Lines that are neither are ignored; the result is sorted by start time.
 */
export function parseCueLines(input: string | undefined | null): CaptionCue[] {
  if (!input) return [];
  const cues: CaptionCue[] = [];
  const lines = input.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const simple = CUE_LINE.exec(line);
    if (simple) {
      cues.push({ start: Number(simple[1]), end: Number(simple[2]), text: simple[3].trim() });
      continue;
    }
    const srt = SRT_TIME.exec(line);
    if (srt) {
      const text: string[] = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && !SRT_TIME.test(lines[i + 1])) text.push(lines[++i].trim());
      cues.push({ start: srtSeconds(srt[1], srt[2], srt[3], srt[4]), end: srtSeconds(srt[5], srt[6], srt[7], srt[8]), text: text.join(" ") });
    }
  }
  return cues.filter((c) => c.text && Number.isFinite(c.start) && c.end > c.start).sort((a, b) => a.start - b.start);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Split cues into captions of at most `words` words (TikTok style), timed by their share of the characters. */
export function splitCueWords(cues: CaptionCue[], words: number): CaptionCue[] {
  if (!words || words < 1) return cues;
  return cues.flatMap((c) => {
    const w = c.text.split(/\s+/).filter(Boolean);
    if (w.length <= words) return [c];
    const groups: string[] = [];
    for (let i = 0; i < w.length; i += words) groups.push(w.slice(i, i + words).join(" "));
    const total = groups.reduce((n, g) => n + g.length + 1, 0);
    let t = c.start;
    return groups.map((text, i) => {
      const end = i === groups.length - 1 ? c.end : t + ((c.end - c.start) * (text.length + 1)) / total;
      const cue = { start: round3(t), end: round3(end), text };
      t = end;
      return cue;
    });
  });
}

const isLinkValue = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/** BatchImagesNode takes up to 50 images ("images.image0" … "images.image49"); two levels hold 2,500 segments. */
const BATCH_MAX = 50;
export const MAX_CAPTION_SEGMENTS = BATCH_MAX * BATCH_MAX;

/**
 * Rewrite the captions-burnin template for a list of cues: the clip is cut into consecutive Trim Video
 * segments (gaps and cues), each cue segment gets a Draw Text Overlay with the template's style, and the
 * segments are batched back together in order. A segment may not start after the end of the clip, so the
 * last cue runs to the end of the clip.
 */
export function expandCaptionWorkflow(wf: ComfyWorkflow, cues: CaptionCue[]): ComfyWorkflow {
  const out = cloneWorkflow(wf);
  const ids = Object.keys(out);
  const loader = ids.find((id) => out[id].class_type === "LoadVideo");
  const batch = ids.find((id) => out[id].class_type === "BatchImagesNode");
  const template = ids.map((id) => out[id]).find((n) => n.class_type === "TextOverlay");
  if (!loader || !batch || !template) throw new Error("Not a caption burn-in workflow (needs LoadVideo, TextOverlay and BatchImagesNode)");
  const sorted = cues.filter((c) => c.text.trim() && c.end > c.start).sort((a, b) => a.start - b.start);
  if (!sorted.length) throw new Error("No captions to burn in");

  type Segment = { start: number; duration: number; text?: string };
  const segments: Segment[] = [];
  let cursor = 0;
  sorted.forEach((c, i) => {
    let start = round3(Math.max(c.start, cursor, 0));
    if (start - cursor < 0.02) start = round3(cursor); // close gaps shorter than a frame
    const last = i === sorted.length - 1;
    const end = last ? undefined : round3(Math.min(c.end, sorted[i + 1].start));
    if (end !== undefined && end - start < 0.02) return; // swallowed by the next cue
    if (start > cursor) segments.push({ start: round3(cursor), duration: round3(start - cursor) });
    segments.push({ start, duration: end === undefined ? 0 : round3(end - start), text: c.text.trim() });
    if (end !== undefined) cursor = end;
  });
  if (segments.length > MAX_CAPTION_SEGMENTS) throw new Error(`Too many captions (${segments.length} segments, max ${MAX_CAPTION_SEGMENTS})`);

  // Drop the template's segments.
  const sliceIds = new Set(ids.filter((id) => out[id].class_type === "Video Slice"));
  for (const id of ids) {
    const n = out[id];
    const fromSlice = n.class_type === "GetVideoComponents" && isLinkValue(n.inputs.video) && sliceIds.has(n.inputs.video[0]);
    if (sliceIds.has(id) || n.class_type === "TextOverlay" || fromSlice) delete out[id];
  }
  const style = Object.fromEntries(Object.entries(template.inputs).filter(([k]) => k !== "images" && k !== "text"));
  let next = Math.max(1000, ...ids.map((k) => Number(k.split(":").pop()) || 0)) + 1;
  const parts: [string, number][] = segments.map((s, i) => {
    const slice = String(next++);
    const frames = String(next++);
    out[slice] = { class_type: "Video Slice", inputs: { video: [loader, 0], start_time: s.start, duration: s.duration, strict_duration: false }, _meta: { title: `Segment ${i + 1}` } };
    out[frames] = { class_type: "GetVideoComponents", inputs: { video: [slice, 0] }, _meta: { title: `Segment ${i + 1} frames` } };
    if (s.text === undefined) return [frames, 0];
    const overlay = String(next++);
    out[overlay] = { class_type: "TextOverlay", inputs: { ...style, images: [frames, 0], text: s.text }, _meta: { title: `Caption ${i + 1}` } };
    return [overlay, 0];
  });
  const batchNode = (links: [string, number][]): ComfyNode => ({
    class_type: "BatchImagesNode",
    inputs: Object.fromEntries(links.map((l, i) => [`images.image${i}`, l])),
    _meta: { title: "Segments in order" },
  });
  if (parts.length <= BATCH_MAX) out[batch] = batchNode(parts);
  else {
    const groups: [string, number][] = [];
    for (let i = 0; i < parts.length; i += BATCH_MAX) {
      const id = String(next++);
      out[id] = batchNode(parts.slice(i, i + BATCH_MAX));
      groups.push([id, 0]);
    }
    out[batch] = batchNode(groups);
  }
  return out;
}

/** Languages ComfyUI-QwenASR's subtitle node accepts (besides "auto"), by ISO 639 code. */
const ASR_LANGUAGES: Record<string, string> = {
  zh: "Chinese", en: "English", yue: "Cantonese", ar: "Arabic", de: "German", fr: "French", es: "Spanish", pt: "Portuguese",
  id: "Indonesian", it: "Italian", ko: "Korean", ru: "Russian", th: "Thai", vi: "Vietnamese", ja: "Japanese", tr: "Turkish",
  hi: "Hindi", ms: "Malay", nl: "Dutch", sv: "Swedish", da: "Danish", fi: "Finnish", pl: "Polish", cs: "Czech", fil: "Filipino",
  tl: "Filipino", fa: "Persian", el: "Greek", hu: "Hungarian", mk: "Macedonian", ro: "Romanian",
};

const LANGUAGE_NAMES: Record<string, string> = {
  ...ASR_LANGUAGES, he: "Hebrew", no: "Norwegian", nb: "Norwegian", sw: "Swahili", uk: "Ukrainian", bg: "Bulgarian", hr: "Croatian",
  sk: "Slovak", sl: "Slovenian", sr: "Serbian", ca: "Catalan", bn: "Bengali", ta: "Tamil", te: "Telugu", ur: "Urdu",
};

/** The ISO code in "de", "de-DE", "pt_BR" or "German (de)". */
function languageCode(v: string): string | undefined {
  return (/\(([a-z]{2,3})(?:-[A-Za-z]+)?\)\s*$/i.exec(v)?.[1] ?? /^([a-z]{2,3})(?:[-_][A-Za-z]+)?$/i.exec(v)?.[1])?.toLowerCase();
}

/** "de", "German", "German (de)" or "de-DE" → the ASR combo value ("German"); anything unknown → "auto" (detect). */
export function asrLanguage(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (!v || v.toLowerCase() === "auto") return "auto";
  const code = languageCode(v);
  if (code && ASR_LANGUAGES[code]) return ASR_LANGUAGES[code];
  const name = v.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
  return Object.values(ASR_LANGUAGES).find((n) => n.toLowerCase() === name) ?? "auto";
}

/** A language as words for an instruction: "German (de)" → "German", "pt-BR" → "Portuguese", "Klingon" stays. */
export function languageName(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  const code = languageCode(v);
  if (code && LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  return v.replace(/\s*\(.*\)\s*$/, "") || "English";
}

/** "#E4572E" / "e4572e" / "#fff" → [r, g, b], or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** The palette sentence the Soul HEX graph puts after the prompt ("Color palette: #E4572E, #29335C."). */
export function paletteSentence(palette: string[]): string {
  const hexes = palette.map(parseHex).filter((c): c is [number, number, number] => !!c).map(toHex);
  return hexes.length ? `Color palette: ${hexes.join(", ")}.` : "";
}

/**
 * RGBA pixels of a palette swatch: one vertical band per colour, widths proportional to `weights`
 * (equal by default). ColorTransfer matches the colour statistics of this image.
 */
export function swatchPixels(palette: string[], width = 512, height = 512, weights?: number[]): Uint8Array {
  const colors = palette.map(parseHex).filter((c): c is [number, number, number] => !!c);
  if (!colors.length) throw new Error("No valid hex colours in the palette");
  let w = colors.map((_, i) => (weights ? Math.max(0, Number(weights[i]) || 0) : 1));
  if (!w.some((v) => v > 0)) w = colors.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const edges: number[] = [];
  let acc = 0;
  for (const v of w) {
    acc += v / sum;
    edges.push(Math.round(acc * width));
  }
  const px = new Uint8Array(width * height * 4);
  for (let x = 0, band = 0; x < width; x++) {
    while (band < colors.length - 1 && x >= edges[band]) band++;
    const [r, g, b] = colors[band];
    for (let y = 0; y < height; y++) {
      const o = (y * width + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Bounding box [x, y, w, h] of the pixels whose alpha is above `threshold`, or null for an empty layer. */
export function alphaBBox(rgba: Uint8Array, width: number, height: number, threshold = 8): [number, number, number, number] | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}
