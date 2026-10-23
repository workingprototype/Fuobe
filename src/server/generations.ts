import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getModel, getPreset } from "@/lib/catalog";
import { applyMentions } from "@/lib/catalog/elements";
import { withSignatureWords } from "@/lib/catalog/palettes";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { cueText, type Cue } from "@/lib/cues";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import { keepMatte } from "@/lib/catalog/payload";
import {
  LAST_FRAME_CHAIN,
  OPERATION_OUTPUT,
  type ChainSlot,
  type Generation,
  type GenerationRequest,
  type MediaKind,
  type GenInput,
  type ModelRoute,
  type OutputFile,
  type ProviderId,
} from "@/lib/catalog/types";
import { db } from "./db";
import { listElements } from "./elements";
import { pollTrainings } from "./training";
import { createExtendChain, createShotFilm } from "./chains";
import { enhancePrompt } from "./enhance";
import { setResolver, watchGenerations, type LiveEvent } from "./live";
import { provider } from "./providers";
import { probeComfy } from "./providers/comfyui";
import { llmBackends, llmMissing, llmUsesClaude, probeOllama } from "./providers/llm";
import type { PollContext, PollResult, RemoteOutput } from "./providers/types";
import { convertMask } from "./png";
import { engineMode, getSetting } from "./settings";
import { contentTypeFor, deleteAsset, readRef, saveFile } from "./storage";

interface Row {
  id: string;
  batch_id: string | null;
  feature: string;
  preset_id: string | null;
  model_id: string;
  engine: Generation["engine"];
  provider: ProviderId;
  op: Generation["op"];
  kind: Generation["kind"];
  status: Generation["status"];
  progress: number | null;
  message: string | null;
  prompt: string | null;
  request_json: string;
  provider_input_json: string | null;
  external_id: string | null;
  external_meta_json: string | null;
  outputs_json: string;
  error: string | null;
  cost_usd: number | null;
  favorite: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  depends_on: string | null;
  /** Joined by the library readers (generation_trash, folder_items); looked up when absent. */
  deleted_at?: number | null;
  folder_id?: string | null;
}

/** Trash and folder columns, joined onto every library read. */
const LIBRARY_COLUMNS = "g.*, t.deleted_at AS deleted_at, fi.folder_id AS folder_id";
const LIBRARY_JOIN = "generations g LEFT JOIN generation_trash t ON t.generation_id = g.id LEFT JOIN folder_items fi ON fi.generation_id = g.id";

export function toGeneration(r: Row): Generation {
  const request = JSON.parse(r.request_json) as GenerationRequest;
  const model = getModel(r.model_id);
  const ar = request.params?.aspectRatio ?? model?.defaults?.aspectRatio;
  // Rows read without the library join (the runner's own SELECTs) look the trash and folder up.
  const lib =
    r.deleted_at !== undefined && r.folder_id !== undefined
      ? { deleted_at: r.deleted_at, folder_id: r.folder_id }
      : (db()
          .prepare(
            "SELECT (SELECT deleted_at FROM generation_trash WHERE generation_id = ?) AS deleted_at, (SELECT folder_id FROM folder_items WHERE generation_id = ?) AS folder_id",
          )
          .get(r.id, r.id) as { deleted_at: number | null; folder_id: string | null });
  return {
    id: r.id,
    batchId: r.batch_id,
    feature: r.feature,
    presetId: r.preset_id,
    modelId: r.model_id,
    engine: r.engine,
    provider: r.provider,
    op: r.op,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    message: r.message,
    prompt: r.prompt,
    request,
    outputs: JSON.parse(r.outputs_json) as OutputFile[],
    error: r.error,
    costUsd: r.cost_usd,
    favorite: !!r.favorite,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    modelName: model?.name ?? r.model_id,
    presetName: r.preset_id ? (getPreset(r.preset_id)?.name ?? null) : null,
    aspectRatio: ar && ar !== "auto" ? ar : null,
    deletedAt: lib.deleted_at ?? null,
    folderId: lib.folder_id ?? null,
  };
}

function update(id: string, fields: Partial<Row>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE generations SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

/** One generation; a row in the Trash reads as missing unless `includeDeleted`. */
export function getGeneration(id: string, opts: { includeDeleted?: boolean } = {}): Generation | null {
  ensureRunner();
  const r = db().prepare(`SELECT ${LIBRARY_COLUMNS} FROM ${LIBRARY_JOIN} WHERE g.id = ?`).get(id) as Row | undefined;
  if (!r || (r.deleted_at && !opts.includeDeleted)) return null;
  return toGeneration(r);
}

export interface ListOptions {
  batchId?: string;
  feature?: string;
  features?: string[];
  kind?: string;
  kinds?: string[];
  models?: string[];
  favorites?: boolean;
  status?: string;
  statuses?: string[];
  /** Only the Trash, newest deletion first (`before` is then a deletedAt cursor). Otherwise the Trash is left out. */
  trashed?: boolean;
  folderId?: string;
  limit?: number;
  /**
   * Paging cursor: made before this (deleted before, in the Trash). With `beforeId` it is the last
   * row of the previous page, so rows sharing its timestamp (a bulk trash, a batch made in one
   * millisecond) are paged by id instead of skipped.
   */
  before?: number;
  beforeId?: string;
  /** Date range on createdAt: since ≤ t < until. */
  since?: number;
  until?: number;
  q?: string;
}

const featureLike = (f: string) => (f.endsWith("*") ? `${f.slice(0, -1)}%` : f);

export function listGenerations(o: ListOptions = {}): Generation[] {
  const where: string[] = [o.trashed ? "t.deleted_at IS NOT NULL" : "t.deleted_at IS NULL"];
  const args: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    args.push(...values);
  };
  const oneOf = (col: string, values: unknown[]) => add(`${col} IN (${values.map(() => "?").join(", ")})`, ...values);
  if (o.batchId) add("g.batch_id = ?", o.batchId);
  if (o.feature) add("g.feature = ?", o.feature);
  if (o.features?.length) add(`(${o.features.map(() => "g.feature LIKE ?").join(" OR ")})`, ...o.features.map(featureLike));
  if (o.kind) add("g.kind = ?", o.kind);
  if (o.kinds?.length) oneOf("g.kind", o.kinds);
  if (o.models?.length) oneOf("g.model_id", o.models);
  if (o.favorites) add("g.favorite = 1");
  if (o.status) add("g.status = ?", o.status);
  if (o.statuses?.length) oneOf("g.status", o.statuses);
  if (o.folderId) add("fi.folder_id = ?", o.folderId);
  if (o.before) {
    const col = o.trashed ? "t.deleted_at" : "g.created_at";
    if (o.beforeId) add(`(${col} < ? OR (${col} = ? AND g.id < ?))`, o.before, o.before, o.beforeId);
    else add(`${col} < ?`, o.before);
  }
  if (o.since) add("g.created_at >= ?", o.since);
  if (o.until) add("g.created_at < ?", o.until);
  const q = o.q?.trim();
  // The user's own words (request.prompt) and what the model got (prompt, with suffixes and templates).
  if (q) add("(g.prompt LIKE ? OR json_extract(g.request_json, '$.prompt') LIKE ?)", `%${q}%`, `%${q}%`);
  // The cursor's order: timestamp, then id (both descending).
  const order = o.trashed ? "t.deleted_at DESC, g.id DESC" : "g.created_at DESC, g.id DESC";
  const sql = `SELECT ${LIBRARY_COLUMNS} FROM ${LIBRARY_JOIN} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`;
  return (db().prepare(sql).all(...args, Math.max(1, Math.min(o.limit ?? 60, 200))) as Row[]).map(toGeneration);
}

