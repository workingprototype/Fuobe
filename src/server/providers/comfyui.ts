import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { tracksFor, type MotionPaths } from "@/lib/motion-paths";
import { nanoid } from "nanoid";
import {
  alphaBBox,
  applyBindings,
  asrLanguage,
  computeDimensions,
  computeFrames,
  expandCaptionWorkflow,
  explainComfyError,
  injectLoras,
  languageName,
  paletteSentence,
  parseCueLines,
  randomSeed,
  splitCueWords,
  swatchPixels,
  type BindingKey,
  type CaptionCue,
  type ComfyWorkflow,
  type Manifest,
  type ManifestOutput,
  type ManifestWorkflow,
} from "@/lib/comfy";
import { guessKind } from "@/lib/catalog/payload";
import type { GenInput, MediaKind, Operation } from "@/lib/catalog/types";
import { getSetting } from "../settings";
import { decodePng, encodePng } from "../png";
import { readRef } from "../storage";
import { ProviderError, type ProviderAdapter, type RemoteOutput } from "./types";

export const WORKFLOW_DIR = path.join(process.cwd(), "workflows", "comfyui");

let manifestCache: { mtime: number; manifest: Manifest } | null = null;

export function loadManifest(): Manifest {
  const file = path.join(WORKFLOW_DIR, "manifest.json");
  if (!fs.existsSync(file)) return { version: 1, generatedAt: "", workflows: [] };
  const mtime = fs.statSync(file).mtimeMs;
  if (!manifestCache || manifestCache.mtime !== mtime) {
    manifestCache = { mtime, manifest: JSON.parse(fs.readFileSync(file, "utf8")) as Manifest };
  }
  return manifestCache.manifest;
}

export function getWorkflow(id: string): { manifest: ManifestWorkflow; workflow: ComfyWorkflow } {
  const manifest = loadManifest().workflows.find((w) => w.id === id);
  if (!manifest) throw new ProviderError(`Workflow "${id}" is not in workflows/comfyui/manifest.json`);
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, manifest.file), "utf8")) as ComfyWorkflow;
  return { manifest, workflow };
}

function baseUrl(): string {
  return getSetting("comfyUrl").replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const t = getSetting("comfyToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function comfyFetch(p: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${p}`, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  } catch (e) {
    throw new ProviderError(`Can't reach ComfyUI at ${baseUrl()} (${(e as Error).message}). Is it running?`);
  }
}

/** GET a ComfyUI JSON endpoint. A non-2xx answer or a body that isn't JSON (a proxy's error page) throws, so the runner retries. */
async function comfyJson<T>(p: string): Promise<T> {
  const res = await comfyFetch(p);
  if (!res.ok) throw new ProviderError(`ComfyUI ${p.split("?")[0]} answered HTTP ${res.status}`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`ComfyUI ${p.split("?")[0]} sent something that isn't JSON (a proxy error page?)`);
  }
}

// ---------------------------------------------------------------------------
// Live progress over the ComfyUI websocket (one connection per server URL).

interface Progress {
  value: number;
  max: number;
  node?: string;
  nodesDone: number;
}

declare global {
  var __fuobeComfyWs: { url: string; ws: WebSocket; clientId: string; progress: Map<string, Progress> } | undefined;
  /** Consecutive polls that found a prompt in neither the queue nor the history. */
  var __fuobeComfyMisses: Map<string, number> | undefined;
}

function ensureSocket(): { clientId: string; progress: Map<string, Progress> } {
  const url = baseUrl();
  const cur = globalThis.__fuobeComfyWs;
  if (cur && cur.url === url && cur.ws.readyState <= 1) return cur;
  const clientId = cur?.clientId ?? `fuobe-${nanoid(8)}`;
  // Same server: keep the progress of prompts in flight. Another server: those prompt ids mean nothing there.
  const progress = cur && cur.url === url ? cur.progress : new Map<string, Progress>();
  if (cur) {
    // A new URL (or a dead socket): close the old connection so it stops writing into the progress map.
    cur.ws.onmessage = null;
    cur.ws.onerror = null;
    try {
      cur.ws.close();
    } catch {}
  }
  try {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames
      try {
        const msg = JSON.parse(ev.data) as { type: string; data: Record<string, unknown> };
        const pid = msg.data?.prompt_id as string | undefined;
        if (!pid) return;
        const p = progress.get(pid) ?? { value: 0, max: 0, nodesDone: 0 };
        if (msg.type === "progress") {
          p.value = Number(msg.data.value);
          p.max = Number(msg.data.max);
          p.node = String(msg.data.node ?? p.node ?? "");
        } else if (msg.type === "executing") {
          if (msg.data.node) {
            p.node = String(msg.data.node);
            p.nodesDone += 1;
            p.value = 0;
            p.max = 0;
          }
        }
        progress.set(pid, p);
      } catch {}
    };
    ws.onerror = () => {};
    globalThis.__fuobeComfyWs = { url, ws, clientId, progress };
  } catch {
    globalThis.__fuobeComfyWs = undefined;
  }
  return { clientId, progress };
}

