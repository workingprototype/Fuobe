import "server-only";
import { getModel } from "@/lib/catalog";
import {
  clampFps,
  cleanValues,
  getMixedPreset,
  MIXED_MODELS,
  mixedFrames,
  mixedRangeProblem,
  nearestResolution,
  planMixed,
  planMixedPreview,
  type MixedPlanInput,
  type MixedResolution,
} from "@/lib/catalog/mixed-media";
import type { PlanStep } from "@/lib/catalog/shorts";
import { takesImage } from "@/lib/catalog/shorts-models";
import type { Engine, Generation } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
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
  modelId?: string;
  /** Cloud: the approved preview still (anchors the render when the model takes an image). */
  anchor?: string;
  /** Cloud preview: the frame the browser grabbed at the start of the selection. */
  frameUrl?: string;
  seed?: number;
}

async function planInput(body: MixedBody, opts: { probe: boolean }): Promise<{ input: MixedPlanInput; frames: number; notes: string[] }> {
  const mode = engineMode();
  if (mode !== "both" && mode !== body.engine) {
    throw new ShortsError(mode === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
  const preset = getMixedPreset(body.presetId);
  if (!preset) throw new ShortsError("Pick a preset");
  const info = opts.probe ? await probeSource(body.source.url) : {};
  const duration = info.duration ?? body.source.duration;
  const sourceFps = info.fps ?? body.source.fps;
  const problem = mixedRangeProblem(body.range, duration, sourceFps);
  if (problem) throw new ShortsError(problem);
  const fps = clampFps(body.fps, sourceFps);
  const modelId = body.modelId && MIXED_MODELS[body.engine].includes(body.modelId) ? body.modelId : MIXED_MODELS[body.engine][0];
  const model = getModel(modelId);
  const notes: string[] = [];
  const anchor = body.engine === "cloud" && body.anchor && takesImage(modelId) ? body.anchor : undefined;
  if (body.engine === "cloud") {
    if (body.anchor && !anchor) notes.push(`${model?.name} restyles from words only — the preview frame isn't sent`);
    notes.push(`${model?.name} renders smooth motion at its own frame rate; the frame rate sets the frame count shown here and the open engine's sampling`);
  } else if (body.resolution !== "1K") notes.push("The open engine renders up to 1536 px on the long side");
  const name = (body.source.name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  return {
    frames: mixedFrames(body.range.end - body.range.start, fps),
    notes,
    input: {
      engine: body.engine,
      title: name ? `${preset.name} · ${name}` : `${preset.name} mixed media`,
      preset,
      values: cleanValues(preset, body.values),
      source: { url: body.source.url, duration, hasAudio: info.hasAudio ?? true },
      range: body.range,
      fps,
      resolution: body.resolution,
      modelId,
      anchor,
      modelResolution: body.engine === "cloud" ? nearestResolution(model?.options.resolutions, body.resolution) : undefined,
      // LTX follows the clip's outlines, like the open engine's canny ControlNet.
      extra: modelId === "ltx-2-3-restyle" ? { preprocessor: "canny" } : undefined,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    },
  };
}

const withChain = (s: PlanStep) => ({ ...s.request, ...(s.chain ? { chain: s.chain } : {}) });

function price(steps: PlanStep[]): { costUsd: number | null; demo: boolean } {
  let cost: number | null = 0;
  let demo = false;
  for (const s of steps) {
    const p = previewChained(withChain(s), s.after?.length ?? 0);
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
  fps: number;
  notes: string[];
}

export async function estimateMixed(body: MixedBody): Promise<MixedEstimate> {
  const { input, frames, notes } = await planInput(body, { probe: false });
  const full = price(planMixed(input).steps);
  const preview = price([planMixedPreview({ ...input, frameUrl: body.frameUrl ?? "/api/files/placeholder.png" })]);
  return { ...full, previewUsd: preview.costUsd, frames, fps: input.fps, notes };
}

function run(steps: PlanStep[]): { batchId: string; items: Generation[]; byKey: Record<string, Generation> } {
  try {
    return createPipeline(steps);
  } catch (e) {
    throw new ShortsError((e as Error).message, 422);
  }
}

/** Start the full render; returns the finished video's generation (the others wait for it). */
export async function createMixed(body: MixedBody): Promise<{ final: Generation; items: Generation[] }> {
  const { input } = await planInput(body, { probe: true });
  const plan = planMixed(input);
  const p = run(plan.steps);
  return { final: p.byKey[plan.final], items: p.items };
}

/** One frame with the current settings. */
export async function createMixedPreview(body: MixedBody): Promise<Generation> {
  const { input } = await planInput(body, { probe: true });
  if (input.engine === "cloud" && !body.frameUrl?.startsWith("/api/files/")) throw new ShortsError("Couldn't grab a frame from this clip in the browser — generate the full video instead");
  const step = planMixedPreview({ ...input, frameUrl: body.frameUrl });
  return run([step]).byKey.preview;
}
