import type { DurationField, EnumField, FieldMap, GenInput, MediaKind, Operation } from "./types";

function enumValue(field: string | EnumField, value: string): [string, unknown] {
  if (typeof field === "string") return [field, value];
  return [field.key, field.values && value in field.values ? field.values[value] : value];
}

/** Path segments that would reach Object.prototype (or a constructor) instead of the payload. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Write `a.b.c` as nested objects (MiniMax's voice_setting.voice_id etc.). Keys come from users
 * (params.extra), so prototype-reaching segments are dropped and only own plain objects are descended into.
 */
function setPath(out: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  if (parts.some((p) => !p || UNSAFE_KEYS.has(p))) return;
  let o = out;
  for (const k of parts.slice(0, -1)) {
    const next = Object.hasOwn(o, k) ? o[k] : undefined;
    if (next === null || typeof next !== "object" || Array.isArray(next)) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]] = value;
}

/** A number of seconds in the API's encoding (seconds or ms, number or "5s"). */
function timeValue(d: DurationField, seconds: number): number | string {
  const v = seconds * (d.multiplier ?? 1);
  return d.type === "number" ? v : `${v}${d.suffix ?? ""}`;
}

/** "#1a2b3c" / "1A2B3C" → {r, g, b}; null for anything else. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

type PaletteFormat = NonNullable<FieldMap["palette"]>["format"];

function colorValue(format: PaletteFormat, rgb: { r: number; g: number; b: number }, hex: string): unknown {
  if (format === "rgb-object") return rgb;
  if (format === "rgb-array") return { rgb: [rgb.r, rgb.g, rgb.b] };
  if (format === "ideogram") return { rgb };
  return `#${hex.replace(/^#/, "").toUpperCase()}`;
}

/**
 * A hex palette in the API's own shape. Ideogram weighs members: earlier colours (the dominant ones
 * in an extracted palette) count more, from 1 down to 0.3.
 */
export function paletteValue(format: PaletteFormat, palette: string[]): unknown {
  const colors = palette.flatMap((hex) => {
    const rgb = hexToRgb(hex);
    return rgb ? [{ hex, rgb }] : [];
  });
  if (format === "ideogram") {
    const n = colors.length;
    return {
      members: colors.map((c, i) => ({ rgb: c.rgb, color_weight: n > 1 ? Math.round((1 - (0.7 * i) / (n - 1)) * 100) / 100 : 1 })),
    };
  }
  return colors.map((c) => colorValue(format, c.rgb, c.hex));
}