/** Forget a finished prompt's progress and missed-poll count. */
function forget(promptId: string) {
  globalThis.__fuobeComfyWs?.progress.delete(promptId);
  globalThis.__fuobeComfyMisses?.delete(promptId);
}

// ---------------------------------------------------------------------------
// Outputs

type HistoryFile = { filename: string; subfolder: string; type: string };
type HistoryEntry = {
  prompt?: [number, string, ComfyWorkflow, ...unknown[]];
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
};

/** A provider output that can also carry text (transcripts) and structured extras (cues, layer z/bbox, stems). */
export type ComfyOutput = RemoteOutput & { text?: string; meta?: Record<string, unknown> };

const isFile = (f: unknown): f is HistoryFile =>
  !!f && typeof f === "object" && typeof (f as HistoryFile).filename === "string" && typeof (f as HistoryFile).type === "string";

const MODEL3D_EXT = /\.(glb|gltf|obj|fbx|stl|usdz|ply)$/i;
const TEXT_EXT = /\.(txt|srt|vtt|json|md|csv)$/i;

function kindFor(filename: string, key: string, declared?: MediaKind): MediaKind {
  if (declared) return declared;
  if (MODEL3D_EXT.test(filename) || key === "3d") return "model3d";
  if (TEXT_EXT.test(filename)) return "text";
  return guessKind(filename, undefined, key === "gifs" || key === "videos" ? "video" : key);
}

const CONTENT_TYPES: Record<string, string> = { glb: "model/gltf-binary", gltf: "model/gltf+json", txt: "text/plain", srt: "application/x-subrip", vtt: "text/vtt", json: "application/json" };

function textsOf(ui: Record<string, unknown> | undefined): string[] {
  return Array.isArray(ui?.text) ? (ui.text as unknown[]).filter((t): t is string => typeof t === "string") : [];
}

const dataUrl = (data: Buffer, contentType: string) => `data:${contentType};base64,${data.toString("base64")}`;

/**
 * Every file the prompt saved, declared output nodes first (in manifest order). Text outputs carry their
 * words (`text`) and parsed caption cues (`meta.cues`); a "language" output (PreviewAny) is folded into the
 * text outputs' meta; stems, roles and layer order (`meta.z`, `meta.name`) come from the manifest.
 */
