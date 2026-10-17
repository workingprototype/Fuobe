import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getModel, getPreset } from "@/lib/catalog";
import { applyMentions } from "@/lib/catalog/elements";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
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
import { provider } from "./providers";
import type { RemoteOutput } from "./providers/types";
import { convertMask } from "./png";
import { engineMode, getSetting } from "./settings";
import { contentTypeFor, readRef, saveFile } from "./storage";

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
}

function toGeneration(r: Row): Generation {
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
    request: JSON.parse(r.request_json) as GenerationRequest,
    outputs: JSON.parse(r.outputs_json) as OutputFile[],
    error: r.error,
    costUsd: r.cost_usd,
    favorite: !!r.favorite,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

function update(id: string, fields: Partial<Row>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE generations SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

export function getGeneration(id: string): Generation | null {
  ensureRunner();
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  return r ? toGeneration(r) : null;
}

export interface ListOptions {
  batchId?: string;
  feature?: string;
  features?: string[];
  kind?: string;
  favorites?: boolean;
  status?: string;
  limit?: number;
  before?: number;
  q?: string;
}

export function listGenerations(o: ListOptions = {}): Generation[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (o.batchId) {
    where.push("batch_id = ?");
    args.push(o.batchId);
  }
  if (o.feature) {
    where.push("feature = ?");
    args.push(o.feature);
  }
  if (o.features?.length) {
    where.push(`(${o.features.map(() => "feature LIKE ?").join(" OR ")})`);
    args.push(...o.features.map((f) => (f.endsWith("*") ? `${f.slice(0, -1)}%` : f)));
  }
  if (o.kind) {
    where.push("kind = ?");
    args.push(o.kind);
  }
  if (o.favorites) where.push("favorite = 1");
  if (o.status) {
    where.push("status = ?");
    args.push(o.status);
  }
  if (o.before) {
    where.push("created_at < ?");
    args.push(o.before);
  }
  if (o.q) {
    where.push("prompt LIKE ?");
    args.push(`%${o.q}%`);
  }
  const sql = `SELECT * FROM generations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, Math.min(o.limit ?? 60, 200)) as Row[]).map(toGeneration);
}

export function setFavorite(id: string, favorite: boolean): void {
  update(id, { favorite: favorite ? 1 : 0 });
}

export function deleteGeneration(id: string): void {
  db().prepare("DELETE FROM generations WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Routing

/** Pick the provider for a run: a configured real provider, else the demo provider (unless demo is off). */
export function chooseRoute(candidates: ModelRoute[]): { route: ModelRoute; demo: boolean } {
  // Honour the preferred cloud aggregator (Settings → API configuration) when a model is on several.
  const preferred = getSetting("cloudProvider");
  const routes = preferred === "auto" ? candidates : [...candidates].sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  const demo = getSetting("demoMode");
  if (demo === "on") return { route: routes[0], demo: true };
  const real = routes.find((r) => provider(r.provider).isConfigured());
  if (real) return { route: real, demo: false };
  if (demo === "off") {
    const names = [...new Set(routes.map((r) => provider(r.provider).label))].join(" or ");
    throw new Error(`Connect ${names} in Settings to run this model`);
  }
  return { route: routes[0], demo: true };
}

// ---------------------------------------------------------------------------
// Create

/** Resolve mentions and drawings, plan, enforce the engine mode and pick a provider route. */
function prepare(original: GenerationRequest) {
  // @element mentions become reference images / LoRAs; the stored request keeps the mentions for "Reuse".
  const model = getModel(original.modelId);
  const req = model ? stripMotionPaths(applySketch(applyMentions(original, model, listElements()).request, model).request, model) : original;
  const plan = planGeneration(req, getModel, getPreset);
  const mode = engineMode();
  if (mode !== "both" && plan.model.engine !== mode) {
    throw new Error(
      mode === "open"
        ? `${plan.model.name} is a paid cloud model, but this install is set to open source only (Settings → Engine mode)`
        : `${plan.model.name} is an open-source model, but this install is set to paid cloud APIs only (Settings → Engine mode)`,
    );
  }
  const { route, demo } = chooseRoute(routesFor(plan.model, plan.op));
  const providerId: ProviderId = demo ? "mock" : route.provider;
  return { req, plan, route, demo, providerId, cost: demo ? 0 : estimateCost(plan.model, plan.params, 1) };
}

/** What a request would run as — model, operation, job count and cost — without starting it. */
export function previewGeneration(req: GenerationRequest) {
  const { plan, demo, providerId, cost } = prepare(req);
  return { model: plan.model, op: plan.op, jobs: plan.jobs, outputs: plan.jobs * plan.perJobOutputs, demo, providerId, costUsd: cost === null ? null : cost * plan.jobs };
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
      kind: OPERATION_OUTPUT[plan.op],
      status: "queued",
      progress: null,
      message: waits ? (original.frame ? "Waits for the previous frame" : "Waits for the earlier steps") : demo ? "Demo mode — no provider connected" : "Submitting",
      prompt: plan.prompt,
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
  if (req.chain?.length) return req.chain.slice(0, n);
  return Array.from({ length: n }, () => ({ slot: "images" as const, position: req.chainFrom ?? "last" }));
}

const SLOT_KIND: Record<ChainSlot["slot"], MediaKind> = { images: "image", endImage: "image", video: "video", videos: "video", audio: "audio" };

function placeholderFor(s: ChainSlot): string {
  return SLOT_KIND[s.slot] === "image" ? "/api/files/placeholder.png" : SLOT_KIND[s.slot] === "video" ? "/api/files/placeholder.mp4" : "/api/files/placeholder.wav";
}

/** Put the dependencies' outputs into the request's inputs, slot by slot (lists keep dependency order). */
export function withChainInputs(req: GenerationRequest, urls: string[]): GenerationRequest {
  const inputs = { ...req.inputs };
  const slots = slotsFor(req, urls.length);
  for (const k of ["images", "videos"] as const) {
    const at = (pos: "first" | "last") => slots.flatMap((s, i) => (s.slot === k && (s.position ?? "last") === pos ? [urls[i]] : []));
    const first = at("first");
    const last = at("last");
    if (first.length || last.length) inputs[k] = [...first, ...(inputs[k] ?? []), ...last];
  }
  slots.forEach((s, i) => {
    if (s.slot !== "images" && s.slot !== "videos") inputs[s.slot] = urls[i];
  });
  return { ...req, inputs };
}

/** Launch dependent jobs whose inputs finished; fail the ones whose inputs failed. */
const launching = new Set<string>();
async function advanceDependents(): Promise<void> {
  const rows = db()
    .prepare("SELECT * FROM generations WHERE status = 'queued' AND external_id IS NULL AND depends_on IS NOT NULL ORDER BY created_at ASC LIMIT 50")
    .all() as Row[];
  for (const r of rows) {
    if (launching.has(r.id)) continue;
    const request = JSON.parse(r.request_json) as GenerationRequest;
    const ids = depIds(r.depends_on);
    const slots = slotsFor(request, ids.length);
    const deps = ids.map((id) => db().prepare("SELECT status, outputs_json FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "outputs_json"> | undefined);
    const earlier = request.frame ? "The previous frame" : "An earlier step";
    if (deps.some((d) => !d || d.status === "failed" || d.status === "canceled")) {
      update(r.id, { status: "failed", error: `${earlier} didn't finish`, message: null, completed_at: Date.now() });
      continue;
    }
    if (deps.some((d) => d!.status !== "succeeded")) continue;
    const urls = deps.map((d, i) => (JSON.parse(d!.outputs_json) as OutputFile[]).find((o) => o.kind === SLOT_KIND[slots[i].slot])?.url);
    if (urls.some((u) => !u)) {
      update(r.id, { status: "failed", error: `${earlier} has no ${SLOT_KIND[slots[urls.findIndex((u) => !u)].slot]} to use`, message: null, completed_at: Date.now() });
      continue;
    }
    launching.add(r.id);
    try {
      const original = withChainInputs(request, urls as string[]);
      const { req, plan, route, providerId, cost, demo } = prepare(original);
      update(r.id, {
        provider: providerId,
        op: plan.op,
        prompt: plan.prompt,
        cost_usd: cost,
        request_json: JSON.stringify(original),
        message: demo ? "Demo mode — no provider connected" : "Submitting",
      });
      await submit(r.id, route, providerId, plan, req, 0);
    } catch (e) {
      update(r.id, { status: "failed", error: (e as Error).message, message: null, completed_at: Date.now() });
    } finally {
      launching.delete(r.id);
    }
  }
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
      voiceAudio: await prep(req.inputs?.voiceAudio),
      voiceAudio2: await prep(req.inputs?.voiceAudio2),
      videos: (await Promise.all((req.inputs?.videos ?? []).map(prep))).filter(Boolean) as string[],
      loras: plan.loras,
      // Vary seeds across a batch so N jobs don't return N identical results.
      seed: plan.params.seed !== undefined && plan.params.seed >= 0 ? plan.params.seed + index : undefined,
    };
    const res = await adapter.submit({ generationId: id, model: plan.model, route, input });
    update(id, {
      external_id: res.externalId,
      external_meta_json: JSON.stringify(res.meta ?? {}),
      provider_input_json: res.payload ? JSON.stringify(res.payload).slice(0, 200_000) : null,
      message: "Queued",
    });
  } catch (e) {
    update(id, { status: "failed", error: (e as Error).message, completed_at: Date.now(), message: null });
  }
}

