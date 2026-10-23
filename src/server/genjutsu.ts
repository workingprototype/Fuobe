import "server-only";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import {
  chooseMaker,
  GENJUTSU,
  genjutsuProblem,
  genjutsuTitle,
  MODE_TARGETS,
  planGenjutsu,
  planMakerPieces,
  qualityFor,
  makerStepUsd,
  type GenjutsuLook,
  type GenjutsuMode,
  type GenjutsuPlanInput,
  type GenjutsuTarget,
  type GenjutsuTier,
  type Maker,
} from "@/lib/catalog/genjutsu";
import { scalePoints, wholeClip, type RemoveRange, type RemoveSource } from "@/lib/catalog/remove-object";
import type { PlanStep } from "@/lib/catalog/shorts";
import type { Engine, Generation, PixelPoint } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
import { provider } from "./providers";
import { pointsFromPaint } from "./remove-object";
import { engineMode } from "./settings";
import { probeSource, ShortsError } from "./shorts";

/**
 * Genjutsu (/genjutsu): plans, prices and starts a Motion transfer, Object swap, Restyle or Insert
 * (src/lib/catalog/genjutsu.ts) as one pipeline of ordinary generations: feature "genjutsu" for the finished video,
 * "genjutsu-step" for the cuts, tracks, pieces and joins. No table of its own: the page's history is a feed, and a
 * setup travels as a code (encodeSetup), not a row.
 */

export { ShortsError as GenjutsuError };

export interface GenjutsuBody {
  engine: Engine;
  mode: GenjutsuMode;
  /** The model picked (defaults per engine, mode and key). */
  modelId?: string;
  /** Genjutsu Lite ("standard") or the full model ("high"). */
  tier?: GenjutsuTier;
  quality?: string;
  target?: GenjutsuTarget;
  /** Object swap: what goes. */
  subject?: string;
  prompt?: string;
  points?: PixelPoint[];
  /** The picture the points or the paint were made on (the first frame the browser showed). */
  frame?: { width: number; height: number };
  mask?: string;
  references?: string[];
  look?: GenjutsuLook;
  source: { url: string; name?: string; duration?: number; fps?: number; width?: number; height?: number; hasAudio?: boolean };
  range?: RemoveRange;
  seed?: number;
}

const fileUrl = z.string().startsWith("/api/files/").max(500);
const seconds = z.number().finite().min(0).max(3600);
const point = z.object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000), label: z.enum(["positive", "negative"]).optional() });
const look = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), id: z.string().max(80) }),
  z.object({ kind: z.literal("higgsfield"), id: z.string().max(80), name: z.string().max(120).optional() }),
  z.object({ kind: z.literal("custom"), images: z.array(fileUrl).max(GENJUTSU.maxLookImages), words: z.string().max(300).optional() }),
]);

/** The body of /api/genjutsu (and /estimate). */
export const GenjutsuBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  mode: z.enum(["motion", "swap", "restyle", "insert"]),
  modelId: z.string().max(80).optional(),
  tier: z.enum(["standard", "high"]).optional(),
  quality: z.enum(["480p", "720p", "1080p"]).optional(),
  target: z.enum(["type", "click", "paint"]).optional(),
  subject: z.string().max(300).optional(),
  prompt: z.string().max(GENJUTSU.maxPromptChars).optional(),
  points: z.array(point).max(GENJUTSU.maxPoints).optional(),
  frame: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).optional(),
  mask: fileUrl.optional(),
  references: z.array(fileUrl).max(GENJUTSU.maxReferences).optional(),
  look: look.optional(),
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

/** The estimate is asked for before uploads finish: any URL stands in. */
export const GenjutsuEstimateSchema = GenjutsuBodySchema.extend({
  source: GenjutsuBodySchema.shape.source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }),
  mask: z.string().max(500).optional(),
  references: z.array(z.string().max(500)).max(GENJUTSU.maxReferences).optional(),
});