export function collectOutputs(entry: HistoryEntry, manifest: ManifestWorkflow | undefined, base = "", headers: Record<string, string> = {}): ComfyOutput[] {
  const outputs = entry.outputs ?? {};
  const declared = manifest?.outputs ?? [];
  const declaredIds = declared.map((o) => o.node);
  const order = [...declaredIds.filter((id) => outputs[id]), ...Object.keys(outputs).filter((id) => !declaredIds.includes(id))];
  const language = declared
    .filter((o) => o.role === "language")
    .map((o) => textsOf(outputs[o.node])[0]?.trim())
    .find(Boolean);
  const files: ComfyOutput[] = [];
  const pick = (type: string) => {
    for (const nodeId of order) {
      const spec: ManifestOutput | undefined = declared.find((o) => o.node === nodeId);
      if (spec?.role === "language") continue;
      const ui = outputs[nodeId] ?? {};
      const texts = textsOf(ui);
      const found: { key: string; f: HistoryFile }[] = [];
      for (const [key, val] of Object.entries(ui)) {
        if (!Array.isArray(val)) continue;
        for (const f of val) if (isFile(f) && f.type === type) found.push({ key, f });
      }
      // A text output with no file (PreviewAny): keep the words.
      if (!found.length && type === "output" && spec?.kind === "text" && texts.length) {
        const text = texts.join("\n");
        files.push(textOutput({ url: dataUrl(Buffer.from(text), "text/plain"), kind: "text", contentType: "text/plain" }, text, spec, language));
        continue;
      }
      found.forEach(({ key, f }, i) => {
        const kind = kindFor(f.filename, key, spec?.kind);
        const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type });
        const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
        const o: ComfyOutput = { url: `${base}/view?${qs}`, kind, headers, ...(CONTENT_TYPES[ext] && kind !== "image" ? { contentType: CONTENT_TYPES[ext] } : {}) };
        if (kind === "text") {
          files.push(textOutput(o, texts[i] ?? (found.length === 1 ? texts.join("\n") : undefined), spec, language));
          return;
        }
        const meta: Record<string, unknown> = {};
        if (spec?.stem) meta.stem = spec.stem;
        if (spec?.role) meta.role = spec.role;
        // Qwen-Image-Layered saves its layers back to front.
        if (spec?.role === "layers") Object.assign(meta, { z: i, name: i === 0 ? "Background" : `Layer ${i}` });
        if (Object.keys(meta).length) o.meta = meta;
        files.push(o);
      });
    }
  };
  pick("output");
  if (!files.length) pick("temp");
  return files;
}

function textOutput(o: ComfyOutput, text: string | undefined, spec: ManifestOutput | undefined, language: string | undefined): ComfyOutput {
  const meta: Record<string, unknown> = {};
  if (spec?.role) meta.role = spec.role;
  if (text !== undefined) {
    const cues = parseCueLines(text);
    if (cues.length) meta.cues = cues;
  }
  if (language) meta.language = language;
  return { ...o, kind: "text", ...(text !== undefined ? { text } : {}), ...(Object.keys(meta).length ? { meta } : {}) };
}