export function setFavorite(id: string, favorite: boolean): void {
  update(id, { favorite: favorite ? 1 : 0 });
}

/**
 * Everywhere a stored file can still be in use, by URL (which ends in the asset id, …/<id>.png) or
 * by id: other jobs' inputs and outputs, elements, Assist chats (attachments, results), Cinema
 * covers, palettes and takes, canvas nodes. `except` names a column whose row belongs to the
 * generation being purged (its own row and Cinema membership don't keep its files).
 */
const ASSET_REFS: { table: string; cols: string[]; except?: string }[] = [
  { table: "generations", cols: ["request_json", "outputs_json"], except: "id" },
  { table: "characters", cols: ["reference_asset_ids_json", "loras_json", "lora_file"] },
  { table: "trainings", cols: ["meta_json"] },
  { table: "assist_threads", cols: ["messages_json", "items_json", "pending_json"] },
  { table: "cinema_projects", cols: ["cover_url", "palettes_json", "director_json", "chat_json", "brief_body"] },
  { table: "cinema_items", cols: ["meta_json"], except: "generation_id" },
  { table: "canvases", cols: ["graph_json"] },
  { table: "layer_projects", cols: ["source_url", "cover_url"] },
  { table: "layer_versions", cols: ["doc_json"] },
  { table: "shorts_sessions", cols: ["source_json", "look_json"] },
  { table: "shorts_presets", cols: ["references_json"] },
  { table: "brand_kits", cols: ["kit_json", "chat_json"] },
  { table: "products", cols: ["images_json"] },
  { table: "ad_creatives", cols: ["meta_json"] },
  { table: "marketing_runs", cols: ["meta_json"] },
  // Image studios: a palette's thumbnail, a moodboard's images, collages and cover, an Instadump pack's photos.
  { table: "palettes", cols: ["thumb_url"] },
  { table: "moodboards", cols: ["images_json", "collages_json", "cover_url"] },
  { table: "photodump_packs", cols: ["refs_json"] },
  // Faceless / Explainer: a channel's avatar, style references and voice samples, episode sources.
  { table: "faceless_channels", cols: ["avatar_url", "reference_json", "settings_json"] },
  { table: "faceless_episodes", cols: ["settings_json", "sources_json"] },
];

/** Whether anything still refers to this stored file (see ASSET_REFS). */
export function assetInUse(assetId: string, exceptGeneration = ""): boolean {
  for (const r of ASSET_REFS) {
    const where = r.cols.map((c) => `instr(COALESCE(${c}, ''), @id) > 0`).join(" OR ");
    const except = r.except ? ` AND ${r.except} != @g` : "";
    try {
      if (db().prepare(`SELECT 1 FROM ${r.table} WHERE (${where})${except} LIMIT 1`).get({ id: assetId, g: exceptGeneration })) return true;
    } catch {
      // A table or column this install doesn't have yet: nothing there to keep the file for.
    }
  }
  return false;
}

/**
 * Delete for good (Trash → Delete forever, Empty trash, the 30-day purge): the row, its trash and
 * folder entries, and the output files nothing else still points at (assetInUse). Dependents still
 * waiting on it fail ("An earlier step didn't finish"). Use deleteForever / emptyTrash in
 * src/server/library.ts (they cancel running jobs first); moving to the Trash is trashGenerations.
 */
export function deleteGeneration(id: string): void {
  const assets = db().prepare("SELECT id FROM assets WHERE generation_id = ?").all(id) as { id: string }[];
  db().transaction(() => {
    db().prepare("DELETE FROM generations WHERE id = ?").run(id);
    db().prepare("DELETE FROM generation_trash WHERE generation_id = ?").run(id);
    db().prepare("DELETE FROM folder_items WHERE generation_id = ?").run(id);
  })();
  for (const a of assets) if (!assetInUse(a.id, id)) deleteAsset(a.id);
}

// ---------------------------------------------------------------------------
// Routing