const mustMatchMode = (engine: Engine) => {
  const mode = engineMode();
  if (mode !== "both" && mode !== engine) {
    throw new ShortsError(mode === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
};

/** A Higgsfield key is set (Genjutsu and Genjutsu Lite run on it). */
export const higgsfieldReady = () => provider("higgsfield").isConfigured();

interface Planned {
  input: GenjutsuPlanInput;
  maker: Maker;
  notes: string[];
}

async function planInput(body: GenjutsuBody, opts: { probe: boolean }): Promise<Planned> {
  mustMatchMode(body.engine);
  const picked = chooseMaker({ engine: body.engine, mode: body.mode, target: body.target, tier: body.tier, look: body.look, modelId: body.modelId, higgsfield: higgsfieldReady() });
  if ("problem" in picked) throw new ShortsError(picked.problem, 422);
  const maker = picked.maker;
  // The header's facts win over what the browser read (the estimate runs before the upload is read).
  const info = opts.probe ? await probeSource(body.source.url) : {};
  const source: RemoveSource = {
    url: body.source.url,
    duration: info.duration ?? body.source.duration,
    fps: info.fps ?? body.source.fps,
    width: info.width ?? body.source.width,
    height: info.height ?? body.source.height,
    // Sound we couldn't read counts as none (putting it back would fail after the work was paid for).
    hasAudio: opts.probe ? (info.hasAudio ?? false) : (body.source.hasAudio ?? false),
  };
  const range = body.range ?? (source.duration ? { start: 0, end: Math.min(source.duration, GENJUTSU.maxSeconds) } : null);
  if (!range) throw new ShortsError("Reading the clip… try again in a moment");
  const target = MODE_TARGETS[body.mode].length ? (body.target ?? MODE_TARGETS[body.mode][0]) : undefined;
  const references = body.references ?? [];
  const clicks = (body.points ?? []).filter((p) => p.label !== "negative").length;
  const problem = genjutsuProblem({ mode: body.mode, maker, source, range, references: references.length, target, subject: body.subject, prompt: body.prompt, points: clicks, mask: !!body.mask, look: body.look });
  if (problem) throw new ShortsError(problem, 422);

  // Clicks on the first frame, in the clip's pixels; paint over several hosted VACE pieces is followed from its deepest points.
  let points: PixelPoint[] | undefined;
  const size = source.width && source.height ? { width: source.width, height: source.height } : null;
  if (target === "click") points = body.frame && size ? scalePoints(body.points!.slice(0, GENJUTSU.maxPoints), body.frame, size) : body.points;
  const pieces = planMakerPieces(maker, source, range);
  const n = pieces.length || 1;
  if (target === "paint" && maker.engine === "cloud" && body.mode === "swap" && n > 1) {
    points = opts.probe ? await pointsFromPaint(body.mask!, source, "Paint over what to swap first") : [{ x: 1, y: 1, label: "positive" }];
  }

  const notes = notesFor(body, maker, source, range, n, references.length);
  const name = (body.source.name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  const title = genjutsuTitle({ mode: body.mode, subject: body.subject, look: body.look });
  return {
    maker,
    notes,
    input: {
      engine: body.engine,
      mode: body.mode,
      maker,
      title: name ? `${title} · ${name}` : title,
      source,
      range,
      quality: body.quality ?? GENJUTSU.defaultQuality,
      references,
      target,
      subject: body.subject?.trim() || undefined,
      prompt: body.prompt?.trim() || undefined,
      points,
      mask: target === "paint" ? body.mask : undefined,
      look: body.look,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    },
  };
}

function notesFor(body: GenjutsuBody, m: Maker, source: RemoveSource, range: RemoveRange, n: number, refs: number): string[] {
  const notes: string[] = [];
  const name = getModel(m.id)?.name ?? m.label;
  const fps = source.fps ?? 30;
  const fuobeLook = body.mode === "restyle" && m.looks === "fuobe";
  if (n > 1) {
    if (m.engine === "open" && m.window) {
      notes.push(`${name} works on ${m.window.cap} frames at a time (${(m.window.cap / fps).toFixed(1)} s of this clip): it runs as ${n} windows, joined with the clip's own sound. Seams between windows aren't tested on a GPU yet`);
    } else if (fuobeLook) {
      notes.push(`${name} restyles ${m.engine === "open" ? "5 s" : "up to 10 s"} at a time: the clip runs as ${n} segments, joined with its own sound`);
    } else {
      const limit = m.window ? `${m.window.cap} frames (${(m.window.cap / fps).toFixed(1)} s of this clip)` : `${m.maxSeconds} s`;
      notes.push(`${name} takes up to ${limit} a call: the clip runs as ${n} pieces, joined with its own sound. Seams between pieces aren't tested yet`);
    }
  }
  if (body.mode !== "restyle" && refs > m.refs.max) notes.push(m.refs.max === 1 ? `${name} uses your first reference image` : `${name} takes ${m.refs.max} references — your first ${m.refs.max} go`);
  if (fuobeLook && refs) notes.push("Character references go with Higgsfield's looks (Genjutsu Restyle); this look restyles what is filmed");
  if (fuobeLook && body.look?.kind === "custom" && m.readsLookImages && body.look.images.length > m.readsLookImages) notes.push(`${name} reads ${m.readsLookImages} of your look's images`);
  if (body.mode === "restyle" && m.looks === "higgsfield" && refs > m.refs.max) notes.push(`Genjutsu Restyle takes ${m.refs.max} character references — your first ${m.refs.max} go`);
  const quality = body.quality ?? GENJUTSU.defaultQuality;
  const res = qualityFor(m, quality);
  if (m.engine === "cloud" && !m.qualities) notes.push(`${name} keeps your clip's size (it has no resolution setting)`);
  else if (res && res !== quality) notes.push(`${name} renders ${res} at most here — that's what you get`);
  if (m.id === "wan-22-vace-inpaint") {
    notes.push(body.mode === "insert" ? "The spot stays where you painted it for the whole shot — best with a still or slow camera" : "Only the area you marked changes; SAM 3.1 follows it through the selection when it runs as pieces or you clicked");
  }
  if (m.id === "oss-vace-insert") notes.push("The spot stays where you painted it for the whole shot — best with a still or slow camera");
  if (m.people) notes.push("P-Video Replace swaps the person on camera — for objects, pick Genjutsu or Kling O3");
  if (m.higgsfield) notes.push(`${m.tier === "standard" ? "Genjutsu Lite" : "Genjutsu"} is at 50% off on Higgsfield right now (2026-10-22) — the price here is the list price`);
  if (m.engine === "open") {
    if (m.id === "oss-wan22-animate") notes.push("Wan Animate 2 needs a 24 GB GPU · Apache-2.0");
    else if (m.window) notes.push(`Wan 2.1 VACE 14B needs a 24 GB GPU · Apache-2.0${body.mode === "swap" ? " (SAM 3.1: Meta's SAM License)" : ""}`);
  }
  if (!wholeClip(range, source.duration)) notes.push("Only the selected part comes out (the rest of the clip isn't kept)");
  return notes;
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
    // Genjutsu's tiers and Kling O3's edit price aren't in the catalog per resolution: the planner's table.
    const own = p.demo ? null : makerStepUsd(s.request.modelId, s.request.params);
    const usd = own ?? p.costUsd;
    cost = cost === null || usd === null ? null : cost + usd;
  }
  return { costUsd: cost === null ? null : Math.round(cost * 10000) / 10000, demo };
}

export interface GenjutsuEstimate {
  costUsd: number | null;
  demo: boolean;
  /** The model that runs (the default, or the one picked) and its tier. */
  modelId: string;
  modelName: string;
  tier?: GenjutsuTier;
  /** The resolution it is asked for (none: it keeps the clip's size). */
  quality?: string;
  pieces: number;
  seconds: number;
  steps: number;
  notes: string[];
  /** A Higgsfield key is set. */
  higgsfield: boolean;
}

export async function estimateGenjutsu(body: GenjutsuBody): Promise<GenjutsuEstimate> {
  const { input, maker, notes } = await planInput(body, { probe: false });
  let plan: ReturnType<typeof planGenjutsu>;
  try {
    plan = planGenjutsu(input);
  } catch (e) {
    throw new ShortsError((e as Error).message, 422);
  }
  return {
    ...price(plan.steps),
    modelId: maker.id,
    modelName: getModel(maker.id)?.name ?? maker.label,
    ...(maker.tier ? { tier: maker.tier } : {}),
    ...(qualityFor(maker, input.quality) ? { quality: qualityFor(maker, input.quality) } : {}),
    pieces: plan.pieces,
    seconds: Math.round((input.range.end - input.range.start) * 100) / 100,
    steps: plan.steps.length,
    notes,
    higgsfield: higgsfieldReady(),
  };
}

/** Start it; returns the finished video's generation (the other steps wait for each other). */
export async function createGenjutsu(body: GenjutsuBody): Promise<{ final: Generation; items: Generation[] }> {
  const { input } = await planInput(body, { probe: true });
  try {
    const plan = planGenjutsu(input);
    const p = createPipeline(plan.steps);
    return { final: p.byKey[plan.final], items: p.items };
  } catch (e) {
    if (e instanceof ShortsError) throw e;
    throw new ShortsError((e as Error).message, 422);
  }
}