/** Layers: download each RGBA layer once, add its bounding box (from alpha) and hand the bytes on as a data URL. */
async function withLayerBoxes(outputs: ComfyOutput[]): Promise<ComfyOutput[]> {
  return Promise.all(
    outputs.map(async (o) => {
      if (o.kind !== "image" || typeof o.meta?.z !== "number" || o.url.startsWith("data:")) return o;
      try {
        const res = await fetch(o.url, { headers: o.headers });
        if (!res.ok) return o;
        const data = Buffer.from(await res.arrayBuffer());
        const png = decodePng(data);
        const bbox = alphaBBox(png.data, png.width, png.height);
        return { ...o, url: dataUrl(data, "image/png"), contentType: "image/png", headers: undefined, meta: { ...o.meta, bbox: bbox ?? [0, 0, 0, 0], width: png.width, height: png.height } };
      } catch {
        return o; // keep the layer without a box rather than failing the job
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Reachability. Routing (chooseRoute) is synchronous, so the first check for a server URL is a blocking probe
// (a worker thread does the fetch); after that the cached result is refreshed in the background every 10 s.

declare global {
  var __fuobeComfyReach: { ok: boolean; at: number; url: string } | undefined;
}

export async function probeComfy(force = false): Promise<boolean> {
  const cur = globalThis.__fuobeComfyReach;
  if (!force && cur && cur.url === baseUrl() && Date.now() - cur.at < 10_000) return cur.ok;
  let ok = false;
  try {
    const r = await fetch(`${baseUrl()}/system_stats`, { headers: authHeaders(), signal: AbortSignal.timeout(2000) });
    ok = r.ok;
  } catch {}
  globalThis.__fuobeComfyReach = { ok, at: Date.now(), url: baseUrl() };
  return ok;
}

const PROBE_WORKER = `const { workerData } = require("node:worker_threads");
const flag = new Int32Array(workerData.sab);
fetch(workerData.url, { headers: workerData.headers, signal: AbortSignal.timeout(workerData.timeout) })
  .then((r) => Atomics.store(flag, 0, r.ok ? 1 : 2), () => Atomics.store(flag, 0, 2))
  .finally(() => Atomics.notify(flag, 0));`;

/** Blocking reachability check (a few ms for a refused port, at most `timeoutMs` for a host that doesn't answer). */
export function probeComfySync(timeoutMs = 1500): boolean {
  const url = baseUrl();
  let ok = false;
  try {
    const sab = new SharedArrayBuffer(4);
    const flag = new Int32Array(sab);
    const worker = new Worker(PROBE_WORKER, { eval: true, workerData: { sab, url: `${url}/system_stats`, headers: authHeaders(), timeout: timeoutMs } });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    ok = Atomics.load(flag, 0) === 1;
    void worker.terminate();
  } catch {}
  globalThis.__fuobeComfyReach = { ok, at: Date.now(), url };
  return ok;
}

// ---------------------------------------------------------------------------
// Building the prompt

/** Loader classes whose input is an uploaded file, and which input holds it. */
const MEDIA_LOADERS: Record<string, string> = { LoadImage: "image", LoadImageMask: "image", LoadVideo: "file", VHS_LoadVideo: "video", LoadAudio: "audio", VHS_LoadAudioUpload: "audio" };

const MEDIA_HINT: Record<string, string> = {
  image: "Add an image",
  image2: "Add a second image",
  image3: "Add a third image",
  image4: "Add a fourth image",
  endImage: "Add an end frame",
  mask: "Paint the area to change",
  video: "Add a video",
  video2: "Add a second clip",
  video3: "Add a third clip",
  video4: "Add a fourth clip",
  audio: "Add an audio track",
  audio2: "Add the second audio track",
  paletteImage: "Pick a palette first",
};

/** Binding keys that point at an upload (LoadImage / LoadVideo / LoadAudio…). */
export function mediaKeys(manifest: ManifestWorkflow, workflow: ComfyWorkflow): string[] {
  return Object.entries(manifest.bindings)
    .filter(([, targets]) => targets?.some((t) => MEDIA_LOADERS[workflow[t.node]?.class_type ?? ""] === t.input))
    .map(([k]) => k);
}

const isMediaRef = (v: unknown): v is string => typeof v === "string" && (v.startsWith("/api/files/") || v.startsWith("data:"));

export interface PrepareContext {
  generationId: string;
  op: Operation;
  /** Upload a file to ComfyUI's input folder; returns the name LoadImage/LoadAudio/LoadVideo take. */
  upload: (data: Buffer, contentType: string, name: string) => Promise<string>;
}

export interface PreparedPrompt {
  manifest: ManifestWorkflow;
  workflow: ComfyWorkflow;
  meta: Record<string, unknown>;
}

/** Caption cues for the burn-in: params.extra.cues, or the prompt's "start-end: text" / SRT lines. */
function captionCues(input: GenInput, extra: Record<string, unknown>): CaptionCue[] {
  const given = Array.isArray(extra.cues)
    ? (extra.cues as Partial<CaptionCue>[]).map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text ?? "") })).filter((c) => Number.isFinite(c.start) && c.end > c.start && c.text.trim())
    : parseCueLines(input.prompt);
  return splitCueWords(given, Number(extra.wordsPerCaption ?? 0));
}

/**
 * Turn a canonical request into the exact ComfyUI prompt: picks the workflow variant, maps Fuobe's inputs
 * onto the workflow's bindings (sizes, frames, trim times, languages, palettes, layers…), uploads files the
 * provider makes itself (palette swatches, media refs in params.extra) and rewrites graphs that depend on the
 * request (caption cues). Pure apart from `ctx.upload` and reading the workflow files.
 */
export async function prepareWorkflow(endpointTemplate: string, input: GenInput, ctx: PrepareContext): Promise<PreparedPrompt> {
  // "video-concat-{n}": one workflow per clip count.
  const clips = input.videos ?? [];
  if (endpointTemplate.includes("{n}") && clips.length > 4) throw new ProviderError("ComfyUI joins up to 4 clips at a time");
  let endpoint = endpointTemplate.replace("{n}", String(Math.max(2, Math.min(4, clips.length))));
  const extra: Record<string, unknown> = { ...(input.extra ?? {}) };

  // Media refs in params.extra (e.g. a background stem for "audio2") are uploaded like regular inputs.
  for (const [k, v] of Object.entries(extra)) {
    if (!isMediaRef(v)) continue;
    const f = await readRef(v);
    extra[k] = await ctx.upload(f.data, f.contentType, f.name);
  }
  // Soundtrack without a background stem: the single-track graph.
  if (ctx.op === "mux" && !extra.audio2 && loadManifest().workflows.some((w) => w.id === `${endpoint}-replace`)) endpoint = `${endpoint}-replace`;

  const { manifest, workflow } = getWorkflow(endpoint);
  const d = manifest.defaults;
  const b = manifest.bindings;
  const images = input.images ?? [];
  const values: Partial<Record<BindingKey, unknown>> = {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    image: images[0],
    image2: images[1],
    image3: images[2],
    image4: images[3],
    endImage: input.endImage,
    mask: input.mask,
    video: input.video ?? clips[0],
    video2: clips[1],
    video3: clips[2],
    video4: clips[3],
    audio: input.audio,
    seed: input.seed !== undefined && input.seed >= 0 ? input.seed : randomSeed(),
  };
  // Voice workflows: "audio" is the voice to speak with (TTS), speaker A (dialogue) or the speech to convert
  // (voice change, whose target voice is "audio2").
  if (ctx.op === "tts") values.audio = input.voiceAudio ?? input.audio;
  if (ctx.op === "dialogue") {
    values.audio = input.voiceAudio;
    values.audio2 = input.voiceAudio2;
    values.prompt = (input.dialogue ?? []).filter((l) => l.text.trim()).map((l) => `SPEAKER ${l.voice === "B" ? "B" : "A"}: ${l.text.trim()}`).join("\n");
  }
  if (ctx.op === "voice-change") values.audio2 = input.voiceAudio;
  // Speech workflows read the soundtrack with LoadAudio, which also takes a video upload.
  if ((ctx.op === "transcribe" || ctx.op === "separate-audio" || ctx.op === "translate") && b.audio && !b.video) values.audio = input.audio ?? input.video ?? clips[0];
  if (b.language && input.targetLanguage) values.language = input.targetLanguage;
  if (b.sourceLanguage && input.sourceLanguage) values.sourceLanguage = asrLanguage(input.sourceLanguage);
  if (b.instruction) {
    const template = String(extra.instruction ?? d.instruction ?? "");
    delete extra.instruction;
    if (template.includes("{language}") && !input.targetLanguage) throw new ProviderError("Pick a language to translate into");
    values.instruction = template.replaceAll("{language}", languageName(input.targetLanguage));
  }

  // Frame rate (params.fps, or a model's fps control), trim window and frame counts.
  const fpsIn = input.fps ?? (typeof extra.fps === "number" && extra.fps > 0 ? extra.fps : undefined);
  if (b.fps && fpsIn) values.fps = fpsIn;
  const fps = Number(values.fps ?? d.fps ?? 16);
  const start = Math.max(0, input.startTime ?? 0);
  const window = input.endTime !== undefined ? Math.max(0, input.endTime - start) : input.duration;
  if (b.startTime && input.startTime !== undefined) values.startTime = start;
  if (b.startFrame && input.startTime !== undefined) values.startFrame = Math.round(start * fps);
  if (b.duration) {
    if (input.endTime !== undefined) values.duration = window;
    else if (input.duration) values.duration = input.duration;
    else if (ctx.op === "trim") values.duration = 0; // from the start time to the end
  }
  if (b.width || b.height) {
    const multiple = Number(manifest.limits?.dimensionMultiple ?? 16);
    // With motion paths the frame keeps the start image's shape, so the paths need no cropping.
    const srcAspect = (extra.motionPaths as MotionPaths | undefined)?.aspect;
    const dims = computeDimensions(
      srcAspect ? `${srcAspect[0]}:${srcAspect[1]}` : input.aspectRatio === "auto" ? undefined : input.aspectRatio,
      input.resolution,
      { width: Number(d.width ?? 1024), height: Number(d.height ?? 1024) },
      multiple,
    );
    // Respect the workflow's size limits while keeping the aspect ratio.
    const maxW = Number(manifest.limits?.maxWidth ?? Infinity);
    const maxH = Number(manifest.limits?.maxHeight ?? Infinity);
    const k = Math.min(1, maxW / dims.width, maxH / dims.height);
    values.width = Math.max(multiple, Math.floor((dims.width * k) / multiple) * multiple);
    values.height = Math.max(multiple, Math.floor((dims.height * k) / multiple) * multiple);
  }
  if (b.frames && window) values.frames = computeFrames(window, fps, Number(d.frameStep ?? 4), manifest.limits?.maxFrames);
  // Drawn motion paths (normalised to the start frame) → one pixel point per output frame (Wan-Move).
  const paths = extra.motionPaths as MotionPaths | undefined;
  delete extra.motionPaths;
  if (b.tracks && paths?.paths.length) {
    const frames = Number(values.frames ?? d.frames ?? 81);
    values.tracks = JSON.stringify(tracksFor(paths, Number(values.width ?? d.width ?? 832), Number(values.height ?? d.height ?? 480), frames));
  }
  if (b.tags && !b.prompt) values.tags = input.prompt;
  if (b.description && !extra.description) values.description = input.prompt;
  if (b.numLayers && input.numLayers) values.numLayers = Math.max(1, Math.min(Number(manifest.limits?.maxLayers ?? 10), Math.round(input.numLayers)));

  // Soul HEX: the hex list as words, plus a swatch the ColorTransfer lock matches.
  const palette = (input.palette ?? []).filter((p) => typeof p === "string" && p.trim());
  if (palette.length) {
    const sentence = paletteSentence(palette);
    if (!sentence) throw new ProviderError("The palette has no valid hex colours (use #RRGGBB)");
    if (b.paletteText) values.paletteText = sentence;
    const swatchSlot = b.paletteImage ? "paletteImage" : ctx.op === "color-match" ? (b.image2 && !values.image2 ? "image2" : b.video && b.image && !values.image ? "image" : undefined) : undefined;
    if (swatchSlot) {
      const weights = Array.isArray(extra.paletteWeights) ? (extra.paletteWeights as number[]) : undefined;
      const px = Buffer.from(swatchPixels(palette, 512, 512, weights));
      values[swatchSlot] = await ctx.upload(encodePng({ width: 512, height: 512, data: px }), "image/png", "palette_swatch.png");
    }
  } else if (b.paletteImage && images[0]) values.paletteImage = images[0]; // a swatch the user made
  delete extra.paletteWeights;

  // Trigger words a LoRA needs at the start of the prompt (try-on: "TRYON").
  const prefix = typeof d.promptPrefix === "string" ? d.promptPrefix.trim() : "";
  if (prefix && typeof values.prompt === "string" && values.prompt.trim() && !values.prompt.trim().startsWith(prefix)) values.prompt = `${prefix} ${values.prompt.trim()}`;
  // Framing text defaults with placeholders ("A {columns}x{rows} grid contact sheet of {count} film stills…").
  const columns = Number(extra.columns ?? d.columns ?? 0);
  const rows = Number(extra.rows ?? d.rows ?? 0);
  for (const key of Object.keys(b)) {
    const def = d[key];
    if (typeof def !== "string" || !def.includes("{") || values[key] !== undefined || extra[key] !== undefined) continue;
    values[key] = def.replaceAll("{columns}", String(columns)).replaceAll("{rows}", String(rows)).replaceAll("{count}", String(columns * rows)).replaceAll("{language}", languageName(input.targetLanguage));
  }

  if (b.filenamePrefix) values.filenamePrefix = `fuobe/${ctx.generationId}`;
  const cues = manifest.expand === "captions" ? captionCues(input, extra) : [];
  delete extra.cues;
  delete extra.wordsPerCaption;
  for (const [k, v] of Object.entries(extra)) values[k as BindingKey] = v;

  // Reference slots the user left empty reuse the previous image (style references want all four; a dress
  // is both the top and the bottom of a try-on).
  for (const [k, prev] of [["image2", "image"], ["image3", "image2"], ["image4", "image3"]] as const) {
    if (b[k] && values[k] === undefined && values[prev] !== undefined) values[k] = values[prev];
  }
  for (const k of mediaKeys(manifest, workflow)) {
    if (values[k] === undefined || values[k] === "") throw new ProviderError(`${MEDIA_HINT[k] ?? `Add the ${k} input`} — ${manifest.title.split(":")[0]} needs it`);
  }

  const bound = applyBindings(workflow, b, values);
  if (bound.missing.length) throw new ProviderError(`Workflow ${manifest.id} bindings point at missing nodes: ${bound.missing.join(", ")}`);
  let wf = bound.workflow;
  if (manifest.expand === "captions") {
    if (!cues.length) throw new ProviderError("No timed captions to burn in. Transcribe the clip first, or write lines like “0.00-2.40: Hello there”");
    wf = expandCaptionWorkflow(wf, cues);
  }
  if (input.loras?.length) wf = injectLoras(wf, input.loras);
  const metaBatch = Object.values(wf).some((n) => n.class_type === "VHS_BatchManager");
  return {
    manifest,
    workflow: wf,
    meta: { workflowId: manifest.id, nodeCount: Object.keys(wf).length, prefix: `fuobe/${ctx.generationId}`, ...(metaBatch ? { metaBatch: true } : {}) },
  };
}

/** Friendlier words for errors that a workflow's nodes report in their own terms. */
function explainExecutionError(err: { exception_message?: string; node_type?: string } | undefined, manifest?: ManifestWorkflow): string {
  if (!err) return "Execution error";
  const msg = (err.exception_message ?? "").trim();
  if (manifest?.expand === "captions" && /division by zero|failed to slice video|no frames exist/i.test(msg)) {
    return "A caption starts after the end of the video — check the cue times";
  }
  if (/no audio stream/i.test(msg)) return "That file has no sound to work with";
  return `${err.node_type}: ${msg}`;
}

const promptHasPrefix = (prompt: unknown, prefix: string) =>
  !!prompt && typeof prompt === "object" && Object.values(prompt as ComfyWorkflow).some((n) => n?.inputs?.filename_prefix === prefix);

/**
 * VHS meta-batching re-queues the prompt (new prompt ids) until every frame is done; only the last pass
 * saves the video. Follow the passes by their shared filename prefix.
 */
async function followMetaBatch(prefix: string, manifest: ManifestWorkflow | undefined): Promise<ComfyOutput[] | "running" | null> {
  const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue");
  if ([...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some((q) => promptHasPrefix(q[2], prefix))) return "running";
  const hist = await comfyJson<Record<string, HistoryEntry>>("/history?max_items=64");
  const passes = Object.values(hist)
    .filter((e) => promptHasPrefix(e.prompt?.[2], prefix))
    .sort((a, c) => Number(c.prompt?.[0] ?? 0) - Number(a.prompt?.[0] ?? 0));
  for (const e of passes) {
    const files = collectOutputs(e, manifest, baseUrl(), authHeaders());
    if (files.length) return files;
  }
  return null;
}

export const comfyProvider: ProviderAdapter = {
  id: "comfyui",
  label: "ComfyUI",
  isConfigured: () => {
    const cur = globalThis.__fuobeComfyReach;
    // First check for this server: wait for the answer, so a request right after start isn't sent to demo.
    if (!cur || cur.url !== baseUrl()) return probeComfySync();
    if (Date.now() - cur.at > 10_000) void probeComfy();
    return cur.ok;
  },

  async prepareFile(data, contentType, name) {
    const form = new FormData();
    const ext = name.includes(".") ? name.split(".").pop() : contentType.split("/")[1];
    form.append("image", new Blob([new Uint8Array(data)], { type: contentType }), `fuobe_${nanoid(8)}.${ext}`);
    form.append("type", "input");
    form.append("overwrite", "true");
    const res = await comfyFetch("/upload/image", { method: "POST", body: form });
    if (!res.ok) throw new ProviderError(`ComfyUI upload failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  },

  async submit({ route, input, generationId }) {
    const { manifest, workflow: wf, meta } = await prepareWorkflow(route.endpoint, input, {
      generationId,
      op: route.op,
      upload: (data, contentType, name) => comfyProvider.prepareFile(data, contentType, name),
    });
    const { clientId } = ensureSocket();
    const res = await comfyFetch("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: wf, client_id: clientId }),
    });
    const body = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
    if (!res.ok || !body.prompt_id) {
      const detail = body.node_errors && Object.keys(body.node_errors as object).length ? explainComfyError(body.node_errors, { ...manifest, models: [...manifest.models, ...(input.loras ?? []).map((l) => ({ file: l.file, folder: "loras", url: l.url }))] }) : body.error?.message;
      throw new ProviderError(detail ?? `ComfyUI /prompt failed (${res.status})`, res.status);
    }
    return { externalId: body.prompt_id, meta, payload: wf };
  },

  async poll({ externalId, meta }) {
    let manifest: ManifestWorkflow | undefined;
    try {
      manifest = getWorkflow(String(meta.workflowId)).manifest;
    } catch {}
    const finished = async (entry: HistoryEntry) => {
      if (entry.status?.status_str === "error") {
        forget(externalId);
        const err = entry.status.messages?.find(([t]) => t === "execution_error")?.[1] as { exception_message?: string; node_type?: string } | undefined;
        return { state: "failed" as const, error: explainExecutionError(err, manifest) };
      }
      let outputs = collectOutputs(entry, manifest, baseUrl(), authHeaders());
      if (!outputs.length && meta.metaBatch && typeof meta.prefix === "string") {
        const next = await followMetaBatch(meta.prefix, manifest);
        if (next === "running") return { state: "running" as const, message: "Rendering the next batch of frames" };
        outputs = next ?? [];
      }
      forget(externalId);
      if (!outputs.length) return { state: "failed" as const, error: "Workflow finished without saving any output" };
      return { state: "succeeded" as const, outputs: await withLayerBoxes(outputs) };
    };
    const isDone = (e: HistoryEntry | undefined): e is HistoryEntry => !!e && (!!e.status?.completed || e.status?.status_str === "success" || e.status?.status_str === "error");

    const entry = (await comfyJson<Record<string, HistoryEntry>>(`/history/${externalId}`))[externalId];
    if (isDone(entry)) return finished(entry);

    // Still queued or running?
    const { progress } = ensureSocket();
    const p = progress.get(externalId);
    const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue");
    const running = queue.queue_running?.some((q) => q[1] === externalId);
    const pendingIdx = queue.queue_pending?.findIndex((q) => q[1] === externalId) ?? -1;
    if (!running && pendingIdx < 0 && !entry) {
      // It may have finished between the two requests (ComfyUI moves it from the queue to the history at once).
      const again = (await comfyJson<Record<string, HistoryEntry>>(`/history/${externalId}`))[externalId];
      if (isDone(again)) return finished(again);
      const misses = globalThis.__fuobeComfyMisses ?? (globalThis.__fuobeComfyMisses = new Map());
      const n = (misses.get(externalId) ?? 0) + 1;
      misses.set(externalId, n);
      if (n < 3) return { state: "running", message: "Checking on ComfyUI" };
      forget(externalId);
      return { state: "failed", error: "Prompt disappeared from the ComfyUI queue (server restarted or job was cleared)" };
    }
    globalThis.__fuobeComfyMisses?.delete(externalId);
    if (pendingIdx >= 0) return { state: "queued", message: `In ComfyUI queue · position ${pendingIdx + 1}` };
    const total = Number(meta.nodeCount ?? 0);
    const stepFrac = p && p.max ? p.value / p.max : 0;
    const progressValue = total ? Math.min(0.99, ((p?.nodesDone ?? 0) - 1 + stepFrac) / total) : stepFrac || undefined;
    return {
      state: "running",
      progress: progressValue && progressValue > 0 ? progressValue : undefined,
      message: p?.max ? `Sampling ${p.value}/${p.max}` : "Running on ComfyUI",
    };
  },

  async cancel({ externalId }) {
    forget(externalId);
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [externalId] }),
    }).catch(() => {});
    const q = (await (await comfyFetch("/queue")).json().catch(() => ({}))) as { queue_running?: unknown[][] };
    if (q.queue_running?.some((r) => r[1] === externalId)) {
      await comfyFetch("/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: externalId }),
      }).catch(() => {});
    }
  },

  async test() {
    try {
      const res = await comfyFetch("/system_stats");
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const s = (await res.json()) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
      const dev = s.devices?.[0];
      return {
        ok: true,
        detail: `ComfyUI ${s.system?.comfyui_version ?? ""} · ${dev?.name ?? "unknown device"}${dev?.vram_total ? ` · ${(dev.vram_total / 2 ** 30).toFixed(0)} GB` : ""}`,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },
};

/** Which manifest models are present on the connected ComfyUI server. */
export async function modelInventory(): Promise<Record<string, string[]> | null> {
  try {
    const listed = await comfyFetch("/models");
    const folders = listed.ok ? ((await listed.json()) as string[]) : ["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"];
    const out: Record<string, string[]> = {};
    await Promise.all(
      folders.map(async (f) => {
        const r = await comfyFetch(`/models/${f}`);
        out[f] = r.ok ? ((await r.json()) as string[]) : [];
      }),
    );
    return out;
  } catch {
    return null;
  }
}