/**
 * Pick the provider for a run: a configured real provider, else the demo provider (unless demo is off).
 * `images` is how many images the run sends: a route whose list takes fewer (FieldMap.maxImages: Grok
 * Imagine Image takes 5 on fal, 10 on Higgsfield) gives way to one that takes them all, or says so.
 */
export function chooseRoute(candidates: ModelRoute[], images = 0): { route: ModelRoute; demo: boolean } {
  // Honour the preferred cloud aggregator (Settings → API configuration) when a model is on several.
  const preferred = getSetting("cloudProvider");
  const routes = preferred === "auto" ? candidates : [...candidates].sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  const demo = getSetting("demoMode");
  if (demo === "on") return { route: routes[0], demo: true };
  const takes = (r: ModelRoute) => !r.map?.maxImages || images <= r.map.maxImages;
  const real = routes.find((r) => routeReady(r) && takes(r));
  if (real) return { route: real, demo: false };
  const short = routes.find(routeReady);
  if (short) {
    const others = [...new Set(routes.filter((r) => takes(r) && r.provider !== short.provider).map((r) => provider(r.provider).label))];
    throw new Error(`This model takes up to ${short.map!.maxImages} images on ${provider(short.provider).label} — remove some${others.length ? `, or connect ${others.join(" or ")} for more` : ""}`);
  }
  if (demo === "off") {
    if (routes.every((r) => r.provider === "llm")) throw new Error(llmMissing(routes[0]));
    const names = [...new Set(routes.map((r) => provider(r.provider).label))].join(" or ");
    throw new Error(`Connect ${names} in Settings to run this model`);
  }
  return { route: routes[0], demo: true };
}

/** Text steps depend on which LLM the route may use (the open model never calls Claude). */
const routeReady = (r: ModelRoute) => (r.provider === "llm" ? llmBackends(r).length > 0 : provider(r.provider).isConfigured());

/** What a run produces: colour matching works on images and videos, and fal renders a timeline as a video, so those follow the model. */
export function outputKind(op: Generation["op"], model: { kind: MediaKind }): MediaKind {
  return op === "color-match" || op === "timeline" ? model.kind : OPERATION_OUTPUT[op];
}

// Live updates: every write to the table becomes an event (src/server/live.ts). A trashed row
// (soft delete, when the table has one) leaves the feeds like a deleted one.
setResolver((ids) =>
  ids.map((id): LiveEvent => {
    const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as (Row & { deleted_at?: number | null; trashed_at?: number | null }) | undefined;
    const g = r && (toGeneration(r) as Generation & { deletedAt?: number | null; trashedAt?: number | null });
    if (!r || !g || r.deleted_at || r.trashed_at || g.deletedAt || g.trashedAt) return { type: "deleted", id, json: JSON.stringify({ id }) };
    return { type: "generation", id, json: JSON.stringify(g) };
  }),
);

// ---------------------------------------------------------------------------
// Create

/** Resolve mentions and drawings, plan, enforce the engine mode and pick a provider route. */
function prepare(original: GenerationRequest) {
  // @element mentions become reference images / LoRAs; the stored request keeps the mentions for "Reuse".
  // A style signature's sentences (palette, look) join the prompt here; the stored request keeps the user's words.
  const worded = withSignatureWords(original);
  const model = getModel(worded.modelId);
  const req = model ? stripMotionPaths(applySketch(applyMentions(worded, model, listElements()).request, model).request, model) : worded;
  let plan = planGeneration(req, getModel, getPreset);
  const mode = engineMode();
  if (mode !== "both" && plan.model.engine !== mode) {
    throw new Error(
      mode === "open"
        ? `${plan.model.name} is a paid cloud model, but this install is set to open source only (Settings → Engine mode)`
        : `${plan.model.name} is an open-source model, but this install is set to paid cloud APIs only (Settings → Engine mode)`,
    );
  }
  // Checks planGeneration can't make without knowing the model's kind or the text ops' needs.
  if (plan.op === "color-match" && plan.model.kind === "video" && !req.inputs?.video) throw new Error("Add the video and a reference image");
  if (plan.op === "translate" && !plan.params.targetLanguage) throw new Error("Pick a language to translate into");
  const { route, demo } = chooseRoute(routesFor(plan.model, plan.op), req.inputs?.images?.length ?? 0);
  // A route that can't batch (Higgsfield's Grok Imagine Image beside fal's num_images) runs one job per output.
  if (!demo && route.map && !route.map.numOutputs && plan.perJobOutputs > 1) {
    plan = { ...plan, jobs: plan.jobs * plan.perJobOutputs, perJobOutputs: 1, params: { ...plan.params, numOutputs: 1 } };
  }
  const providerId: ProviderId = demo ? "mock" : route.provider;
  // A text step that runs on Ollama is free; only Claude costs money.
  const free = demo || (route.provider === "llm" && !llmUsesClaude(route));
  return { req, plan, route, demo, providerId, cost: free ? 0 : estimateCost(plan.model, plan.params, 1) };
}


/** What a request would run as — model, operation, job count and cost — without starting it. */
export function previewGeneration(req: GenerationRequest) {
  const { plan, demo, providerId, cost } = prepare(req);
  return { model: plan.model, op: plan.op, jobs: plan.jobs, outputs: plan.jobs * plan.perJobOutputs, demo, providerId, costUsd: cost === null ? null : cost * plan.jobs };
}

/** Preview a step that will wait for `deps` earlier steps: validated with placeholders in its chain slots, as createGenerations does. */
export function previewChained(req: GenerationRequest, deps: number) {
  if (!deps) return previewGeneration(req);
  // A waiting step always runs as one job (createGenerations doesn't batch dependents).
  const p = previewGeneration(withChainInputs(req, slotsFor(req, deps).map(placeholderFor)));
  const jobs = Math.max(1, p.jobs);
  return { ...p, jobs: 1, outputs: p.outputs / jobs, costUsd: p.costUsd === null ? null : p.costUsd / jobs };
}

