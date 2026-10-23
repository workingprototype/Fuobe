import "server-only";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import {
  chooseEraser,
  paintedPoints,
  pieceSeconds,
  planPieces,
  planMaskPreview,
  planRemoval,
  rangeProblem,
  REMOVE,
  removalProblem,
  removalTitle,
  scalePoints,
  wholeClip,
  type Eraser,
  type RemovalPlanInput,
  type RemoveMode,
  type RemoveRange,
  type RemoveSource,
} from "@/lib/catalog/remove-object";
import type { PlanStep } from "@/lib/catalog/shorts";
import type { Engine, Generation, PixelPoint } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
import { decodePng } from "./png";
import { engineMode } from "./settings";
import { probeSource, ShortsError } from "./shorts";
import { readRef } from "./storage";

/**
 * Video tools → Remove object: plans, prices and starts a removal (src/lib/catalog/remove-object.ts) as one
 * pipeline of ordinary generations: feature "remove-object" for the finished video, "remove-object-step" for
 * the cuts, tracks, pieces and joins, "remove-object-preview" for mask previews. No table of its own: the
 * page's history is a feed.
 */

export { ShortsError as RemovalError };

export interface RemovalBody {
  engine: Engine;
  mode: RemoveMode;
  /** The eraser picked (defaults per engine and mode). */
  modelId?: string;
  /** "Shadows and reflections too": VOID. */
  effects?: boolean;
  /** Type it: what to remove. */
  prompt?: string;
  /** Click it: points on the first frame of the range, in `frame` pixels. */
  points?: PixelPoint[];
  /** The picture the points or the paint were made on (the first frame the browser showed). */
  frame?: { width: number; height: number };
  /** Paint it: the mask of that frame (white = remove), an uploaded PNG. */
  mask?: string;
  source: { url: string; name?: string; duration?: number; fps?: number; width?: number; height?: number; hasAudio?: boolean };
  range?: RemoveRange;
  seed?: number;
}

const fileUrl = z.string().startsWith("/api/files/").max(500);
const seconds = z.number().finite().min(0).max(3600);
const point = z.object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000), label: z.enum(["positive", "negative"]).optional() });

/** The body of /api/remove-object (and /estimate, /preview). */
export const RemovalBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  mode: z.enum(["type", "click", "paint"]),
  modelId: z.string().max(80).optional(),
  effects: z.boolean().optional(),
  prompt: z.string().max(2500).optional(),
  points: z.array(point).max(REMOVE.maxPoints).optional(),
  frame: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).optional(),
  mask: fileUrl.optional(),
  source: z.object({
    url: fileUrl,
    name: z.string().max(200).optional(),
    duration: z.number().finite().positive().max(3600).optional(),
    fps: z.number().finite().positive().max(240).optional(),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
    hasAudio: z.boolean().optional(),
  }),
  range: z.object({ start: seconds, end: seconds }).optional(),
  seed: z.number().int().min(0).max(2 ** 48).optional(),
  /** A client nonce for one submit: a repeat gets the first answer (see once()). */
  requestId: z.string().trim().min(8).max(64).optional(),
});

/** The estimate is asked for before the upload finishes: any URL stands in. */
export const RemovalEstimateSchema = RemovalBodySchema.extend({
  source: RemovalBodySchema.shape.source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }),
  mask: z.string().max(500).optional(),
});

/**
 * Kling O3 edit is priced per generated second ($0.168/s, paid-model-apis-4.md §3), but the catalog model has no
 * price of its own (its text- and image-to-video routes cost less): the removal estimate uses the edit price.
 */
const EDIT_USD_PER_SECOND: Record<string, number> = { "kling-o3": 0.168 };

