import "server-only";
import { nanoid } from "nanoid";
import { getModel, supportsOp } from "@/lib/catalog";
import type { Engine, Generation, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { createGenerations } from "./generations";

/**
 * Multi-step jobs built from chained generations: each step waits for the ones it needs and
 * gets their outputs as inputs (see CreateOptions.dependsOn and GenerationRequest.chain).
 */

const tidy = (p: string | undefined) => (p ?? "").trim().replace(/[.\s]+$/, "");

export interface JoinOptions {
  engine: Engine;
  feature: string;
  batchId: string;
  title: string;
  aspectRatio?: string;
  resolution?: string;
  /** Clips that already exist, placed before the chained ones (extend: the original video). */
  before?: string[];
  step?: GenerationRequest["step"];
}

/** Join generations' clips, in order. ComfyUI joins 4 at a time, so longer films are joined in steps. */
export function joinClips(ids: string[], o: JoinOptions): Generation {
  const modelId = o.engine === "open" ? "oss-join-clips" : "join-clips";
  const max = o.engine === "open" ? 4 : 24;
  const join = (group: string[], last: boolean): Generation =>
    createGenerations(
      {
        feature: o.feature,
        modelId,
        op: "concat",
        prompt: o.title,
        inputs: last && o.before?.length ? { videos: o.before } : undefined,
        // ComfyUI's join plays at the first clip's frame rate (linked in the workflow).
        params: { aspectRatio: o.aspectRatio, resolution: o.resolution },
        chain: group.map(() => ({ slot: "videos" as const })),
        step: last ? o.step : { label: "Joining clips", index: 0, of: 1 },
      },
      { batchId: o.batchId, dependsOn: group },
    )[0];
  // Fold the first `max` clips into one until the rest fit in a final join (8 clips → 3 joins).
  let level = ids;
  const room = max - (o.before?.length ?? 0);
  while (level.length > room) level = [join(level.slice(0, max), false).id, ...level.slice(max)];
  return join(level, true);
}

/**
 * Multi-shot on an open model: one clip per shot (the first gets the start image, the last the end
 * frame), then a join. Returns the film first, then the shots.
 */
export function createShotFilm(original: GenerationRequest, model: ModelDef): Generation[] {
  const shots = (original.params?.shots ?? []).filter((s) => s.prompt.trim());
  const max = model.options.multiShot?.maxShots ?? 4;
  if (shots.length > max) throw new Error(`${model.name} takes up to ${max} shots`);
  const longest = Math.max(...(model.options.durations ?? [Infinity]));
  const tooLong = shots.find((s) => s.duration > longest);
  if (tooLong) throw new Error(`${model.name} makes clips up to ${longest}s — shorten “${tooLong.prompt.slice(0, 40)}”`);
  const batchId = nanoid(10);
  const overall = tidy(original.prompt);
  const canT2v = supportsOp(model, "t2v");
  const params = { ...original.params };
  delete params.shots;
  delete params.multiShot;
  const n = shots.length;
  const clips = shots.map((s, i) => {
    const { images, endImage, ...rest } = original.inputs ?? {};
    const inputs = { ...rest, ...((i === 0 || !canT2v) && images?.length && { images }), ...(i === n - 1 && endImage && { endImage }) };
    return createGenerations(
      {
        ...original,
        op: undefined,
        prompt: overall ? `${overall}. ${s.prompt.trim()}` : s.prompt.trim(),
        inputs: Object.keys(inputs).length ? inputs : undefined,
        params: { ...params, duration: s.duration, numOutputs: 1 },
        step: { label: `Shot ${i + 1} of ${n}`, index: i, of: n },
      },
      { batchId },
    )[0];
  });
  const film = joinClips(
    clips.map((c) => c.id),
    {
      engine: model.engine,
      feature: original.feature,
      batchId,
      title: overall || shots.map((s) => tidy(s.prompt)).join(" / "),
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      step: { label: `Film · ${n} shots`, index: n, of: n + 1 },
    },
  );
  return [film, ...clips];
}

/** Extend for models with no extend API (Kling): last frame → image-to-video on the same model → join. */
export function createExtendChain(original: GenerationRequest, model: ModelDef): Generation[] {
  const video = original.inputs?.video;
  if (!video) throw new Error("Add the video to continue");
  if (!supportsOp(model, "i2v")) throw new Error(`${model.name} can't continue a video`);
  const batchId = nanoid(10);
  const frame = createGenerations(
    { feature: original.feature, modelId: "extract-frame", op: "frame", inputs: { video }, step: { label: "Last frame", index: 0, of: 3 } },
    { batchId },
  )[0];
  const rest = { ...original.inputs };
  delete rest.video;
  delete rest.videos;
  const clip = createGenerations(
    {
      ...original,
      op: "i2v",
      prompt: original.prompt?.trim() || "Continue the shot naturally, same subject, same camera move",
      inputs: Object.keys(rest).length ? rest : undefined,
      chain: [{ slot: "images", position: "first" }],
      step: { label: "Continuation", index: 1, of: 3 },
    },
    { batchId, dependsOn: frame.id },
  )[0];
  const film = joinClips([clip.id], {
    engine: model.engine,
    feature: original.feature,
    batchId,
    title: tidy(original.prompt) || "Extended video",
    before: [video],
    step: { label: "Extended video", index: 2, of: 3 },
  });
  return [film, clip, frame];
}

/** The model a storyboard film is animated with. */
export function filmModel(engine: Engine, modelId?: string): ModelDef {
  const m = getModel(modelId ?? (engine === "open" ? "oss-wan22-14b-fast" : "seedance-2-5"));
  if (!m || m.kind !== "video" || !supportsOp(m, "i2v")) throw new Error("Pick an image-to-video model");
  return m;
}