export interface CreateOptions {
  /** Group several requests (storyboard frames, the shots of a film) into one batch. */
  batchId?: string;
  /**
   * Wait for these generations, then feed their first outputs in as inputs: where each goes is
   * `request.chain` (one slot per id), or `request.chainFrom` for a single image dependency.
   */
  dependsOn?: string | string[];
}

const depIds = (v: string | null): string[] => (!v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v]);

export function createGenerations(original: GenerationRequest, opts: CreateOptions = {}): Generation[] {
  // Open models make multi-shot films shot by shot, then join the clips.
  const shotModel = getModel(original.modelId);
  if (!opts.dependsOn && shotModel?.options.multiShot?.mode === "concat" && (original.params?.shots?.filter((x) => x.prompt.trim()).length ?? 0) > 1) {
    return createShotFilm(original, shotModel);
  }
  if (!opts.dependsOn && original.op === "extend" && shotModel && routesFor(shotModel, "extend").some((r) => r.endpoint === LAST_FRAME_CHAIN)) {
    return createExtendChain(original, shotModel);
  }
  const deps = opts.dependsOn === undefined ? [] : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
  const waits = deps.length > 0;
  // A dependent job can't be planned until its inputs exist; it's validated with placeholders, then launched by the runner.
  const p = waits ? prepare(withChainInputs(original, slotsFor(original, deps.length).map(placeholderFor))) : prepare(original);
  const { req, plan, route, demo, providerId, cost } = p;
  const jobs = waits ? 1 : plan.jobs;
  const batchId = opts.batchId ?? (jobs > 1 ? nanoid(10) : null);
  const now = Date.now();
  const created: Generation[] = [];
  for (let i = 0; i < jobs; i++) {
    const id = nanoid(12);
    const row: Row = {
      id,
      batch_id: batchId,
      feature: req.feature,
      preset_id: req.presetId ?? null,
      model_id: plan.model.id,
      engine: plan.model.engine,
      provider: providerId,
      op: plan.op,
      kind: outputKind(plan.op, plan.model),
      status: "queued",
      progress: null,
      message: waits ? (original.frame ? "Waits for the previous frame" : "Waits for the earlier steps") : demo ? "Demo mode — no provider connected" : "Submitting",
      // A step whose prompt comes from an earlier step shows its own words (not the placeholder) until then.
      prompt: waits && req.chain?.some((s) => s.slot === "prompt") ? original.prompt?.replaceAll("{text}", "…").trim() || null : plan.prompt,
      request_json: JSON.stringify(original),
      provider_input_json: null,
      external_id: null,
      external_meta_json: null,
      outputs_json: "[]",
      error: null,
      cost_usd: cost,
      favorite: 0,
      created_at: now + i,
      updated_at: now + i,
      completed_at: null,
      depends_on: !waits ? null : deps.length === 1 ? deps[0] : JSON.stringify(deps),
    };
    db()
      .prepare(
        `INSERT INTO generations (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row)
          .map((k) => `@${k}`)
          .join(", ")})`,
      )
      .run(row);
    created.push(toGeneration(row));
    if (!waits) void submit(id, route, providerId, plan, req, i);
  }
  ensureRunner();
  return created;
}

/** Where each dependency's output goes: `chain`, or the single-image `chainFrom`. */
function slotsFor(req: GenerationRequest, n: number): ChainSlot[] {
  // Dependencies beyond the listed slots are images (a chain shorter than dependsOn used to crash the launch).
  return Array.from({ length: n }, (_, i) => req.chain?.[i] ?? { slot: "images" as const, position: req.chainFrom ?? "last" });
}

const SLOT_KIND: Record<ChainSlot["slot"], MediaKind> = {
  images: "image",
  endImage: "image",
  video: "video",
  videos: "video",
  audio: "audio",
  voiceAudio: "audio",
  audio2: "audio",
  audios: "audio",
  model3d: "model3d",
  mask: "video",
  prompt: "text",
};

/** Names providers give the same stem (ComfyUI: voice/background; Demucs: vocals…; SAM Audio: target/residual). */
const STEM_ALIASES: Record<string, string[]> = {
  voice: ["voice", "vocals", "speech", "target"],
  background: ["background", "accompaniment", "instrumental", "residual", "no_vocals"],
};

/**
 * Soundtrack slots a video can fill: a step that made only a clip hands over the clip itself, and the
 * mux reads its sound (ComfyUI's LoadAudio and fal's FFmpeg take a video file as the audio input).
 * Shorts and Mixed Media put the trimmed source's own sound back under the restyled picture this way.
 */
const SOUNDTRACK_SLOTS = new Set<ChainSlot["slot"]>(["audio", "audio2"]);

/** The dependency output a slot takes: the first of the slot's kind, or the one with the slot's `stem`. */
export function pickOutput(outputs: OutputFile[], s: ChainSlot): OutputFile | undefined {
  // A mask: the output made as one (meta.role "mask": a painted window's last tracked frame), else a mask video, else a still.
  if (s.slot === "mask") return outputs.find((o) => o.meta?.role === "mask") ?? outputs.find((o) => o.kind === "video") ?? outputs.find((o) => o.kind === "image");
  const ofKind = outputs.filter((o) => o.kind === SLOT_KIND[s.slot]);
  if (!s.stem) return ofKind[0] ?? (SOUNDTRACK_SLOTS.has(s.slot) ? outputs.find((o) => o.kind === "video") : undefined);
  const want = STEM_ALIASES[s.stem.toLowerCase()] ?? [s.stem.toLowerCase()];
  return ofKind.find((o) => typeof o.meta?.stem === "string" && want.includes(o.meta.stem.toLowerCase()));
}

const slotNoun = (s: ChainSlot) => (s.stem ? `${s.stem} stem` : s.slot === "mask" ? "mask" : SLOT_KIND[s.slot]);