const mustMatchMode = (engine: Engine) => {
  const mode = engineMode();
  if (mode !== "both" && mode !== engine) {
    throw new ShortsError(mode === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
};

/** Points a SAM 3.1 track starts from: the deepest points of the paint, in the clip's pixels. */
async function pointsFromPaint(mask: string, size: { width?: number; height?: number }): Promise<PixelPoint[]> {
  let png: ReturnType<typeof decodePng>;
  try {
    png = decodePng((await readRef(mask)).data);
  } catch {
    throw new ShortsError("Couldn't read the painted mask — paint it again", 400);
  }
  const on = new Uint8Array(png.width * png.height);
  for (let i = 0; i < on.length; i++) on[i] = png.data[i * 4] > 127 ? 1 : 0;
  const found = paintedPoints(on, png.width, png.height);
  if (!found.length) throw new ShortsError("Paint over what to remove first");
  return size.width && size.height ? scalePoints(found, png, { width: size.width, height: size.height }) : found;
}

interface Planned {
  input: RemovalPlanInput;
  eraser: Eraser;
  notes: string[];
}

async function planInput(body: RemovalBody, opts: { probe: boolean; preview?: boolean }): Promise<Planned> {
  mustMatchMode(body.engine);
  const picked = chooseEraser({ engine: body.engine, mode: body.mode, effects: body.effects, modelId: body.modelId });
  if ("problem" in picked) throw new ShortsError(picked.problem, 422);
  const eraser = picked.eraser;
  // The header's facts win over what the browser read (the estimate runs before the upload is read).
  const info = opts.probe ? await probeSource(body.source.url) : {};
  const source: RemoveSource = {
    url: body.source.url,
    duration: info.duration ?? body.source.duration,
    fps: info.fps ?? body.source.fps,
    width: info.width ?? body.source.width,
    height: info.height ?? body.source.height,
    // Sound we couldn't read counts as none (putting it back would fail after the erasing was paid for).
    hasAudio: opts.probe ? (info.hasAudio ?? false) : (body.source.hasAudio ?? false),
  };
  const range = body.range ?? (source.duration ? { start: 0, end: source.duration } : null);
  if (!range) throw new ShortsError("Reading the clip… try again in a moment");
  // A mask preview runs on SAM 3.1 alone: the eraser's own limits don't apply to it.
  const problem = opts.preview ? rangeProblem(source, range) : removalProblem(eraser, source, range);
  if (problem) throw new ShortsError(problem, 422);

  let points: PixelPoint[] | undefined;
  if (body.mode === "type" && !eraser.everyone && !body.prompt?.trim()) throw new ShortsError("Say what to remove, e.g. “the coffee cup in her hand”");
  if (body.mode === "click") {
    const given = (body.points ?? []).slice(0, REMOVE.maxPoints);
    if (!given.some((p) => p.label !== "negative")) throw new ShortsError("Click what to remove on the first frame");
    points = body.frame && source.width && source.height ? scalePoints(given, body.frame, { width: source.width, height: source.height }) : given;
  }
  if (body.mode === "paint") {
    if (!body.mask) throw new ShortsError("Paint over what to remove first");
    // The cloud's tracker takes points, not paint; the open graph reads the mask itself.
    if (eraser.engine === "cloud") points = opts.probe ? await pointsFromPaint(body.mask, source) : [{ x: 1, y: 1, label: "positive" }];
  }

  const notes: string[] = [];
  const len = range.end - range.start;
  const model = getModel(eraser.id);
  if (eraser.window) {
    const fps = source.fps ?? 30;
    const per = eraser.window.cap / fps;
    const windows = source.fps ? planPieces(eraser, source, range).length : Math.ceil((len * fps) / eraser.window.cap);
    if (windows > 1) {
      notes.push(`${model?.name ?? eraser.label} works on ${eraser.window.cap} frames at a time (${per.toFixed(1)} s of this clip): the clip runs as ${windows} windows, joined with its own sound. Seams between windows aren't tested on a GPU yet`);
      if (eraser.modes.includes("paint")) notes.push("SAM 3.1 hands what you painted on from window to window (each starts on the last frame of the one before), so the windows run one after another");
    }
    notes.push(eraser.effects ? "VOID needs a 24–40 GB GPU (unverified). Its CogVideoX base is licensed for commercial use only after registering, up to 1 million visits a month" : "Wan 2.1 VACE 14B needs a 24 GB GPU · Apache-2.0 (SAM 3.1: Meta's SAM License)");
  } else {
    const max = pieceSeconds(eraser, source.fps);
    if (len > max + 0.01) notes.push(`${model?.name ?? eraser.label} takes ${max < 5 ? "clips under 5 s" : `up to ${Math.floor(max)} s`}: the clip is cut into ${Math.ceil(len / max - 1e-9)} pieces, erased one by one and joined, with its own sound put back. Seams between pieces aren't tested yet`);
    if (body.mode !== "type" && (body.mode === "paint" || len > max + 0.01)) notes.push("SAM 3.1 first follows what you " + (body.mode === "paint" ? "painted" : "clicked") + " through the whole selection; Bria then erases that mask");
    if (eraser.everyone) notes.push("LTX Clean Plate removes every person in the shot — it doesn't take a target");
  }
  if (!wholeClip(range, source.duration)) notes.push("Only the selected part comes out (the rest of the clip isn't kept)");

  const name = (body.source.name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  const title = removalTitle({ mode: body.mode, prompt: body.prompt, everyone: eraser.everyone });
  return {
    eraser,
    notes,
    input: {
      engine: body.engine,
      mode: body.mode,
      eraser,
      title: name ? `${title} · ${name}` : title,
      source,
      range,
      prompt: body.prompt?.trim() || undefined,
      points,
      mask: body.mode === "paint" && eraser.engine === "open" ? body.mask : undefined,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    },
  };
}

const withChain = (s: PlanStep) => ({ ...s.request, ...(s.chain ? { chain: s.chain } : {}) });

/** What the steps cost together (null when a price is unknown) and whether they would run as a demo. */
function price(steps: PlanStep[]): { costUsd: number | null; demo: boolean } {
  let cost: number | null = 0;
  let demo = false;
  for (const s of steps) {
    let p: ReturnType<typeof previewChained>;
    try {
      p = previewChained(withChain(s), s.after?.length ?? 0);
    } catch (e) {
      throw new ShortsError((e as Error).message, 422);
    }
    demo ||= p.demo;
    const edit = EDIT_USD_PER_SECOND[s.request.modelId];
    const usd = p.costUsd ?? (edit !== undefined ? edit * (s.request.params?.duration ?? 0) : null);
    cost = cost === null || usd === null ? null : cost + usd;
  }
  return { costUsd: cost === null ? null : Math.round(cost * 10000) / 10000, demo };
}

export interface RemovalEstimate {
  costUsd: number | null;
  demo: boolean;
  /** The eraser that runs (the default for the mode, or the one picked). */
  modelId: string;
  modelName: string;
  /** Pieces (cloud) or windows (open) the clip is erased in. */
  pieces: number;
  seconds: number;
  steps: number;
  notes: string[];
  /** The mask preview's price, or null when this engine and mode have none. */
  previewUsd: number | null;
}

export async function estimateRemoval(body: RemovalBody): Promise<RemovalEstimate> {
  const { input, eraser, notes } = await planInput(body, { probe: false });
  const plan = planRemoval(input);
  const preview = planMaskPreview({ ...input, prompt: input.prompt, points: input.points });
  return {
    ...price(plan.steps),
    modelId: eraser.id,
    modelName: getModel(eraser.id)?.name ?? eraser.label,
    pieces: plan.pieces.length,
    seconds: Math.round((input.range.end - input.range.start) * 100) / 100,
    steps: plan.steps.length,
    notes,
    previewUsd: preview ? price(preview).costUsd : null,
  };
}

function run(steps: PlanStep[]) {
  try {
    return createPipeline(steps);
  } catch (e) {
    throw new ShortsError((e as Error).message, 422);
  }
}

/** Start the removal; returns the finished video's generation (the other steps wait for each other). */
export async function createRemoval(body: RemovalBody): Promise<{ final: Generation; items: Generation[] }> {
  const { input } = await planInput(body, { probe: true });
  const plan = planRemoval(input);
  const p = run(plan.steps);
  return { final: p.byKey[plan.final], items: p.items };
}

/** A mask preview of the first seconds: what the engine would remove. */
export async function createRemovalPreview(body: RemovalBody): Promise<Generation> {
  const { input } = await planInput(body, { probe: true, preview: true });
  const steps = planMaskPreview(input);
  if (!steps) throw new ShortsError(input.engine === "open" ? "The open engine previews masks of what you type — your paint is the preview here" : "Name, click or paint what to remove first", 422);
  return run(steps).byKey.preview;
}