// ---------------------------------------------------------------------------
// Polling loop

const POLL_MS = 1500;
const TIMEOUT_MS = 45 * 60 * 1000;

declare global {
  var __fuobeRunner: { timer: NodeJS.Timeout; busy: boolean; tick: () => Promise<void> } | undefined;
}

export function ensureRunner(): void {
  if (globalThis.__fuobeRunner) {
    // After a dev hot-reload, point the existing timer at this module's (fresh) code.
    globalThis.__fuobeRunner.tick = tick;
    return;
  }
  const state = { busy: false, tick, timer: setInterval(() => void globalThis.__fuobeRunner?.tick(), POLL_MS) };
  state.timer.unref?.();
  globalThis.__fuobeRunner = state;
  // Jobs that never got an external id (server died mid-submit) can't be recovered.
  db()
    .prepare(
      "UPDATE generations SET status = 'failed', error = 'Interrupted before it reached the provider', completed_at = ? WHERE status IN ('queued','running') AND external_id IS NULL AND depends_on IS NULL AND created_at < ?",
    )
    .run(Date.now(), Date.now() - 2 * 60 * 1000);
}

async function tick(): Promise<void> {
  const state = globalThis.__fuobeRunner;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    const active = db()
      .prepare("SELECT * FROM generations WHERE status IN ('queued','running') AND external_id IS NOT NULL ORDER BY created_at ASC LIMIT 50")
      .all() as Row[];
    await Promise.all([
      ...active.map((r) => pollOne(r).catch((e) => update(r.id, { message: `Poll error: ${(e as Error).message}` }))),
      pollTrainings().catch(() => {}),
      advanceDependents().catch(() => {}),
    ]);
  } finally {
    state.busy = false;
  }
}