function placeholderFor(s: ChainSlot): string {
  const kind = SLOT_KIND[s.slot];
  if (kind === "text") return "Placeholder text from an earlier step";
  if (kind === "model3d") return "/api/files/placeholder.glb";
  return kind === "image" ? "/api/files/placeholder.png" : kind === "video" ? "/api/files/placeholder.mp4" : "/api/files/placeholder.wav";
}

/**
 * What a chained step takes from a dependency's output: the file URL, or the text for "prompt".
 * A translation of timed text gets the cue list (so the timing survives); text saved only as a
 * file, or cut short inline (meta.truncated), is read back from it.
 */
async function chainValue(o: OutputFile | undefined, s: ChainSlot, op?: Generation["op"]): Promise<string | undefined> {
  if (!o) return undefined;
  if (s.slot !== "prompt") return o.url;
  const cues = Array.isArray(o.meta?.cues) && o.meta.cues.length ? (o.meta.cues as Cue[]) : null;
  if (op === "translate" && cues) return JSON.stringify(cues);
  if (typeof o.text === "string" && !o.meta?.truncated) return o.text;
  // Timed text is saved as subtitles: its words come from the cues, not the .srt file.
  if (cues) return cueText(cues);
  if (!o.url) return undefined;
  return readRef(o.url)
    .then((f) => f.data.toString("utf8"))
    .catch(() => undefined);
}

/**
 * Put the dependencies' outputs into the request's inputs, slot by slot (lists keep dependency order).
 * A "prompt" slot gets the dependency's text: it fills "{text}" in the prompt, or becomes the prompt.
 */
export function withChainInputs(req: GenerationRequest, urls: string[]): GenerationRequest {
  const inputs = { ...req.inputs };
  let prompt = req.prompt;
  const slots = slotsFor(req, urls.length);
  for (const k of ["images", "videos", "audios"] as const) {
    const at = (pos: "first" | "last") => slots.flatMap((s, i) => (s.slot === k && (s.position ?? "last") === pos ? [urls[i]] : []));
    const first = at("first");
    const last = at("last");
    if (first.length || last.length) inputs[k] = [...first, ...(inputs[k] ?? []), ...last];
  }
  slots.forEach((s, i) => {
    if (s.slot === "prompt") prompt = prompt?.includes("{text}") ? prompt.replaceAll("{text}", urls[i]) : urls[i];
    else if (s.slot !== "images" && s.slot !== "videos" && s.slot !== "audios") inputs[s.slot] = urls[i];
  });
  return { ...req, prompt, inputs };
}

/** Generations this process is handing to a provider right now (shared across hot reloads and bundles). */
declare global {
  var __fuobeSubmitting: Set<string> | undefined;
}
const submitting = (): Set<string> => (globalThis.__fuobeSubmitting ??= new Set<string>());

/**
 * A chain runs all for real or all as a demo (a demo join of paid clips, or a paid step fed a demo
 * placeholder, helps nobody). Returns the error for a step that can't match its dependencies, and
 * whether it should run as a demo because they did.
 */
function chainMode(p: { demo: boolean; plan: { model: { name: string } }; route: ModelRoute }, deps: Pick<Row, "provider">[]): { error?: string; forceDemo?: boolean } {
  const demoDeps = deps.filter((d) => d.provider === "mock").length;
  if (p.demo && demoDeps < deps.length) {
    const needs = p.route.provider === "llm" ? "Claude or Ollama" : provider(p.route.provider).label;
    return { error: `${p.plan.model.name} needs ${needs} to continue what the earlier steps made for real — connect it in Settings, then retry` };
  }
  if (!p.demo && demoDeps > 0) {
    if (getSetting("demoMode") === "off") return { error: "An earlier step ran as a demo — retry it with its provider connected" };
    return { forceDemo: true };
  }
  return {};
}

