import "server-only";
import { getModel } from "@/lib/catalog";
import {
  clampFps,
  cleanValues,
  frameSampling,
  getMixedPreset,
  MIXED_FEATURE,
  MIXED_FRAME_FEATURE,
  MIXED_FRAME_MODELS,
  MIXED_MODELS,
  MIXED_STEP_FEATURE,
  mixedFrames,
  mixedRangeProblem,
  nearestResolution,
  planMixed,
  planMixedPreview,
  type MixedMode,
  type MixedPlanInput,
  type MixedResolution,
} from "@/lib/catalog/mixed-media";
import { clipLengthProblem, type PlanStep } from "@/lib/catalog/shorts";
import { sourceSeconds, takesImage } from "@/lib/catalog/shorts-models";
import type { Engine, Generation } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";
import { getGeneration, previewChained, unfilledRequest } from "./generations";
import { engineMode } from "./settings";
import { probeSource, ShortsError } from "./shorts";

/**
 * Mixed Media renders and preview frames. No table of its own: every render is a pipeline of
 * ordinary generations (feature "mixed-media" for the finished video, "mixed-media-step" for the
 * cut and the soundtrack-less render, "mixed-media-preview" for preview frames), so History is a feed.
 */

export { ShortsError as MixedError };

export interface MixedBody {
  engine: Engine;
  presetId: string;
  values?: Record<string, unknown>;
  source: { url: string; name?: string; duration?: number; fps?: number };
  range: { start: number; end: number };
  fps: number;
  resolution: MixedResolution;
  /** Cloud Fast: the restyle model; cloud Per frame: the frame editor (MIXED_FRAME_MODELS). */
  modelId?: string;
  /** Cloud: frame by frame (default) or Fast (one video-to-video pass). */
  mode?: MixedMode;
  /** Cloud: the approved preview still (anchors the render: Per frame always, Fast when the model takes an image). */
  anchor?: string;
  /** Cloud preview: the frame the browser grabbed at the start of the selection. */
  frameUrl?: string;
  seed?: number;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

async function planInput(body: MixedBody, opts: { probe: boolean }): Promise<{ input: MixedPlanInput; frames: number; fps: number; notes: string[] }> {
  const engines = engineMode();
  if (engines !== "both" && engines !== body.engine) {
    throw new ShortsError(engines === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
  const preset = getMixedPreset(body.presetId);
  if (!preset) throw new ShortsError("Pick a preset");
  const info = opts.probe ? await probeSource(body.source.url) : {};
  const duration = info.duration ?? body.source.duration;
  const sourceFps = info.fps ?? body.source.fps;
  const problem = mixedRangeProblem(body.range, duration, sourceFps);
  if (problem) throw new ShortsError(problem);
  const fps = clampFps(body.fps, sourceFps);
  const mode: MixedMode | undefined = body.engine === "cloud" ? (body.mode ?? "frames") : undefined;
  const choices: readonly string[] = mode === "frames" ? MIXED_FRAME_MODELS : MIXED_MODELS[body.engine];
  const modelId = body.modelId && choices.includes(body.modelId) ? body.modelId : choices[0];
  const model = getModel(modelId);
  const len = body.range.end - body.range.start;
  const notes: string[] = [];
  let frames = mixedFrames(len, fps);
  let rate = fps;
  if (mode === "frames") {
    // Frames are every Nth frame of the clip: say so when that isn't the rate picked.
    if (!sourceFps) throw new ShortsError("Couldn't read this clip's frame rate — pick Fast to restyle it as video", 422);
    const s = frameSampling(len, fps, sourceFps);
    frames = s.frames;
    rate = s.fps;
    if (Math.abs(s.fps - fps) > 0.01) notes.push(`Frames are every ${s.interval === 1 ? "" : `${ordinal(s.interval)} `}frame of this ${+sourceFps.toFixed(2)} FPS clip: ${+s.fps.toFixed(2)} FPS, ${frames} frames`);
    if (modelId === "seedream-5-flash") notes.push(`Seedream 5.0 Flash takes no seed, so frames vary a little more than with Nano Banana 2${body.resolution === "4K" ? "; it draws up to 2K" : ""}`);
  } else if (mode === "fast") {
    // A cut the model won't take is paid for, then refused: say so before anything runs.
    const fits = (id: string) => clipLengthProblem({ name: getModel(id)?.name ?? id, minSeconds: sourceSeconds(id).min, maxSeconds: sourceSeconds(id).max }, len);
    const tooShort = fits(modelId);
    if (tooShort) {
      const other = MIXED_MODELS.cloud.find((id) => !fits(id));
      const more = (sourceSeconds(modelId).min ?? 0) > len;
      throw new ShortsError(`${tooShort} — select ${more ? "more" : "less"}${other ? `, or pick ${getModel(other)?.name ?? other}` : ""}`);
    }
  }
  const anchor = mode === "frames" ? body.anchor : mode === "fast" && body.anchor && takesImage(modelId) ? body.anchor : undefined;
  if (mode === "fast") {
    if (body.anchor && !anchor) notes.push(`${model?.name} restyles from words only — the preview frame isn't sent`);
    notes.push(`${model?.name} restyles the clip as smooth video in one pass — Per frame redraws every frame like Higgsfield`);
  } else if (!mode && body.resolution !== "1K") notes.push("The open engine renders up to 1536 px on the long side");
  const name = (body.source.name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  return {
    frames,
    fps: rate,
    notes,
    input: {
      engine: body.engine,
      title: name ? `${preset.name} · ${name}` : `${preset.name} mixed media`,
      preset,
      values: cleanValues(preset, body.values),
      // Sound we couldn't read counts as none (the soundtrack step would fail after the restyle was paid for).
      source: { url: body.source.url, duration, hasAudio: info.hasAudio ?? false },
      range: body.range,
      fps,
      resolution: body.resolution,
      modelId,
      mode,
      sourceFps,
      anchor,
      modelResolution: mode === "fast" ? nearestResolution(model?.options.resolutions, body.resolution) : undefined,
      // LTX follows the clip's outlines, like the open engine's canny ControlNet.
      extra: modelId === "ltx-2-3-restyle" ? { preprocessor: "canny" } : undefined,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    },
  };
}

const withChain = (s: PlanStep) => ({ ...s.request, ...(s.chain ? { chain: s.chain } : {}) });

/** Every step validated and priced; steps alike but for their place in the chain (a frame each) are previewed once. */
function price(steps: PlanStep[]): { costUsd: number | null; demo: boolean } {
  let cost: number | null = 0;
  let demo = false;
  const seen = new Map<string, ReturnType<typeof previewChained>>();
  for (const s of steps) {
    const req = withChain(s);
    const key = JSON.stringify([req.modelId, req.op, req.prompt, req.inputs, req.params, req.chain?.map((c) => c.slot), s.after?.length ?? 0]);
    const p = seen.get(key) ?? previewChained(req, s.after?.length ?? 0);
    seen.set(key, p);
    demo ||= p.demo;
    cost = cost === null || p.costUsd === null ? null : cost + p.costUsd;
  }
  return { costUsd: cost === null ? null : Math.round(cost * 10000) / 10000, demo };
}

export interface MixedEstimate {
  costUsd: number | null;
  previewUsd: number | null;
  demo: boolean;
  frames: number;
  /** The frame rate the frames are taken at (cloud Per frame: the clip's own over a whole number). */
  fps: number;
  /** Cloud: how it restyles. */
  mode?: MixedMode;
  /** Cloud Per frame: the price of redrawing one frame (Higgsfield's 2 credits a frame). */
  perFrameUsd?: number | null;
  notes: string[];
}

export async function estimateMixed(body: MixedBody): Promise<MixedEstimate> {
  const { input, frames, fps, notes } = await planInput(body, { probe: false });
  const plan = planMixed(input);
  const full = price(plan.steps);
  const preview = price([planMixedPreview({ ...input, frameUrl: body.frameUrl ?? "/api/files/placeholder.png" })]);
  const frame = input.mode === "frames" ? plan.steps.find((s) => s.key === "f0") : undefined;
  const perFrameUsd = frame ? previewChained(withChain(frame), frame.after?.length ?? 0).costUsd : undefined;
  return { ...full, previewUsd: preview.costUsd, frames, fps, notes, ...(input.mode && { mode: input.mode }), ...(perFrameUsd !== undefined && { perFrameUsd }) };
}

function run(steps: PlanStep[]): { batchId: string; items: Generation[]; byKey: Record<string, Generation> } {
  try {
    return createPipeline(steps);
  } catch (e) {
    throw new ShortsError((e as Error).message, 422);
  }
}

/** What the page follows of a render: every step but the per-frame edits (their count instead). */
const followed = (p: { items: Generation[] }) => ({ items: p.items.filter((g) => g.feature !== MIXED_FRAME_FEATURE), frames: p.items.filter((g) => g.feature === MIXED_FRAME_FEATURE).length });

/** Start the full render; returns the finished video's generation (the others wait for it). */
export async function createMixed(body: MixedBody): Promise<{ final: Generation; items: Generation[]; frames: number }> {
  const { input } = await planInput(body, { probe: true });
  const plan = planMixed(input);
  const p = run(plan.steps);
  return { final: p.byKey[plan.final], ...followed(p) };
}

/**
 * Run a render again with the same settings (History's "Try again" after a failed step): its steps
 * are made anew from their stored requests, waiting on each other as before.
 */
export function retryMixed(id: string): { final: Generation; items: Generation[]; frames: number } {
  const final = getGeneration(id);
  if (!final || final.feature !== MIXED_FEATURE || !final.batchId) throw new ShortsError("This render no longer exists", 404);
  const mode = engineMode();
  if (mode !== "both" && mode !== final.engine) {
    throw new ShortsError(mode === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
  const rows = db()
    .prepare("SELECT id, depends_on FROM generations WHERE batch_id = ? AND feature IN (?, ?, ?) ORDER BY created_at ASC, id ASC")
    .all(final.batchId, MIXED_FEATURE, MIXED_STEP_FEATURE, MIXED_FRAME_FEATURE) as { id: string; depends_on: string | null }[];
  const deps = (v: string | null): string[] => (!v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v]);
  const steps: PlanStep[] = rows.map((r) => {
    const g = getGeneration(r.id);
    if (!g) throw new ShortsError("Part of this render was deleted — make it again from the editor", 409);
    const after = deps(r.depends_on);
    // Chained inputs were filled in when the step ran: the new run fills them from the new steps.
    const { chain, ...request } = unfilledRequest(g.request, after.length);
    const inputs = { ...request.inputs };
    for (const c of chain ?? []) if (c.slot !== "images" && c.slot !== "videos" && c.slot !== "audios" && c.slot !== "prompt") delete inputs[c.slot];
    return { key: r.id, request: { ...request, inputs: Object.keys(inputs).length ? inputs : undefined }, ...(after.length ? { after, chain } : {}) };
  });
  const p = run(steps);
  return { final: p.byKey[id], ...followed(p) };
}

/** One frame with the current settings. */
export async function createMixedPreview(body: MixedBody): Promise<Generation> {
  const { input } = await planInput(body, { probe: true });
  if (input.engine === "cloud" && !body.frameUrl?.startsWith("/api/files/")) throw new ShortsError("Couldn't grab a frame from this clip in the browser — generate the full video instead");
  const step = planMixedPreview({ ...input, frameUrl: body.frameUrl });
  return run([step]).byKey.preview;
}