/** Build a provider payload from canonical input using a route's {@link FieldMap}. Pure + unit-tested. */
export function buildPayload(map: FieldMap, input: GenInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (map.prompt !== false && input.prompt !== undefined) setPath(out, map.prompt ?? "prompt", input.prompt);
  if (map.negativePrompt && input.negativePrompt) out[map.negativePrompt] = input.negativePrompt;

  const images = input.images ?? [];
  if (map.images && images.length) out[map.images] = images;
  if (map.image && images.length) out[map.image] = images[0];
  if (map.image2 && images.length > 1) out[map.image2] = images[1];
  if (map.endImage && input.endImage) out[map.endImage] = input.endImage;
  if (map.mask && input.mask) out[map.mask] = input.mask;
  if (map.video && input.video) out[map.video] = input.video;
  if (map.videoArray && input.video) out[map.videoArray] = [input.video];
  if (map.videos && input.videos?.length) out[map.videos] = input.videos;
  if (map.audio && input.audio) out[map.audio] = input.audio;

  if (map.aspectRatio && input.aspectRatio) {
    const [k, v] = enumValue(map.aspectRatio, input.aspectRatio);
    out[k] = v;
  }
  if (map.resolution && input.resolution) {
    const [k, v] = enumValue(map.resolution, input.resolution);
    out[k] = v;
  }
  if (map.duration && input.duration !== undefined) out[map.duration.key] = timeValue(map.duration, input.duration);
  if (map.numOutputs && input.numOutputs !== undefined) out[map.numOutputs] = input.numOutputs;
  if (map.seed && input.seed !== undefined && input.seed >= 0) {
    const r = map.seedRange;
    out[map.seed] = r ? r[0] + (input.seed % (r[1] - r[0] + 1)) : input.seed;
  }
  if (map.generateAudio && input.generateAudio !== undefined) {
    const g = map.generateAudio;
    if (typeof g === "string") out[g] = input.generateAudio;
    else out[g.key] = input.generateAudio ? g.on : g.off;
  }

  // Native multi-shot replaces the single prompt with per-shot prompts.
  if (map.multiShot && (input.shots?.length || input.multiShot === "auto")) {
    const ms = map.multiShot;
    if (input.shots?.length) {
      const shots = input.shots.map((s) => ({ prompt: s.prompt, duration: ms.durationType === "string" ? String(s.duration) : s.duration }));
      out[ms.key] = ms.json ? JSON.stringify(shots) : shots;
      if (map.prompt !== false) delete out[map.prompt ?? "prompt"];
      if (ms.shotType) out[ms.shotType] = "customize";
    } else if (ms.shotType) {
      out[ms.shotType] = "intelligent";
    }
    if (ms.flag) out[ms.flag] = true;
  }
  if (map.draft && input.draft) out[map.draft] = true;
  // Voices, dialogue and dubbing.
  if (map.voice && input.voice) setPath(out, map.voice, input.voice);
  if (map.voiceAudio && input.voiceAudio) out[map.voiceAudio] = input.voiceAudio;
  if (map.dialogue && input.dialogue?.length) {
    const d = map.dialogue;
    out[d.key] = input.dialogue.map((l) => ({ [d.text]: l.text, [d.voice]: l.voice ?? input.voice }));
  }
  if (map.targetLanguage && input.targetLanguage) out[map.targetLanguage] = input.targetLanguage;
  if (map.sourceLanguage && input.sourceLanguage) out[map.sourceLanguage] = input.sourceLanguage;
  if (map.draftId && input.draftId) out[map.draftId] = input.draftId;

  // Trims, frame rates, palettes, saved styles and layer counts (research part 3).
  if (map.startTime && input.startTime !== undefined) out[map.startTime.key] = timeValue(map.startTime, input.startTime);
  if (map.endTime && input.endTime !== undefined) out[map.endTime.key] = timeValue(map.endTime, input.endTime);
  if (map.fps && input.fps !== undefined) out[map.fps] = input.fps;
  if (map.styleId && input.styleId) out[map.styleId] = input.styleId;
  if (map.numLayers && input.numLayers !== undefined) out[map.numLayers] = input.numLayers;
  if (map.palette && input.palette?.length) out[map.palette.key] = paletteValue(map.palette.format, input.palette);

  for (const [k, v] of Object.entries({ ...map.fixed, ...input.extra })) setPath(out, k, v);
  // A background colour given as hex goes out in the palette's shape (Recraft wants {r,g,b}).
  const bg = map.palette?.background;
  if (bg && typeof out[bg] === "string") {
    const rgb = hexToRgb(out[bg] as string);
    if (rgb) out[bg] = colorValue(map.palette!.format === "ideogram" ? "rgb-object" : map.palette!.format, rgb, out[bg] as string);
  }
  return out;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|gif)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/i;
const MODEL3D_EXT = /\.(glb|gltf)(\?|$)/i;

export function guessKind(url: string, contentType?: string, hint?: string): MediaKind {
  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("model/") || MODEL3D_EXT.test(url)) return "model3d";
  if (hint && /video/i.test(hint)) return "video";
  if (hint && /audio|speech|music|voice/i.test(hint)) return "audio";
  if (VIDEO_EXT.test(url)) return "video";
  if (AUDIO_EXT.test(url)) return "audio";
  return "image";
}