async function pollOne(r: Row): Promise<void> {
  const model = getModel(r.model_id);
  if (!model) {
    update(r.id, { status: "failed", error: `Model ${r.model_id} no longer exists`, completed_at: Date.now() });
    return;
  }
  if (Date.now() - r.created_at > TIMEOUT_MS) {
    update(r.id, { status: "failed", error: "Timed out", completed_at: Date.now() });
    return;
  }
  const route = model.routes.find((x) => x.op === r.op && (x.provider === r.provider || r.provider === "mock")) ?? model.routes[0];
  const res = await provider(r.provider).poll({
    externalId: r.external_id!,
    meta: JSON.parse(r.external_meta_json ?? "{}") as Record<string, unknown>,
    route,
    model,
    createdAt: r.created_at,
  });
  if (res.state === "queued" || res.state === "running") {
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
  for (const o of res.outputs) {
    try {
      outputs.push(await persistOutput(o, r.id));
    } catch (e) {
      outputs.push({ url: o.url, kind: o.kind ?? r.kind, ...(o.draftId ? { draftId: o.draftId } : {}) });
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

async function persistOutput(o: RemoteOutput, generationId: string): Promise<OutputFile> {
  let data: Buffer;
  let contentType = o.contentType;
  if (o.url.startsWith("sample:")) {
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
  return { url: asset.url, kind: asset.kind, contentType: asset.contentType, assetId: asset.id, ...(o.draftId ? { draftId: o.draftId } : {}) };
}

export async function cancelGeneration(id: string): Promise<void> {
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!r || (r.status !== "queued" && r.status !== "running")) return;
  const model = getModel(r.model_id);
  if (r.external_id && model) {
    await provider(r.provider)
      .cancel?.({
        externalId: r.external_id,
        meta: JSON.parse(r.external_meta_json ?? "{}") as Record<string, unknown>,
        route: model.routes[0],
        model,
        createdAt: r.created_at,
      })
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
