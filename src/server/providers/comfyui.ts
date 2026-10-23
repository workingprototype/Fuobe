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
  bypassReference,
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
  whisperLanguage,
  type BindingKey,
  type CaptionCue,
  type ComfyWorkflow,
  type Manifest,
  type ManifestOutput,
  type ManifestWorkflow,
} from "@/lib/comfy";
import { expandTimelineWorkflow, readTimeline } from "@/lib/av/timeline";
import { guessKind } from "@/lib/catalog/payload";
import { CLICK_OPEN_PROBLEM, HAND_OFF, REMOVE_SCENE, targetPhrase } from "@/lib/catalog/remove-object";
import type { GenInput, MediaKind, ModelRoute, Operation } from "@/lib/catalog/types";
import { probeMedia, type MediaInfo } from "@/lib/media-probe";
import { ocrText, parseOcrFrame, parseOcrLines, type OcrFrame } from "@/lib/ocr";
import { getSetting, isCandidate, savedSetting } from "../settings";
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

/**
 * Which ComfyUI runs a workflow: the main server, or the isolated worker — a second ComfyUI with its own
 * code copy and virtualenv for node packs that change process-wide state or pin old packages (LatentSync
 * 1.6, ThinkSound; manifest `worker: "isolated"`, scripts/comfy/README.md). Both take the same token.
 */
export type ComfyWorker = "main" | "isolated";

/** Where the isolated worker's address is set, for messages. */
export const ISOLATED_SETTING = "Settings → Open-source engine · ComfyUI → Isolated worker URL";

function baseUrl(worker: ComfyWorker = "main"): string {
  return getSetting(worker === "isolated" ? "comfyIsolatedUrl" : "comfyUrl").replace(/\/+$/, "");
}

/** The worker a workflow runs on. */
export function workerFor(endpoint: string | undefined): ComfyWorker {
  return endpoint && loadManifest().workflows.find((w) => w.id === endpoint)?.worker === "isolated" ? "isolated" : "main";
}

/** A ComfyUI address as compared: no trailing slash. */
const sameAddress = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

function authHeaders(worker: ComfyWorker = "main"): Record<string, string> {
  // Save & test of an address that isn't the saved one: the saved token stays with the server it
  // was saved for. Only a token typed for this test goes to the new address.
  const address = worker === "isolated" ? "comfyIsolatedUrl" : "comfyUrl";
  if (isCandidate(address) && !isCandidate("comfyToken") && !sameAddress(getSetting(address), savedSetting(address))) return {};
  const t = getSetting("comfyToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function comfyFetch(p: string, init: RequestInit = {}, worker: ComfyWorker = "main"): Promise<Response> {
  const base = baseUrl(worker);
  if (worker === "isolated" && !base) {
    throw new ProviderError(`This model runs on the isolated ComfyUI worker, which isn't set up yet: add its address in ${ISOLATED_SETTING} (or COMFYUI_ISOLATED_URL). scripts/comfy/README.md shows how to start one, usually on port 8189`);
  }
  try {
    return await fetch(`${base}${p}`, { ...init, headers: { ...authHeaders(worker), ...(init.headers ?? {}) } });
  } catch (e) {
    if (worker === "isolated") throw new ProviderError(`The isolated ComfyUI worker at ${base} doesn't answer (${(e as Error).message}). Start it (scripts/comfy/README.md) or check ${ISOLATED_SETTING}`);
    throw new ProviderError(`Can't reach ComfyUI at ${base} (${(e as Error).message}). Is it running?`);
  }
}

/**
 * The isolated worker answered, but not with what was asked (an HTTP error, or a proxy's error page
 * when the worker behind it is down): say it's that server and where its address is set, so it doesn't
 * read like the main ComfyUI failed.
 */
function isolatedAnswer(what: string, status?: number, detail?: string): ProviderError {
  const said = status ? `HTTP ${status}` : "something that isn't JSON";
  return new ProviderError(
    `The isolated ComfyUI worker at ${baseUrl("isolated")} answered ${said} to ${what}${detail ? ` (${detail})` : ""} — check that it's running (scripts/comfy/README.md) and its address in ${ISOLATED_SETTING}`,
    status,
  );
}

/** A short reason from an error body: its text, unless it's an HTML error page. */
const reasonOf = (text: string) => (/^\s*</.test(text) ? "" : text.trim().slice(0, 200));

/** GET a ComfyUI JSON endpoint. A non-2xx answer or a body that isn't JSON (a proxy's error page) throws, so the runner retries. */
async function comfyJson<T>(p: string, worker: ComfyWorker = "main"): Promise<T> {
  const res = await comfyFetch(p, {}, worker);
  const path = p.split("?")[0];
  if (!res.ok) throw worker === "isolated" ? isolatedAnswer(path, res.status) : new ProviderError(`ComfyUI ${path} answered HTTP ${res.status}`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw worker === "isolated" ? isolatedAnswer(path) : new ProviderError(`ComfyUI ${path} sent something that isn't JSON (a proxy error page?)`);
  }
}

// ---------------------------------------------------------------------------
// Live progress over the ComfyUI websocket (one connection per worker, reopened when its URL changes).

interface Progress {
  value: number;
  max: number;
  node?: string;
  nodesDone: number;
}

type ComfySocket = { url: string; ws: WebSocket; clientId: string; progress: Map<string, Progress> };

declare global {
  var __fuobeComfyWs: ComfySocket | undefined;
  /** The isolated worker's socket. */
  var __fuobeComfyWsIsolated: ComfySocket | undefined;
  /** Consecutive polls that found a prompt in neither the queue nor the history. */
  var __fuobeComfyMisses: Map<string, number> | undefined;
}

const socketOf = (worker: ComfyWorker) => (worker === "isolated" ? globalThis.__fuobeComfyWsIsolated : globalThis.__fuobeComfyWs);
function setSocket(worker: ComfyWorker, s: ComfySocket | undefined) {
  if (worker === "isolated") globalThis.__fuobeComfyWsIsolated = s;
  else globalThis.__fuobeComfyWs = s;
}

function ensureSocket(worker: ComfyWorker = "main"): { clientId: string; progress: Map<string, Progress> } {
  const url = baseUrl(worker);
  const cur = socketOf(worker);
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
    setSocket(worker, { url, ws, clientId, progress });
  } catch {
    setSocket(worker, undefined);
  }
  return { clientId, progress };
}