/**
 * Keys of a response that are request lifecycle links or ids, never results: Higgsfield's RequestStatus
 * carries status_url and cancel_url next to the media, fal's queue receipts carry response_url.
 */
const LIFECYCLE_KEYS = new Set(["status_url", "cancel_url", "response_url", "logs_url", "webhook_url", "request_id"]);
const SKIP_KEYS = new Set(["seed", "timings", "has_nsfw_concepts", "logs", ...LIFECYCLE_KEYS]);

/**
 * Extract media URLs from an arbitrary provider response. Handles the common shapes:
 * {images:[{url}]}, {image:{url}}, {video:{url}}, {audio:{url}}, {audio_file:{url}},
 * {output: "https://..."} and {output: ["https://..."]} (Replicate).
 */
export function extractMedia(response: unknown): { url: string; kind: MediaKind; contentType?: string }[] {
  const found: { url: string; kind: MediaKind; contentType?: string }[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, keyHint: string) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (/^(https?:\/\/|data:(image|video|audio)\/)/.test(node) && !seen.has(node)) {
        // Skip obvious non-media links (docs, logs).
        if (/^https?:\/\//.test(node) && !/\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|ogg|flac|m4a|glb|gltf)(\?|$)/i.test(node) && !/(image|video|audio|output|url|file|media)/i.test(keyHint)) return;
        seen.add(node);
        found.push({ url: node, kind: guessKind(node, undefined, keyHint) });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, keyHint));
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.url === "string" && !seen.has(obj.url)) {
        seen.add(obj.url);
        const ct = typeof obj.content_type === "string" ? obj.content_type : undefined;
        found.push({ url: obj.url, kind: guessKind(obj.url, ct, keyHint), contentType: ct });
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP_KEYS.has(k)) continue;
        visit(v, k);
      }
    }
  };
  visit(response, "output");
  return found;
}

// ---------------------------------------------------------------------------
// Structured results: layers, text blocks, transcripts, 3D models, stems.

/** One result file plus what the API said about it (OutputFile.text / OutputFile.meta). */
export interface ExtractedOutput {
  url: string;
  kind: MediaKind;
  contentType?: string;
  /** Text results (transcripts): the content; `url` is a data:text/plain URI of the same text. */
  text?: string;
  meta?: Record<string, unknown>;
}