/** Launch dependent jobs whose inputs finished; fail the ones whose inputs failed. Never waits for an upload. */
async function advanceDependents(): Promise<void> {
  const rows = db()
    .prepare("SELECT * FROM generations WHERE status = 'queued' AND external_id IS NULL AND depends_on IS NOT NULL ORDER BY created_at ASC LIMIT 50")
    .all() as Row[];
  for (const r of rows) {
    if (submitting().has(r.id)) continue;
    const request = JSON.parse(r.request_json) as GenerationRequest;
    const ids = depIds(r.depends_on);
    const slots = slotsFor(request, ids.length);
    const deps = ids.map((id) => db().prepare("SELECT status, provider, outputs_json FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "provider" | "outputs_json"> | undefined);
    const earlier = request.frame ? "The previous frame" : "An earlier step";
    if (deps.some((d) => !d || d.status === "failed" || d.status === "canceled")) {
      update(r.id, { status: "failed", error: `${earlier} didn't finish`, message: null, completed_at: Date.now() });
      continue;
    }
    if (deps.some((d) => d!.status !== "succeeded")) continue;
    submitting().add(r.id);
    let handedOff = false;
    try {
      // The planned op (r.op), not request.op: a translate whose op was inferred still gets the cue list.
      const values = await Promise.all(deps.map((d, i) => chainValue(pickOutput(JSON.parse(d!.outputs_json) as OutputFile[], slots[i]), slots[i], r.op)));
      const missing = values.findIndex((u) => !u);
      if (missing >= 0) {
        update(r.id, { status: "failed", error: `${earlier} has no ${slotNoun(slots[missing])} to use`, message: null, completed_at: Date.now() });
        continue;
      }
      // Routing reads cached reachability: make sure it's fresh for local engines.
      const model = getModel(request.modelId);
      if (model?.routes.some((x) => x.provider === "comfyui")) await probeComfy();
      if (model?.routes.some((x) => x.provider === "llm")) await probeOllama();
      const original = withChainInputs(request, values as string[]);
      const prepared = prepare(original);
      const mode = chainMode(prepared, deps as Pick<Row, "provider">[]);
      if (mode.error) throw new Error(mode.error);
      const p = mode.forceDemo ? { ...prepared, demo: true, providerId: "mock" as const, cost: 0 } : prepared;
      update(r.id, {
        provider: p.providerId,
        op: p.plan.op,
        kind: outputKind(p.plan.op, p.plan.model),
        prompt: p.plan.prompt,
        cost_usd: p.cost,
        request_json: JSON.stringify(original),
        message: mode.forceDemo ? "Demo — an earlier step ran as a demo" : p.demo ? "Demo mode — no provider connected" : "Submitting",
      });
      // In the background: an upload must not hold up the runner's other polls.
      handedOff = true;
      void submit(r.id, p.route, p.providerId, p.plan, p.req, 0);
    } catch (e) {
      update(r.id, { status: "failed", error: (e as Error).message, message: null, completed_at: Date.now() });
    } finally {
      if (!handedOff) submitting().delete(r.id);
    }
  }
}

const statusOf = (id: string) => (db().prepare("SELECT status FROM generations WHERE id = ?").get(id) as Pick<Row, "status"> | undefined)?.status;

/** Start the timeout clock: the job has reached its provider. */
function recordSubmission(id: string, at: number): void {
  db()
    .prepare("INSERT INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, NULL) ON CONFLICT(id) DO UPDATE SET submitted_at = excluded.submitted_at, started_at = NULL")
    .run(id, at);
}

async function submit(
  id: string,
  route: ModelRoute,
  providerId: ProviderId,
  plan: ReturnType<typeof planGeneration>,
  req: GenerationRequest,
  index: number,
): Promise<void> {
  const adapter = provider(providerId);
  submitting().add(id);
  try {
    const prep = async (ref?: string) => {
      if (!ref) return undefined;
      const f = await readRef(ref);
      return adapter.prepareFile(f.data, f.contentType, f.name);
    };
    const prepMask = async (ref?: string) => {
      if (!ref) return undefined;
      const f = await readRef(ref);
      const fmt = route.map?.maskFormat;
      const data = fmt && fmt !== "white" && f.contentType === "image/png" ? convertMask(f.data, fmt) : f.data;
      return adapter.prepareFile(data, f.contentType, f.name);
    };
    let prompt = plan.prompt;
    if (req.params?.enhancePrompt && prompt) {
      update(id, { message: "Enhancing prompt" });
      prompt = await enhancePrompt(prompt, plan.model.kind, plan.op).catch(() => prompt);
      update(id, { prompt });
    }
    const input: GenInput = {
      ...plan.params,
      prompt,
      negativePrompt: req.negativePrompt,
      images: (await Promise.all((req.inputs?.images ?? []).map(prep))).filter(Boolean) as string[],
      endImage: await prep(req.inputs?.endImage),
      mask: await prepMask(req.inputs?.mask),
      video: await prep(req.inputs?.video),
      audio: await prep(req.inputs?.audio),
      audio2: await prep(req.inputs?.audio2),
      voiceAudio: await prep(req.inputs?.voiceAudio),
      voiceAudio2: await prep(req.inputs?.voiceAudio2),
      videos: (await Promise.all((req.inputs?.videos ?? []).map(prep))).filter(Boolean) as string[],
      audios: (await Promise.all((req.inputs?.audios ?? []).map(prep))).filter(Boolean) as string[],
      model3d: await prep(req.inputs?.model3d),
      loras: plan.loras,
      // Vary seeds across a batch so N jobs don't return N identical results.
      seed: plan.params.seed !== undefined && plan.params.seed >= 0 ? plan.params.seed + index : undefined,
    };
    const res = await adapter.submit({ generationId: id, model: plan.model, route, input });
    const now = Date.now();
    const status = statusOf(id);
    if (!status || status === "canceled") {
      // Canceled (or deleted) while it was being handed over: stop the provider's job too.
      await adapter.cancel?.({ externalId: res.externalId, meta: res.meta ?? {}, route, model: plan.model, createdAt: now }).catch(() => {});
      if (status) update(id, { external_id: res.externalId, external_meta_json: JSON.stringify(res.meta ?? {}), message: null });
      return;
    }
    db().transaction(() => {
      update(id, {
        external_id: res.externalId,
        external_meta_json: JSON.stringify(res.meta ?? {}),
        provider_input_json: res.payload ? JSON.stringify(res.payload).slice(0, 200_000) : null,
        message: "Queued",
      });
      recordSubmission(id, now);
    })();
  } catch (e) {
    // A cancel during the hand-over stays a cancel.
    if (statusOf(id) !== "canceled") update(id, { status: "failed", error: (e as Error).message, completed_at: Date.now(), message: null });
  } finally {
    submitting().delete(id);
  }
}

// ---------------------------------------------------------------------------
// Polling loop

const POLL_MS = 1500;
/** Jobs about to finish (progress ≥ 0.9) are polled this often, so results land sooner. */
const FAST_POLL_MS = 500;
/** How long a job may run once its provider has started it… */
const TIMEOUT_MS = 45 * 60 * 1000;
/** …and how long it may wait in the provider's queue first (a busy local GPU works through jobs one by one). */
const QUEUE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** A row this old with no external id, that no submit in this process is working on, was cut off by a restart. */
const STALE_SUBMIT_MS = 2 * 60 * 1000;

interface RunnerState {
  timer: NodeJS.Timeout;
  busy: boolean;
  tick: () => Promise<void>;
  fastTimer?: NodeJS.Timeout;
  fastBusy?: boolean;
  fast?: () => Promise<void>;
  /** Rows being polled right now (the fast lane and the tick never poll one row twice at once). */
  polling?: Set<string>;
}

declare global {
  var __fuobeRunner: RunnerState | undefined;
}

/**
 * Start the background runner (once per process; started at boot by src/instrumentation.ts).
 * Also installs the live-update hooks and primes the reachability probes routing reads.
 */
export function ensureRunner(): void {
  watchGenerations(db());
  const cur = globalThis.__fuobeRunner;
  if (cur) {
    // After a dev hot-reload, point the existing timers at this module's (fresh) code.
    cur.tick = tick;
    cur.fast = fastTick;
    cur.polling ??= new Set();
    if (!cur.fastTimer) {
      cur.fastTimer = setInterval(() => void globalThis.__fuobeRunner?.fast?.(), FAST_POLL_MS);
      cur.fastTimer.unref?.();
    }
    return;
  }
  const state: RunnerState = {
    busy: false,
    tick,
    fast: fastTick,
    polling: new Set(),
    timer: setInterval(() => void globalThis.__fuobeRunner?.tick(), POLL_MS),
    fastTimer: setInterval(() => void globalThis.__fuobeRunner?.fast?.(), FAST_POLL_MS),
  };
  state.timer.unref?.();
  state.fastTimer?.unref?.();
  globalThis.__fuobeRunner = state;
  void probeComfy().catch(() => false);
  void probeOllama().catch(() => false);
  sweepInterrupted();
}

/** Jobs that never got an external id (the server died mid-submit) can't be recovered. Runs every tick. */
function sweepInterrupted(): void {
  const rows = db()
    .prepare("SELECT id FROM generations WHERE status IN ('queued','running') AND external_id IS NULL AND depends_on IS NULL AND created_at < ?")
    .all(Date.now() - STALE_SUBMIT_MS) as Pick<Row, "id">[];
  const busy = submitting();
  for (const r of rows) {
    if (busy.has(r.id)) continue;
    update(r.id, { status: "failed", error: "Interrupted before it reached the provider", completed_at: Date.now(), message: null });
  }
}

async function pollGuarded(r: Row): Promise<void> {
  const polling = (globalThis.__fuobeRunner!.polling ??= new Set());
  if (polling.has(r.id)) return;
  polling.add(r.id);
  try {
    await pollOne(r);
  } catch (e) {
    update(r.id, { message: `Poll error: ${(e as Error).message}` });
  } finally {
    polling.delete(r.id);
  }
}

async function tick(): Promise<void> {
  const state = globalThis.__fuobeRunner;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    sweepInterrupted();
    const active = db()
      .prepare("SELECT * FROM generations WHERE status IN ('queued','running') AND external_id IS NOT NULL ORDER BY created_at ASC LIMIT 50")
      .all() as Row[];
    await Promise.all([...active.map(pollGuarded), pollTrainings().catch(() => {}), advanceDependents().catch(() => {})]);
  } finally {
    state.busy = false;
  }
}

async function fastTick(): Promise<void> {
  const state = globalThis.__fuobeRunner;
  if (!state || state.fastBusy) return;
  state.fastBusy = true;
  try {
    const rows = db()
      .prepare(
        "SELECT g.*, r.started_at AS run_started_at FROM generations g LEFT JOIN generation_runs r ON r.id = g.id WHERE g.status = 'running' AND g.external_id IS NOT NULL AND g.progress IS NOT NULL ORDER BY g.created_at ASC LIMIT 50",
      )
      .all() as (Row & { run_started_at: number | null })[];
    const now = Date.now();
    // At 90% (or on course to be there by now, at the pace it has reported since it started).
    const nearlyDone = rows.filter((r) => {
      const p = r.progress ?? 0;
      if (p >= 0.9) return true;
      const ran = r.run_started_at ? r.updated_at - r.run_started_at : 0;
      return ran > 0 && p > 0 && (p * (now - r.run_started_at!)) / ran >= 0.9;
    });
    await Promise.all(nearlyDone.slice(0, 20).map(pollGuarded));
  } finally {
    state.fastBusy = false;
  }
}

function runRoute(model: NonNullable<ReturnType<typeof getModel>>, r: Pick<Row, "op" | "provider">): ModelRoute {
  return model.routes.find((x) => x.op === r.op && (x.provider === r.provider || r.provider === "mock")) ?? model.routes[0];
}

function pollContext(r: Row, model: NonNullable<ReturnType<typeof getModel>>): PollContext {
  return { externalId: r.external_id!, meta: JSON.parse(r.external_meta_json ?? "{}") as Record<string, unknown>, route: runRoute(model, r), model, createdAt: r.created_at };
}

async function pollOne(r: Row): Promise<void> {
  const model = getModel(r.model_id);
  if (!model) {
    update(r.id, { status: "failed", error: `Model ${r.model_id} no longer exists`, completed_at: Date.now() });
    return;
  }
  // The clock runs from when the provider got the job (and from when it started it), not from creation:
  // a chained step created at the start of a long pipeline gets its full time once it's submitted.
  const now = Date.now();
  let run = db().prepare("SELECT submitted_at, started_at FROM generation_runs WHERE id = ?").get(r.id) as { submitted_at: number; started_at: number | null } | undefined;
  if (!run) {
    // Submitted before this was recorded (an upgrade mid-job): start counting now.
    recordSubmission(r.id, now);
    run = { submitted_at: now, started_at: null };
  }
  const ctx = pollContext(r, model);
  // Poll first: a job that finished while the server was asleep or down is collected, not timed out.
  let res: PollResult | undefined;
  let pollError: unknown;
  try {
    res = await provider(r.provider).poll(ctx);
  } catch (e) {
    pollError = e;
  }
  if (!res || res.state === "queued" || res.state === "running") {
    // A job that has just left the queue gets its full running time from now.
    const startsNow = res?.state === "running" && !run.started_at;
    const overdue = run.started_at ? now - run.started_at > TIMEOUT_MS : !startsNow && now - run.submitted_at > QUEUE_TIMEOUT_MS;
    if (overdue) {
      // Stop the provider's job too, so it doesn't keep rendering (or billing) for nothing.
      await provider(r.provider)
        .cancel?.(ctx)
        .catch(() => {});
      update(r.id, {
        status: "failed",
        error: run.started_at ? `Timed out after ${TIMEOUT_MS / 60_000} minutes` : `Timed out waiting ${QUEUE_TIMEOUT_MS / 3_600_000} hours in the provider's queue`,
        completed_at: now,
        message: null,
      });
      return;
    }
    if (!res) throw pollError;
    if (startsNow) db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now(), r.id);
    update(r.id, { status: res.state, progress: res.progress ?? r.progress, message: res.message ?? null });
    return;
  }
  if (res.state === "failed") {
    update(r.id, { status: "failed", error: res.error, completed_at: Date.now(), message: null });
    return;
  }
  // Mark first so a slow download isn't polled twice.
  update(r.id, { status: "running", progress: 0.99, message: "Saving results" });
  const outputs: OutputFile[] = [];
  // Remove background: of a cut-out and its mask (BiRefNet's answer), the one asked for (params.matteOutput).
  const matte = r.op === "bg-remove-video" ? (JSON.parse(r.request_json) as GenerationRequest).params?.matteOutput : undefined;
  for (const o of keepMatte(res.outputs as RichOutput[], matte)) {
    try {
      outputs.push(await persistOutput(o, r.id));
    } catch (e) {
      outputs.push({ url: o.url, kind: o.kind ?? r.kind, ...inlineText(o.text, o.meta), ...(o.draftId ? { draftId: o.draftId } : {}) });
      console.warn(`[fuobe] could not save output for ${r.id}: ${(e as Error).message}`);
    }
  }
  update(r.id, {
    status: "succeeded",
    outputs_json: JSON.stringify(outputs),
    progress: 1,
    message: null,
    completed_at: Date.now(),
  });
}