/** Forget a finished prompt's progress and missed-poll count. */
function forget(promptId: string) {
  globalThis.__fuobeComfyWs?.progress.delete(promptId);
  globalThis.__fuobeComfyWsIsolated?.progress.delete(promptId);
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
  // OCR: the size the model saw (a PreviewAny "frame") goes with the lines it read.
  const frame = declared
    .filter((o) => o.role === "frame")
    .map((o) => parseOcrFrame(textsOf(outputs[o.node]).join("\n")))
    .find(Boolean);
  const files: ComfyOutput[] = [];
  const pick = (type: string) => {
    for (const nodeId of order) {
      const spec: ManifestOutput | undefined = declared.find((o) => o.node === nodeId);
      if (spec?.role === "language" || spec?.role === "frame") continue;
      const ui = outputs[nodeId] ?? {};
      const texts = textsOf(ui);
      const found: { key: string; f: HistoryFile }[] = [];
      for (const [key, val] of Object.entries(ui)) {
        if (!Array.isArray(val)) continue;
        for (const f of val) if (isFile(f) && f.type === type) found.push({ key, f });
      }
      // OCR lines (SaveText .json): the model's answer, read into lines with boxes.
      if (spec?.role === "lines" && texts.length) {
        if (type === "output") files.push(ocrOutput(texts.join("\n"), frame));
        continue;
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

/**
 * An OCR answer as Fuobe's OCR output (the shape Florence-2's cloud route gives): the lines as plain
 * text, `meta.lines` [{text, bbox: [x, y, w, h] 0–1}] and `meta.size`, the picture the model read. An
 * answer with no list in it keeps its words, with no lines and `meta.unreadable`.
 */
function ocrOutput(answer: string, frame: OcrFrame | undefined): ComfyOutput {
  const { lines, ok } = parseOcrLines(answer, frame);
  const text = ok ? ocrText(lines) : answer.trim();
  const size = frame?.width && frame.height ? [frame.width, frame.height] : undefined;
  return { url: dataUrl(Buffer.from(text), "text/plain"), kind: "text", contentType: "text/plain", text, meta: { lines, ...(size ? { size } : {}), ...(ok ? {} : { unreadable: true }) } };
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

// What we learned about each uploaded clip / track from its header (duration, size, fps, audio), by ComfyUI file name.
declare global {
  var __fuobeComfyMedia: Map<string, MediaInfo> | undefined;
}
const MEDIA_FILE = /^(video|audio)\//;
const MEDIA_EXT = /\.(mp4|m4v|mov|m4a|wav|flac|mp3)$/i;

function rememberMedia(name: string, info: MediaInfo) {
  const seen = (globalThis.__fuobeComfyMedia ??= new Map());
  seen.set(name, info);
  if (seen.size > 256) seen.delete(seen.keys().next().value!);
}

/** The header facts of a file this server uploaded to ComfyUI (undefined for images and unreadable containers). */
export function mediaInfoFor(name: unknown): MediaInfo | undefined {
  return typeof name === "string" ? globalThis.__fuobeComfyMedia?.get(name) : undefined;
}

/** Inputs a workflow handles its own way (the manifest doesn't say). */
const SLOT_RULES: Record<string, { reuse?: boolean; required?: string[]; hints?: Record<string, string> }> = {
  // Edit graphs whose extra images feed TextEncodeQwenImageEditPlus: a repeated reference is harmless.
  "qwen-image-edit-2511-multi": { reuse: true },
  "storyboard-qwen-edit-2509-next-scene": { reuse: true },
  "tryon-flux2-klein-4b": { required: ["image2"], hints: { image: "Add a photo of the person", image2: "Add the garment to try on" } },
  "palette-transfer-image": { hints: { image2: "Pick a palette or add a reference image" } },
  "palette-transfer-video": { hints: { image: "Pick a palette or add a reference image" } },
  "relight-qwen-edit-2509-reference": { hints: { image2: "Add the photo whose light to copy" } },
  "face-swap-reactor": { hints: { image2: "Add the face to put in" } },
};

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
  /** Header facts (duration, size, fps, audio track) of an uploaded clip or track, by its ComfyUI name. */
  media?: (name: string) => MediaInfo | undefined;
  /** The ComfyUI server's RAM in bytes, for graphs that hold a whole clip in memory. */
  serverRam?: () => Promise<number | undefined>;
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

const seconds = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
const GB = 2 ** 30;

/**
 * Turn a canonical request into the exact ComfyUI prompt: picks the workflow variant, maps Fuobe's inputs
 * onto the workflow's bindings (sizes, frames, trim times, languages, palettes, layers…), uploads files the
 * provider makes itself (palette swatches, media refs in params.extra) and rewrites graphs that depend on the
 * request (caption cues, left-out references). What the uploads' headers say (`ctx.media`) sizes clips to
 * their source, checks times against the clip's length and times lip re-sync by the voice. Pure apart from
 * `ctx.upload` / `ctx.serverRam` and reading the workflow files.
 */
export async function prepareWorkflow(endpointTemplate: string, input: GenInput, ctx: PrepareContext): Promise<PreparedPrompt> {
  // "video-concat-{n}": one workflow per clip count.
  const clips = input.videos ?? [];
  if (endpointTemplate.includes("{n}") && clips.length > 4) throw new ProviderError("ComfyUI joins up to 4 clips at a time");
  let endpoint = endpointTemplate.replace("{n}", String(Math.max(2, Math.min(4, clips.length))));
  const extra: Record<string, unknown> = { ...(input.extra ?? {}) };
  // The second audio track (mux background): the canonical input when the runtime sends it, else params.extra.audio2.
  const given2 = (input as GenInput & { audio2?: unknown }).audio2;
  const audio2 = typeof given2 === "string" && given2 ? given2 : undefined;
  if (audio2) delete extra.audio2;

  // Media refs in params.extra (e.g. a background stem for "audio2") are uploaded like regular inputs.
  for (const [k, v] of Object.entries(extra)) {
    if (!isMediaRef(v)) continue;
    const f = await readRef(v);
    extra[k] = await ctx.upload(f.data, f.contentType, f.name);
  }
  // Soundtrack without a background stem: the single-track graph.
  if (ctx.op === "mux" && !audio2 && !extra.audio2 && loadManifest().workflows.some((w) => w.id === `${endpoint}-replace`)) endpoint = `${endpoint}-replace`;

  const { manifest, workflow } = getWorkflow(endpoint);
  const d = manifest.defaults;
  const b = manifest.bindings;
  const rules = SLOT_RULES[manifest.id] ?? {};
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
  // A voice track on the video's timeline: the clips are the spoken lines (the template binds the first).
  if (ctx.op === "timeline") values.audio = input.audios?.[0] ?? input.audio;
  // Speech workflows read the soundtrack with LoadAudio, which also takes a video upload.
  if ((ctx.op === "transcribe" || ctx.op === "separate-audio" || ctx.op === "translate") && b.audio && !b.video) values.audio = input.audio ?? input.video ?? clips[0];
  if (b.language && input.targetLanguage) values.language = input.targetLanguage;
  if (b.sourceLanguage && input.sourceLanguage) {
    const whisper = b.sourceLanguage.some((t) => workflow[t.node]?.class_type === "Apply Whisper");
    values.sourceLanguage = whisper ? whisperLanguage(input.sourceLanguage) : asrLanguage(input.sourceLanguage);
  }
  if (b.instruction) {
    const template = String(extra.instruction ?? d.instruction ?? "");
    delete extra.instruction;
    if (template.includes("{language}") && !input.targetLanguage) throw new ProviderError("Pick a language to translate into");
    values.instruction = template.replaceAll("{language}", languageName(input.targetLanguage));
  }

  // What the upload headers say about the clip (and the voice).
  const clip = ctx.media?.(String(values.video ?? ""));
  const clipLength = clip?.videoDuration ?? clip?.duration;

  // Frame rate (params.fps, or a model's fps control), trim window and frame counts.
  const fpsIn = input.fps ?? (typeof extra.fps === "number" && extra.fps > 0 ? extra.fps : undefined);
  if (b.fps && fpsIn) values.fps = fpsIn;
  const fps = Number(values.fps ?? d.fps ?? 16);
  const start = Math.max(0, input.startTime ?? 0);
  if (b.startTime || b.startFrame) {
    if (input.endTime !== undefined && input.endTime <= start) throw new ProviderError("The end time must be after the start time");
    if (clipLength && start >= clipLength) throw new ProviderError(`The start time is past the end of the clip (it is ${seconds(clipLength)} s long)`);
  }
  // Sound for a video with no length asked for: as long as the clip (up to 30 s, and what the frame cap holds).
  const soundLength =
    ctx.op === "v2a" && b.duration && input.endTime === undefined && !input.duration && clipLength
      ? Math.min(30, Number(manifest.limits?.maxFrames ?? Infinity) / fps, Math.ceil(clipLength * 10) / 10)
      : undefined;
  const span = input.endTime !== undefined ? Math.max(0, input.endTime - start) : (input.duration ?? soundLength);
  if (b.startTime && input.startTime !== undefined) values.startTime = start;
  if (b.startFrame && input.startTime !== undefined) values.startFrame = Math.round(start * fps);
  if (b.duration) {
    if (input.endTime !== undefined) values.duration = span;
    else if (input.duration) values.duration = input.duration;
    else if (soundLength) values.duration = soundLength;
    else if (ctx.op === "trim") values.duration = 0; // from the start time to the end
  }
  if (b.width || b.height) {
    const multiple = Number(manifest.limits?.dimensionMultiple ?? 16);
    // With motion paths the frame keeps the start image's shape, so the paths need no cropping;
    // "auto" keeps the source clip's shape when its header told us.
    const srcAspect = (extra.motionPaths as MotionPaths | undefined)?.aspect;
    const shape = srcAspect ? `${srcAspect[0]}:${srcAspect[1]}` : input.aspectRatio === "auto" ? (clip?.width && clip.height ? `${clip.width}:${clip.height}` : undefined) : input.aspectRatio;
    const dims = computeDimensions(shape, input.resolution, { width: Number(d.width ?? 1024), height: Number(d.height ?? 1024) }, multiple);
    // Respect the workflow's size limits while keeping the aspect ratio.
    const maxW = Number(manifest.limits?.maxWidth ?? Infinity);
    const maxH = Number(manifest.limits?.maxHeight ?? Infinity);
    const k = Math.min(1, maxW / dims.width, maxH / dims.height);
    values.width = Math.max(multiple, Math.floor((dims.width * k) / multiple) * multiple);
    values.height = Math.max(multiple, Math.floor((dims.height * k) / multiple) * multiple);
  }
  if (b.frames && span) values.frames = computeFrames(span, fps, Number(d.frameStep ?? 4), manifest.limits?.maxFrames);
  // Lip re-sync runs as long as the new voice; a voice past the frame cap is refused, not cut.
  const voiceLength = ctx.op === "lipsync" && b.frames && !span ? ctx.media?.(String(values.audio ?? ""))?.duration : undefined;
  if (voiceLength) {
    const step = Number(d.frameStep ?? 4);
    const frames = Math.ceil((voiceLength * fps) / step) * step + 1;
    const cap = Number(manifest.limits?.maxFrames ?? 0);
    if (cap && frames > cap) {
      throw new ProviderError(`Lip re-sync on the open engine takes up to ${seconds(cap / fps)} s of speech per job (this voice is ${seconds(voiceLength)} s) — split it into shorter parts`);
    }
    values.frames = frames;
  }
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

  // Remove object: the words name what SAM 3.1 follows (maskPrompt: the objects alone, comma-separated, each its own
  // SAM 3 prompt, so "Remove the red car from the shot" run straight from a Canvas works too) and the gap is filled
  // with the scene without it (params.extra.prompt, else a neutral default). No graph takes clicked points.
  // The painted eraser's last tracked mask (role "mask") is saved only for a window another one waits on.
  const handOff = ctx.op === "remove-object" && extra[HAND_OFF] === true;
  delete extra[HAND_OFF];
  if (ctx.op === "remove-object") {
    const words = input.prompt?.trim();
    if (b.maskPrompt) {
      if (!words && typeof extra.maskPrompt !== "string") throw new ProviderError(input.points?.length ? CLICK_OPEN_PROBLEM : "Say what to remove, e.g. “the coffee cup in her hand”");
      if (words) values.maskPrompt = targetPhrase(words);
    }
    if (b.prompt) values.prompt = REMOVE_SCENE;
  }
  // Depth maps: Video Depth Anything draws gray or inferno (the other graphs grayscale only), and can put the
  // original clip next to the map.
  if (ctx.op === "depth-video" && input.colormap) {
    const want = input.colormap.toLowerCase() === "grayscale" ? "gray" : input.colormap.toLowerCase();
    if (b.colormap && (want === "gray" || want === "inferno")) values.colormap = want;
    else if (want !== "gray") throw new ProviderError(b.colormap ? "The open engine's depth maps come in grayscale or inferno — turbo, magma and viridis are on the cloud" : "This depth model makes grayscale maps only — pick Video Depth Anything for inferno");
  }
  if (b.sideBySide && input.sideBySide !== undefined) values.sideBySide = input.sideBySide;
  // Matte graphs save a cut-out and a black-and-white matte: params.matteOutput keeps one.
  const keepRole: string | undefined = ctx.op === "bg-remove-video" ? input.matteOutput : undefined;

  if (b.filenamePrefix) values.filenamePrefix = `fuobe/${ctx.generationId}`;
  const cues = manifest.expand === "captions" ? captionCues(input, extra) : [];
  delete extra.cues;
  delete extra.wordsPerCaption;
  const timeline = manifest.expand === "timeline" ? readTimeline(extra.timeline) : null;
  if (manifest.expand === "timeline" && !timeline) throw new ProviderError("The voice track needs the lines' start times (params.extra.timeline)");
  delete extra.timeline;
  for (const [k, v] of Object.entries(extra)) values[k as BindingKey] = v;
  if (audio2 && ctx.op !== "dialogue" && ctx.op !== "voice-change") values.audio2 = audio2;
  // Soundtrack mix: a silent bed as long as the video, so neither track cuts the other short.
  if (ctx.op === "mux" && b.duration) {
    const tracks = [values.audio, values.audio2].map((n) => ctx.media?.(String(n ?? ""))?.duration ?? 0);
    values.duration = Math.round((clipLength ?? (Math.max(...tracks) || 600)) * 100) / 100 + 0.5; // the mux trims it to the picture
  }

  // Reference images the user left out: dropped from a FLUX.2 reference chain, else the previous image
  // again where that's harmless (style boards, multi-reference edits), else a clear "add …" message.
  let graph = workflow;
  const left: string[] = [];
  for (const [k, prev] of [["image2", "image"], ["image3", "image2"], ["image4", "image3"]] as const) {
    if (!b[k] || values[k] !== undefined || rules.required?.includes(k)) continue;
    if (values[prev] === undefined && !left.includes(prev)) continue;
    const bypassed = b[k]!.length === 1 ? bypassReference(graph, b[k]![0].node) : null;
    if (bypassed) {
      graph = bypassed;
      left.push(k);
    } else if ((rules.reuse || manifest.capability === "style-reference") && values[prev] !== undefined) values[k] = values[prev];
  }
  for (const k of mediaKeys(manifest, workflow)) {
    if (left.includes(k)) continue;
    if (values[k] === undefined || values[k] === "") throw new ProviderError(rules.hints?.[k] ?? MEDIA_HINT[k] ?? `Add the ${k} input`);
  }

  // Whisper captions hold the whole clip in RAM (decoded + subtitled copy): refuse what the server can't hold.
  if (manifest.capability === "captions" && !manifest.expand && clip?.width && clip.height && clipLength) {
    const need = clip.width * clip.height * 12 * (clip.frames ?? clipLength * (clip.fps ?? 30)) * 2.5;
    const budget = ((await ctx.serverRam?.()) ?? 16 * GB) / 2;
    if (need > budget) {
      throw new ProviderError(
        `Whisper captions hold the whole clip in memory: this one needs about ${Math.ceil(need / GB)} GB of RAM and this ComfyUI can spare ${Math.floor(budget / GB)} GB. ` +
          "Use Qwen3-ASR + Caption burn-in for long clips, or trim it first",
      );
    }
  }

  const bound = applyBindings(graph, b, Object.fromEntries(Object.entries(values).filter(([k]) => !left.includes(k))));
  if (bound.missing.length) throw new ProviderError(`Workflow ${manifest.id} bindings point at missing nodes: ${bound.missing.join(", ")}`);
  let wf = bound.workflow;
  if (manifest.expand === "captions") {
    if (!cues.length) throw new ProviderError("No timed captions to burn in. Transcribe the clip first, or write lines like “0.00-2.40: Hello there”");
    try {
      wf = expandCaptionWorkflow(wf, cues, clip ? { duration: clipLength, fps: clip.fps, width: clip.width, height: clip.height, hasAudio: clip.hasAudio } : {});
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
  }
  if (timeline) {
    try {
      wf = expandTimelineWorkflow(wf, input.audios?.length ? input.audios : [String(values.audio)], timeline);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
  }
  if (input.loras?.length) wf = injectLoras(wf, input.loras);
  // The output not asked for isn't saved (nor encoded: ComfyUI runs only what an output node needs).
  if (keepRole && manifest.outputs.some((o) => o.role === keepRole)) for (const o of manifest.outputs) if (o.role && o.role !== keepRole) delete wf[o.node];
  if (ctx.op === "remove-object" && !handOff) for (const o of manifest.outputs) if (o.role === "mask") delete wf[o.node];
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
  const outOfClip = /division by zero|failed to slice video|failed to trim video|no frames exist/i.test(msg);
  if (manifest?.expand === "captions" && outOfClip) return "A caption starts after the end of the video — check the cue times";
  if (manifest?.capability === "trim" && outOfClip) return "The start time is past the end of the clip";
  if (/no audio stream/i.test(msg)) return "That file has no sound to work with";
  return `${err.node_type}: ${msg}`;
}

const executionError = (entry: HistoryEntry) => entry.status?.messages?.find(([t]) => t === "execution_error")?.[1] as { exception_message?: string; node_type?: string } | undefined;

const promptHasPrefix = (prompt: unknown, prefix: string) =>
  !!prompt && typeof prompt === "object" && Object.values(prompt as ComfyWorkflow).some((n) => n?.inputs?.filename_prefix === prefix);

/**
 * VHS meta-batching re-queues the prompt (new prompt ids) until every frame is done; only the last pass
 * saves the video. Follow the passes by their shared filename prefix.
 */
async function followMetaBatch(prefix: string, manifest: ManifestWorkflow | undefined, worker: ComfyWorker): Promise<ComfyOutput[] | "running" | { error: string } | null> {
  const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue", worker);
  if ([...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some((q) => promptHasPrefix(q[2], prefix))) return "running";
  const hist = await comfyJson<Record<string, HistoryEntry>>("/history?max_items=64", worker);
  const passes = Object.values(hist)
    .filter((e) => promptHasPrefix(e.prompt?.[2], prefix))
    .sort((a, c) => Number(c.prompt?.[0] ?? 0) - Number(a.prompt?.[0] ?? 0));
  // A pass that failed (out of memory, a node exception) ends the job: say why instead of "no output".
  const failed = passes.find((e) => e.status?.status_str === "error");
  if (failed) return { error: explainExecutionError(executionError(failed), manifest) };
  for (const e of passes) {
    const files = collectOutputs(e, manifest, baseUrl(worker), authHeaders(worker));
    if (files.length) return files;
  }
  return null;
}

/** Upload a file to a worker's input folder; returns the name LoadImage / LoadAudio / LoadVideo take there. */
async function uploadTo(worker: ComfyWorker, data: Buffer, contentType: string, name: string): Promise<string> {
  const form = new FormData();
  const ext = name.includes(".") ? name.split(".").pop() : contentType.split("/")[1];
  form.append("image", new Blob([new Uint8Array(data)], { type: contentType }), `fuobe_${nanoid(8)}.${ext}`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await comfyFetch("/upload/image", { method: "POST", body: form }, worker);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw worker === "isolated" ? isolatedAnswer("an upload", res.status, reasonOf(text)) : new ProviderError(`ComfyUI upload failed: ${res.status} ${text}`);
  }
  const j = (await res.json()) as { name: string; subfolder?: string };
  const uploaded = j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  // Remember a clip's / track's header facts (length, size, fps, audio) for prepareWorkflow.
  if (MEDIA_FILE.test(contentType) || MEDIA_EXT.test(name)) {
    const info = probeMedia(data);
    if (info) rememberMedia(uploaded, info);
  }
  return uploaded;
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

  // Inputs go to the server that runs the route's workflow (the isolated worker has its own input folder).
  async prepareFile(data, contentType, name, route?: ModelRoute) {
    return uploadTo(workerFor(route?.endpoint), data, contentType, name);
  },

  async submit({ route, input, generationId }) {
    const worker = workerFor(route.endpoint);
    const { manifest, workflow: wf, meta } = await prepareWorkflow(route.endpoint, input, {
      generationId,
      op: route.op,
      upload: (data, contentType, name) => uploadTo(worker, data, contentType, name),
      media: mediaInfoFor,
      serverRam: async () => (await comfyJson<{ system?: { ram_total?: number } }>("/system_stats", worker).catch(() => undefined))?.system?.ram_total,
    });
    const { clientId } = ensureSocket(worker);
    const res = await comfyFetch(
      "/prompt",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf, client_id: clientId }),
      },
      worker,
    );
    const body = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { type?: string; message?: string }; node_errors?: unknown };
    if (!res.ok || !body.prompt_id) {
      // A node class the server doesn't have: name the pack to install (opt-in packs like ComfyUI-Whisper).
      const packs = manifest.customNodes.map((c) => c.name);
      const where = worker === "isolated" ? "the isolated ComfyUI worker" : "your ComfyUI";
      const missingPack =
        body.error?.type === "missing_node_type" && packs.length ? `This workflow needs the ${packs.join(" + ")} node pack${packs.length > 1 ? "s" : ""} on ${where} (see scripts/comfy/README.md)` : undefined;
      const detail = body.node_errors && Object.keys(body.node_errors as object).length ? explainComfyError(body.node_errors, { ...manifest, models: [...manifest.models, ...(input.loras ?? []).map((l) => ({ file: l.file, folder: "loras", url: l.url }))] }) : (missingPack ?? body.error?.message);
      if (!detail && !res.ok && worker === "isolated") throw isolatedAnswer("the prompt", res.status);
      throw new ProviderError(detail ?? `ComfyUI /prompt failed (${res.status})`, res.status);
    }
    return { externalId: body.prompt_id, meta: { ...meta, ...(worker === "isolated" && { worker }) }, payload: wf };
  },

  async poll({ externalId, meta }) {
    const worker: ComfyWorker = meta.worker === "isolated" ? "isolated" : "main";
    let manifest: ManifestWorkflow | undefined;
    try {
      manifest = getWorkflow(String(meta.workflowId)).manifest;
    } catch {}
    const finished = async (entry: HistoryEntry) => {
      if (entry.status?.status_str === "error") {
        forget(externalId);
        return { state: "failed" as const, error: explainExecutionError(executionError(entry), manifest) };
      }
      let outputs = collectOutputs(entry, manifest, baseUrl(worker), authHeaders(worker));
      if (!outputs.length && meta.metaBatch && typeof meta.prefix === "string") {
        const next = await followMetaBatch(meta.prefix, manifest, worker);
        if (next === "running") return { state: "running" as const, message: "Rendering the next batch of frames" };
        if (next && "error" in next) {
          forget(externalId);
          return { state: "failed" as const, error: next.error };
        }
        outputs = next ?? [];
      }
      forget(externalId);
      if (!outputs.length) return { state: "failed" as const, error: "Workflow finished without saving any output" };
      return { state: "succeeded" as const, outputs: await withLayerBoxes(outputs) };
    };
    const isDone = (e: HistoryEntry | undefined): e is HistoryEntry => !!e && (!!e.status?.completed || e.status?.status_str === "success" || e.status?.status_str === "error");

    const entry = (await comfyJson<Record<string, HistoryEntry>>(`/history/${externalId}`, worker))[externalId];
    if (isDone(entry)) return finished(entry);

    // Still queued or running?
    const { progress } = ensureSocket(worker);
    const p = progress.get(externalId);
    const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue", worker);
    const running = queue.queue_running?.some((q) => q[1] === externalId);
    const pendingIdx = queue.queue_pending?.findIndex((q) => q[1] === externalId) ?? -1;
    if (!running && pendingIdx < 0 && !entry) {
      // It may have finished between the two requests (ComfyUI moves it from the queue to the history at once).
      const again = (await comfyJson<Record<string, HistoryEntry>>(`/history/${externalId}`, worker))[externalId];
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
      message: p?.max ? `Sampling ${p.value}/${p.max}` : worker === "isolated" ? "Running on the isolated ComfyUI worker" : "Running on ComfyUI",
    };
  },

  async cancel({ externalId, meta }) {
    const worker: ComfyWorker = meta.worker === "isolated" ? "isolated" : "main";
    forget(externalId);
    const post = (path: string, body: unknown) => comfyFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, worker);
    await post("/queue", { delete: [externalId] }).catch(() => {});
    const q = (await comfyJson<{ queue_running?: unknown[][] }>("/queue", worker).catch(() => ({}))) as { queue_running?: unknown[][] };
    if (q.queue_running?.some((r) => r[1] === externalId)) await post("/interrupt", { prompt_id: externalId }).catch(() => {});
  },

  async test(opts) {
    const describe = async (worker: ComfyWorker) => {
      const res = await comfyFetch("/system_stats", {}, worker);
      if (!res.ok) throw new ProviderError(`HTTP ${res.status}`);
      const s = (await res.json()) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
      const dev = s.devices?.[0];
      return `ComfyUI ${s.system?.comfyui_version ?? ""} · ${dev?.name ?? "unknown device"}${dev?.vram_total ? ` · ${(dev.vram_total / 2 ** 30).toFixed(0)} GB` : ""}`;
    };
    // Checking the isolated worker's address: that worker answers, or it isn't connected (the main
    // server's state is the main address's test).
    if (opts?.focus === "comfyIsolatedUrl") {
      if (!baseUrl("isolated")) return { ok: false, detail: "No isolated worker address set" };
      return describe("isolated").then(
        (d) => ({ ok: true, detail: `isolated worker: ${d}` }),
        (e: Error) => ({ ok: false, detail: /^HTTP \d/.test(e.message) ? `The isolated worker at ${baseUrl("isolated")} answered ${e.message}` : e.message }),
      );
    }
    let detail: string;
    try {
      detail = await describe("main");
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
    // The isolated worker is optional: say whether it answers, without failing the main server's test.
    if (baseUrl("isolated")) {
      const iso = await describe("isolated").then(
        (d) => `isolated worker: ${d}`,
        () => `the isolated worker at ${baseUrl("isolated")} doesn't answer`,
      );
      detail = `${detail} · ${iso}`;
    }
    return { ok: true, detail };
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