/** A transcript line: seconds from the start. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Drop undefined values so stored meta stays small. */
const compact = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** UTF-8 text as a data URI the runner can persist like any other output (works in Node and browsers). */
export function textDataUri(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:text/plain;base64,${btoa(bin)}`;
}

/** A file object ({url, content_type}) or a bare URL string. */
function fileOf(v: unknown): { url: string; contentType?: string } | undefined {
  if (typeof v === "string" && /^(https?:|data:)/.test(v)) return { url: v };
  if (isObj(v) && typeof v.url === "string") return { url: v.url, contentType: str(v.content_type) };
  return undefined;
}

/** Replicate wraps everything in `output`; an object output is the result itself. */
function body(response: unknown): unknown {
  return isObj(response) && Object.keys(response).length === 1 && "output" in response && isObj(response.output) ? response.output : response;
}

/** [left, top, right, bottom] → [x, y, w, h]. */
function ltrbToXywh(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number")) return undefined;
  const [l, t, r, b] = v as number[];
  return [l, t, r - l, b - t];
}

const layerName = (z: number) => (z === 0 ? "Background" : `Layer ${z}`);

/**
 * Seedream layerize: layers[] = base image (z 0) + up to 16 RGBA layers, each with z_index, name,
 * description and bounding_box {absolute, normalized} as [l, t, r, b]. Qwen layered (fal images[],
 * Replicate output[]): full-canvas RGBA layers in stacking order, no names or boxes.
 */
function layerOutputs(response: unknown): ExtractedOutput[] {
  const r = body(response);
  if (isObj(r) && Array.isArray(r.layers)) {
    return r.layers.flatMap((l: unknown, i): ExtractedOutput[] => {
      if (!isObj(l)) return [];
      const f = fileOf(l.image) ?? fileOf(l);
      if (!f) return [];
      const z = num(l.z_index) ?? i;
      const box = isObj(l.bounding_box) ? l.bounding_box : undefined;
      return [
        {
          url: f.url,
          kind: "image",
          contentType: f.contentType,
          meta: compact({ name: str(l.name) ?? layerName(z), z, bbox: ltrbToXywh(box?.absolute), bboxNormalized: ltrbToXywh(box?.normalized), description: str(l.description) }),
        },
      ];
    });
  }
  return extractMedia(response)
    .filter((o) => o.kind === "image")
    .map((o, z) => ({ ...o, meta: { name: layerName(z), z } }));
}

/** All `text` strings under a node, in order (Ideogram's container → items → spans). */
function collectText(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (!isObj(node)) return [];
  if (typeof node.text === "string") return [node.text];
  return Object.values(node).flatMap(collectText);
}

/**
 * Ideogram layerize-text: image = the background with the text removed, text_containers = the text
 * (container → items → spans with positions and typography), text_html = an overlay that re-renders it,
 * image_layers = extracted picture layers.
 */
function textLayerOutputs(response: unknown): ExtractedOutput[] {
  const r = body(response);
  const bg = isObj(r) ? fileOf(r.image) : undefined;
  if (!isObj(r) || !bg) return layerOutputs(response);
  const blocks = (Array.isArray(r.text_containers) ? r.text_containers : []).map((c) => (isObj(c) && typeof c.text !== "string" ? { ...c, text: collectText(c).join(" ").replace(/\s+/g, " ").trim() } : c));
  const out: ExtractedOutput[] = [
    { url: bg.url, kind: "image", contentType: bg.contentType, meta: compact({ name: "Background", z: 0, textBlocks: blocks, textHtml: str(r.text_html) }) },
  ];
  (Array.isArray(r.image_layers) ? r.image_layers : []).forEach((l, i) => {
    const f = fileOf(isObj(l) ? (l.image ?? l) : l);
    if (!f) return;
    const box = isObj(l) && isObj(l.bounding_box) ? l.bounding_box : undefined;
    out.push({
      url: f.url,
      kind: "image",
      contentType: f.contentType,
      meta: compact({ name: (isObj(l) && str(l.name)) || `Image ${i + 1}`, z: i + 1, bbox: ltrbToXywh(box?.absolute) ?? (isObj(l) && Array.isArray(l.bbox) ? l.bbox : undefined) }),
    });
  });
  return out;
}

interface TimedItem {
  text: string;
  start?: number;
  end?: number;
  speaker?: string;
  type?: string;
}

function timed(v: unknown): TimedItem | null {
  if (!isObj(v)) return null;
  const text = str(v.text) ?? str(v.word);
  if (text === undefined) return null;
  const ts = Array.isArray(v.timestamp) ? v.timestamp : undefined;
  return {
    text,
    start: num(v.start) ?? num(ts?.[0]) ?? num(v.start_time),
    end: num(v.end) ?? num(ts?.[1]) ?? num(v.end_time),
    speaker: str(v.speaker_id) ?? str(v.speaker),
    type: str(v.type),
  };
}

const MAX_CUE_CHARS = 64;

/** Word timings → caption-sized cues: break at sentence ends, pauses, speaker changes and ~64 characters. */
export function wordsToCues(words: TimedItem[]): Cue[] {
  const cues: Cue[] = [];
  const push = (c: Cue | null) => {
    if (c && c.text.trim()) cues.push({ ...c, text: c.text.replace(/\s+/g, " ").trim() });
  };
  const join = (text: string, word: string) => `${text}${text && !/\s$/.test(text) && !/^[,.!?;:]/.test(word) ? " " : ""}${word}`;
  let cur: Cue | null = null;
  for (const w of words) {
    if (w.type === "spacing") {
      if (cur) cur.text += w.text || " ";
      continue;
    }
    if (w.start === undefined) {
      if (cur) cur.text = join(cur.text, w.text);
      continue;
    }
    if (cur && (w.speaker !== cur.speaker || w.start - cur.end > 0.8 || cur.text.length + w.text.length > MAX_CUE_CHARS)) {
      push(cur);
      cur = null;
    }
    cur ??= { start: w.start, end: w.end ?? w.start, text: "", ...(w.speaker ? { speaker: w.speaker } : {}) };
    cur.text = join(cur.text, w.text);
    cur.end = w.end ?? cur.end;
    if (/[.!?…]["')\]]?$/.test(w.text.trim())) {
      push(cur);
      cur = null;
    }
  }
  push(cur);
  return cues;
}

/** Segment-level timings (Whisper chunks, WhisperX segments) are cues already; word-level ones are grouped. */
function cuesFrom(r: Obj): Cue[] {
  const words = Array.isArray(r.words) ? r.words.map(timed).filter((w): w is TimedItem => !!w) : [];
  const segs = (["chunks", "segments", "utterances"] as const).flatMap((k) => (Array.isArray(r[k]) ? (r[k] as unknown[]).map(timed).filter((w): w is TimedItem => !!w) : []));
  const items = segs.length ? segs : words;
  if (!items.length) return [];
  const wordLevel = !segs.length || items.every((s) => s.text.trim().split(/\s+/).length <= 1);
  if (wordLevel) return wordsToCues(items);
  return items
    .filter((s) => s.start !== undefined && s.text.trim())
    .map((s, i, all) => ({ start: s.start!, end: s.end ?? all[i + 1]?.start ?? s.start!, text: s.text.trim(), ...(s.speaker ? { speaker: s.speaker } : {}) }));
}

/** The plain-text result of an API that answers with text (transcripts, OCR), or undefined. */
function textOf(response: unknown): string | undefined {
  const r = body(response);
  if (typeof r === "string" && !/^https?:\/\//.test(r)) return r;
  if (!isObj(r)) return undefined;
  for (const k of ["text", "transcription", "transcript"]) if (typeof r[k] === "string") return r[k] as string;
  // Replicate models that stream text return it as an array of string pieces.
  if (Array.isArray(r.output) && r.output.length && r.output.every((x) => typeof x === "string" && !/^https?:\/\//.test(x))) return r.output.join("");
  if (typeof r.output === "string" && !/^(https?:|data:)/.test(r.output)) return r.output;
  return undefined;
}

function transcriptOutputs(response: unknown): ExtractedOutput[] {
  const r = body(response);
  const o: Obj = isObj(r) ? r : {};
  const cues = cuesFrom(o);
  const text = (textOf(response) ?? cues.map((c) => c.text).join(" ")).trim();
  if (!text && !cues.length) return [];
  const languages = (o.languages ?? o.inferred_languages) as unknown;
  const language = str(o.language_code) ?? str(o.language) ?? (Array.isArray(languages) ? str(languages[0]) : undefined);
  return [{ url: textDataUri(text), kind: "text", contentType: "text/plain", text, meta: compact({ cues, language }) }];
}

/**
 * Image-to-3D: the GLB (Hunyuan model_glb, model_urls.glb; Tripo model_mesh; Meshy model_glb), with the
 * other formats and the preview render in meta.
 */
function model3dOutputs(response: unknown): ExtractedOutput[] {
  const r = body(response);
  if (isObj(r)) {
    const urls = isObj(r.model_urls) ? r.model_urls : {};
    const glb = fileOf(r.model_glb) ?? fileOf(urls.glb) ?? fileOf(r.model_mesh) ?? fileOf(r.mesh) ?? fileOf(r.model_file);
    if (glb) {
      const formats = compact(Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, fileOf(v)?.url])));
      const preview = fileOf(r.thumbnail)?.url ?? fileOf(r.rendered_image)?.url ?? fileOf(r.preview)?.url;
      // A GLB was asked for; generic or missing types are labelled as one so it is stored as .glb.
      const contentType = !glb.contentType || glb.contentType === "application/octet-stream" || MODEL3D_EXT.test(glb.url) ? "model/gltf-binary" : glb.contentType;
      return [{ url: glb.url, kind: "model3d", contentType, meta: compact({ preview, formats: Object.keys(formats).length ? formats : undefined }) }];
    }
  }
  const media = extractMedia(response);
  const mesh = media.find((m) => m.kind === "model3d") ?? media.find((m) => /\.(obj|fbx|ply|usdz)(\?|$)/i.test(m.url)) ?? media[0];
  return mesh ? [{ url: mesh.url, kind: "model3d", contentType: MODEL3D_EXT.test(mesh.url) ? "model/gltf-binary" : mesh.contentType }] : [];
}

const STEM_ORDER = ["vocals", "voice", "speech", "target", "drums", "bass", "guitar", "piano", "other", "residual", "accompaniment", "instrumental"];

/** Demucs: {vocals, drums, bass, other, guitar, piano} files; SAM Audio: {target, residual}. Voice first. */
function stemOutputs(response: unknown): ExtractedOutput[] {
  const r = body(response);
  if (!isObj(r)) return extractMedia(response);
  const stems = Object.entries(r).flatMap(([k, v]) => {
    const f = fileOf(v);
    return f && !LIFECYCLE_KEYS.has(k) ? [{ url: f.url, kind: "audio" as const, contentType: f.contentType, meta: { stem: k } }] : [];
  });
  const rank = (s: string) => (STEM_ORDER.indexOf(s) === -1 ? STEM_ORDER.length : STEM_ORDER.indexOf(s));
  return stems.length ? stems.sort((a, b) => rank(a.meta.stem) - rank(b.meta.stem)) : extractMedia(response);
}

/**
 * Every result of a provider response, with structure the operation defines: layers (name, z, bbox),
 * text blocks, transcripts (text + cues), 3D models and audio stems. A response with no media but
 * text comes back as one text output instead of nothing.
 */
export function extractOutputs(response: unknown, op?: Operation): ExtractedOutput[] {
  let out: ExtractedOutput[];
  switch (op) {
    case "layers":
      out = layerOutputs(response);
      break;
    case "text-layers":
      out = textLayerOutputs(response);
      break;
    case "transcribe":
      out = transcriptOutputs(response);
      break;
    case "image-to-3d":
      out = model3dOutputs(response);
      break;
    case "separate-audio":
      out = stemOutputs(response);
      break;
    default:
      out = extractMedia(response);
  }
  // Captions endpoints also return what they transcribed: keep it with the captioned video.
  if (op === "captions" && out.length) {
    const t = transcriptOutputs(response)[0];
    if (t) out = [{ ...out[0], meta: { ...out[0].meta, transcript: t.text, ...(t.meta?.cues ? { cues: t.meta.cues } : {}) } }, ...out.slice(1)];
  }
  if (!out.length) {
    const text = textOf(response)?.trim();
    if (text) out = transcriptOutputs(response);
  }
  const r = body(response);
  if (isObj(r)) {
    // Recraft makes a style from reference images on the fly and returns its id: keep it to reuse the style.
    const styleId = str(r.style_id);
    if (styleId) out = out.map((o) => ({ ...o, meta: { ...o.meta, styleId } }));
    // Cut-out endpoints (Bria extract-object) return the matte next to the image.
    const mask = fileOf(r.mask)?.url;
    if (mask) out = out.map((o) => (o.url === mask ? { ...o, meta: { ...o.meta, role: "mask" } } : o));
  }
  return out;
}