/** Outputs may carry text (transcripts, translations, scripts) and structured extras (layer boxes, cues, stems). */
type RichOutput = RemoteOutput & { text?: string; meta?: Record<string, unknown> };

/**
 * Text kept inline on the generation. Every list page and live event carries it, so longer text
 * (long transcripts, scripts) is cut there, marked `meta.truncated`, and read in full from its file.
 */
export const MAX_INLINE_TEXT = 64_000;

function inlineText(text: string | undefined, meta: Record<string, unknown> | undefined): Pick<OutputFile, "text" | "meta"> {
  if (text === undefined) return meta ? { meta } : {};
  if (text.length <= MAX_INLINE_TEXT) return { text, ...(meta && { meta }) };
  return { text: text.slice(0, MAX_INLINE_TEXT), meta: { ...meta, truncated: true } };
}

async function persistOutput(o: RichOutput, generationId: string): Promise<OutputFile> {
  let data: Buffer;
  let contentType = o.contentType;
  if (!o.url && o.text !== undefined) {
    data = Buffer.from(o.text);
    contentType ??= "text/plain";
  } else if (o.url.startsWith("sample:")) {
    const file = path.join(process.cwd(), "public", "samples", path.basename(o.url.slice(7)));
    data = fs.readFileSync(file);
    contentType ??= contentTypeFor(file);
  } else if (o.url.startsWith("data:")) {
    const f = await readRef(o.url);
    data = f.data;
    contentType ??= f.contentType;
  } else {
    const res = await fetch(o.url, { headers: o.headers });
    if (!res.ok) throw new Error(`download ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
    const header = res.headers.get("content-type")?.split(";")[0];
    contentType ??= header && header !== "application/octet-stream" ? header : contentTypeFor(new URL(o.url).searchParams.get("filename") ?? o.url);
  }
  const asset = saveFile({ data, contentType: contentType!, source: "generation", generationId });
  // A text file's words travel with the generation, so feeds and the next chained step can use them.
  const text = o.text ?? (asset.kind === "text" ? data.toString("utf8") : undefined);
  return {
    url: asset.url,
    kind: asset.kind,
    contentType: asset.contentType,
    assetId: asset.id,
    ...inlineText(text, o.meta),
    ...(o.draftId ? { draftId: o.draftId } : {}),
  };
}

export async function cancelGeneration(id: string): Promise<void> {
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!r || (r.status !== "queued" && r.status !== "running")) return;
  const model = getModel(r.model_id);
  // Without an external id the job is still being handed over: submit() cancels it as soon as it lands.
  if (r.external_id && model) {
    await provider(r.provider)
      .cancel?.(pollContext(r, model))
      .catch(() => {});
  }
  update(id, { status: "canceled", completed_at: Date.now(), message: null });
}

// ---------------------------------------------------------------------------
// Results made in the browser (colour grading): stored as finished generations.

export function recordLocalGeneration(input: {
  feature: string;
  modelId: string;
  op: Generation["op"];
  prompt: string;
  inputs: GenerationRequest["inputs"];
  params?: GenerationRequest["params"];
  output: { url: string; kind: OutputFile["kind"]; contentType?: string };
}): Generation {
  const model = getModel(input.modelId);
  if (!model || !model.routes.some((r) => r.provider === "local")) throw new Error("Not a browser tool");
  const now = Date.now();
  const req: GenerationRequest = { feature: input.feature, modelId: input.modelId, op: input.op, prompt: input.prompt, inputs: input.inputs, params: input.params };
  const row: Row = {
    id: nanoid(12),
    batch_id: null,
    feature: input.feature,
    preset_id: null,
    model_id: model.id,
    engine: model.engine,
    provider: "local",
    op: input.op,
    kind: input.output.kind,
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: input.prompt,
    request_json: JSON.stringify(req),
    provider_input_json: null,
    external_id: "local",
    external_meta_json: null,
    outputs_json: JSON.stringify([input.output]),
    error: null,
    cost_usd: 0,
    favorite: 0,
    created_at: now,
    updated_at: now,
    completed_at: now,
    depends_on: null,
  };
  db()
    .prepare(`INSERT INTO generations (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toGeneration(row);
}
