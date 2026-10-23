import "server-only";
import { nanoid } from "nanoid";
import { getModel, supportsOp } from "@/lib/catalog";
import { frameTimes, planKeyframeClips, spread } from "@/lib/catalog/keyframes";
import { routesFor } from "@/lib/catalog/plan";
import type { ChainSlot, Engine, Generation, GenerationRequest, ModelDef, ModelRoute, Operation } from "@/lib/catalog/types";
import { db } from "./db";
import { cancelGeneration, chooseRoute, createGenerations, getGeneration, previewChained, previewGeneration } from "./generations";
import { provider } from "./providers";
import { loadManifest } from "./providers/comfyui";

/**
 * Multi-step jobs built from chained generations: each step waits for the ones it needs and
 * gets their outputs as inputs (see CreateOptions.dependsOn and GenerationRequest.chain).
 */

const tidy = (p: string | undefined) => (p ?? "").trim().replace(/[.\s]+$/, "");

// ---------------------------------------------------------------------------
// One mode per chain: all real, or all demo

interface ModeStep {
  label: string;
  modelId: string;
  op: Operation;
}

/** Who can run a model's operation, as Settings names them ("fal.ai", "Claude or Ollama"). */
export const providerNames = (m: ModelDef, op: Operation) => [...new Set(routesFor(m, op).map((r) => (r.provider === "llm" ? "Claude or Ollama" : provider(r.provider).label)))].join(" or ");

/**
 * A chain must not mix paid and demo steps: a demo join of paid clips (or a paid step fed a demo
 * placeholder) wastes the money and returns the wrong result. Throws before any row is created.
 */
export function assertOneMode(steps: ModeStep[]): void {
  const modes = steps.map((s) => {
    const m = getModel(s.modelId);
    if (!m) throw new Error(`Unknown model ${s.modelId}`);
    return { ...s, model: m, demo: chooseRoute(routesFor(m, s.op)).demo };
  });
  const demo = modes.find((s) => s.demo);
  if (demo && modes.some((s) => !s.demo)) {
    throw new Error(`${demo.label} needs ${providerNames(demo.model, demo.op)} — connect it in Settings (the other steps would run for real), or turn on demo mode to try it all as a demo`);
  }
}

/** Steps still waiting for their inputs (nothing spent yet) are canceled when the chain they feed can't be made. */
function cancelWaiting(ids: string[]): void {
  for (const id of ids) {
    db()
      .prepare("UPDATE generations SET status = 'canceled', message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND external_id IS NULL AND depends_on IS NOT NULL")
      .run(Date.now(), Date.now(), id);
  }
}

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

const joinModelId = (engine: Engine) => (engine === "open" ? "oss-join-clips" : "join-clips");

/** Join generations' clips, in order. ComfyUI joins 4 at a time, so longer films are joined in steps. */
export function joinClips(ids: string[], o: JoinOptions): Generation {
  const modelId = joinModelId(o.engine);
  const max = o.engine === "open" ? 4 : 24;
  // The clips run for real: the join must too (S9). Clips still waiting are canceled rather than paid for.
  const real = ids.some((id) => {
    const g = getGeneration(id);
    return g && g.provider !== "mock";
  });
  if (real) {
    const m = getModel(modelId)!;
    let demo: boolean;
    try {
      demo = chooseRoute(routesFor(m, "concat")).demo;
    } catch (e) {
      cancelWaiting(ids);
      throw e;
    }
    if (demo) {
      cancelWaiting(ids);
      throw new Error(`Joining clips needs ${providerNames(m, "concat")} — connect it in Settings (the clips would render for real, but they couldn't be joined)`);
    }
  }
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
  const canT2v = supportsOp(model, "t2v");
  const firstOp: Operation = original.inputs?.images?.length || !canT2v ? "i2v" : "t2v";
  assertOneMode([
    { label: `${model.name} shots`, modelId: model.id, op: firstOp },
    { label: "Joining the shots", modelId: joinModelId(model.engine), op: "concat" },
  ]);
  const batchId = nanoid(10);
  const overall = tidy(original.prompt);
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

/**
 * Frames mode on an open model (Kling 4.0's keyframes, gap G02): one start/end-frame clip per pair of
 * neighbouring frames, each as long as the gap between them in the workflow's own frame steps, then
 * the stretch after the last frame (from it alone) when it isn't at the end, then a join. Two frames
 * at the start and the end make one clip and no join. Returns the film first, then the clips.
 */
export function createKeyframeFilm(original: GenerationRequest, model: ModelDef, route: ModelRoute): Generation[] {
  // The whole request is checked first (prompt, frame count, gaps), so no clip starts for a film that can't be made.
  previewGeneration({ ...original, op: "keyframes" });
  const images = original.inputs?.images ?? [];
  const duration = original.params?.duration ?? model.defaults?.duration ?? 5;
  const times = original.params?.keyframeTimes?.length ? original.params.keyframeTimes : frameTimes(spread(images.length), duration);
  const wf = loadManifest().workflows.find((w) => w.id === route.endpoint);
  const clips = planKeyframeClips(times, duration, {
    name: model.name,
    maxSeconds: Math.max(...(model.options.durations ?? [5])),
    fps: Number(wf?.defaults.fps ?? 16),
    step: Number(wf?.defaults.frameStep ?? 4),
    maxFrames: wf?.limits?.maxFrames,
  });
  const tail = clips.some((c) => c.to === null);
  assertOneMode([
    { label: `${model.name} clips`, modelId: model.id, op: "flf2v" },
    ...(tail ? [{ label: `${model.name} after the last frame`, modelId: model.id, op: "i2v" as const }] : []),
    ...(clips.length > 1 ? [{ label: "Joining the clips", modelId: joinModelId(model.engine), op: "concat" as const }] : []),
  ]);
  const batchId = nanoid(10);
  const params = { ...original.params };
  delete params.keyframeTimes;
  delete params.shots;
  delete params.multiShot;
  const rest = { ...original.inputs };
  delete rest.images;
  delete rest.endImage;
  const n = clips.length;
  const made: Generation[] = [];
  try {
    for (const [i, c] of clips.entries()) {
      const label = c.to === null ? `After frame ${c.from + 1}` : `Frames ${c.from + 1} → ${c.to + 1}`;
      const request: GenerationRequest = {
        ...original,
        op: c.to === null ? "i2v" : "flf2v",
        inputs: { ...rest, images: [images[c.from]], ...(c.to !== null && { endImage: images[c.to] }) },
        params: { ...params, duration: c.seconds, numOutputs: 1 },
        ...(n > 1 ? { step: { label, index: i, of: n + 1 } } : {}),
      };
      made.push(createGenerations(request, { batchId })[0]);
    }
    if (n === 1) return made;
    const film = joinClips(
      made.map((c) => c.id),
      {
        engine: model.engine,
        feature: original.feature,
        batchId,
        title: tidy(original.prompt) || "Keyframe film",
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        step: { label: `Film · ${images.length} frames`, index: n, of: n + 1 },
      },
    );
    return [film, ...made];
  } catch (e) {
    // Don't leave half a film rendering.
    for (const g of made) void cancelGeneration(g.id);
    throw e;
  }
}

/** Extend for models with no extend API (Kling): last frame → image-to-video on the same model → join. */
export function createExtendChain(original: GenerationRequest, model: ModelDef): Generation[] {
  const video = original.inputs?.video;
  if (!video) throw new Error("Add the video to continue");
  if (!supportsOp(model, "i2v")) throw new Error(`${model.name} can't continue a video`);
  // The last frame comes from fal's FFmpeg tool, or ComfyUI's frame-extract on the open engine.
  const frameModel = model.engine === "open" ? "oss-extract-frame" : "extract-frame";
  assertOneMode([
    { label: "Taking the last frame", modelId: frameModel, op: "frame" },
    { label: model.name, modelId: model.id, op: "i2v" },
    { label: "Joining the clips", modelId: joinModelId(model.engine), op: "concat" },
  ]);
  const batchId = nanoid(10);
  const frame = createGenerations(
    { feature: original.feature, modelId: frameModel, op: "frame", inputs: { video }, step: { label: "Last frame", index: 0, of: 3 } },
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

// ---------------------------------------------------------------------------
// Pipelines: any DAG of steps

export interface PipelineStep {
  /** Unique name of the step within the pipeline (used by `after` and in `byKey`). */
  key: string;
  request: GenerationRequest;
  /** Steps whose output this one takes (the first of the slot's kind, or the slot's stem), in the order of its chain slots. */
  after?: string | string[];
  /** Where each `after` step's output goes (defaults to `request.chain`, else the images). */
  chain?: ChainSlot[];
}

export interface PipelineOptions {
  /** Group the steps (defaults to a new batch id). */
  batchId?: string;
}

export interface Pipeline {
  batchId: string;
  /** Every generation created, in creation (topological) order. */
  items: Generation[];
  /** The generation each step made (for a step that expands into several rows, its final result). */
  byKey: Record<string, Generation>;
}

const asList = (a: string | string[] | undefined) => (a === undefined ? [] : Array.isArray(a) ? a : [a]);

/** Chain slots that take an audio output (and so may pick a stem). */
const AUDIO_SLOTS = new Set<ChainSlot["slot"]>(["audio", "voiceAudio", "audio2"]);

/** Kahn's algorithm: steps in an order where every `after` comes first; throws on a cycle. */
function topoOrder(steps: PipelineStep[]): PipelineStep[] {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const indegree = new Map(steps.map((s) => [s.key, new Set(asList(s.after)).size]));
  const ready = steps.filter((s) => indegree.get(s.key) === 0);
  const out: PipelineStep[] = [];
  while (ready.length) {
    const s = ready.shift()!;
    out.push(s);
    for (const t of steps) {
      if (!new Set(asList(t.after)).has(s.key)) continue;
      const n = indegree.get(t.key)! - 1;
      indegree.set(t.key, n);
      if (n === 0) ready.push(byKey.get(t.key)!);
    }
  }
  if (out.length < steps.length) {
    const stuck = steps.filter((s) => !out.includes(s)).map((s) => `“${s.key}”`);
    throw new Error(`These steps wait for each other in a loop: ${stuck.join(", ")}`);
  }
  return out;
}

/**
 * Create a multi-step job from any graph of steps. Every step is validated (models, inputs,
 * engine mode, prices) and the graph is checked — unknown or duplicate keys, loops, a mix of
 * demo and real steps — before a single row is created; then the rows are created in
 * dependency order and the runner launches each step when the steps it waits for succeed.
 *
 * A chain slot takes the first output of its kind from the step it names, or with `stem` the
 * audio output whose `meta.stem` matches — that's how one separate-audio step feeds both the voice
 * to clone and the background to mix back in.
 *
 * @example Dub a clip into Spanish in the speaker's own voice, over the original music and effects
 * ```ts
 * const video = "/api/files/uploads/2026-10-17/clip.mp4";
 * const { batchId, byKey } = createPipeline([
 *   // Two stems: meta.stem "voice" and "background".
 *   { key: "stems", request: { feature: "dub", modelId: "oss-voice-separate", op: "separate-audio", inputs: { video } } },
 *   { key: "words", request: { feature: "dub", modelId: "oss-qwen3-asr", op: "transcribe" }, after: "stems", chain: [{ slot: "audio", stem: "voice" }] },
 *   // A transcript's cues go in as a cue list, so the translation keeps the timing.
 *   { key: "spanish", request: { feature: "dub", modelId: "oss-text-llm", op: "translate", params: { targetLanguage: "Spanish" } }, after: "words", chain: [{ slot: "prompt" }] },
 *   // Speak the translation, cloning the voice stem.
 *   { key: "voice", request: { feature: "dub", modelId: "oss-chatterbox", op: "tts" }, after: ["spanish", "stems"], chain: [{ slot: "prompt" }, { slot: "voiceAudio", stem: "voice" }] },
 *   { key: "lips", request: { feature: "dub", modelId: "oss-infinitetalk-v2v", op: "lipsync", inputs: { video } }, after: "voice", chain: [{ slot: "audio" }] },
 *   // The new voice over the background stem (inputs.audio2).
 *   { key: "film", request: { feature: "dub", modelId: "oss-mux", op: "mux" }, after: ["lips", "voice", "stems"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2", stem: "background" }] },
 * ]);
 * // byKey.film is the finished video; every step shares batchId and shows "Step n of 6".
 * // Paid route: demucs ("vocals" counts as "voice"), scribe-v2, text-llm, chatterbox-cloud, sync-lipsync-3;
 * // merge-audio-video takes one track, so the voice and the other stems are mixed first by compose-timeline
 * // (overlapping clips go on tracks of their own) and that mix is the soundtrack (src/lib/av/dub.ts).
 * ```
 */
export function createPipeline(steps: PipelineStep[], opts: PipelineOptions = {}): Pipeline {
  if (!steps.length) throw new Error("A pipeline needs at least one step");
  const keys = new Set<string>();
  for (const s of steps) {
    if (!s.key?.trim()) throw new Error("Every step needs a key");
    if (keys.has(s.key)) throw new Error(`Two steps are called “${s.key}”`);
    keys.add(s.key);
  }
  for (const s of steps) {
    const after = asList(s.after);
    for (const a of after) {
      if (a === s.key) throw new Error(`Step “${s.key}” can't wait for itself`);
      if (!keys.has(a)) throw new Error(`Step “${s.key}” waits for “${a}”, which isn't in the pipeline`);
    }
    if (new Set(after).size !== after.length) throw new Error(`Step “${s.key}” lists the same step twice`);
    const chain = s.chain ?? s.request.chain;
    if (chain && chain.length !== after.length) throw new Error(`Step “${s.key}” has ${chain.length} chain slot${chain.length === 1 ? "" : "s"} for ${after.length} earlier step${after.length === 1 ? "" : "s"}`);
    const stray = chain?.find((c) => c.stem && !AUDIO_SLOTS.has(c.slot));
    if (stray) throw new Error(`Step “${s.key}”: a stem (“${stray.stem}”) only goes into an audio slot, not “${stray.slot}”`);
  }
  const ordered = topoOrder(steps);
  const n = steps.length;
  const indexOf = new Map(ordered.map((s, i) => [s.key, i]));
  const requests = new Map(
    ordered.map((s) => {
      const chain = s.chain ?? s.request.chain;
      const req: GenerationRequest = {
        ...s.request,
        ...(chain && { chain }),
        step: s.request.step ?? { label: `Step ${indexOf.get(s.key)! + 1} of ${n}`, index: indexOf.get(s.key)!, of: n },
      };
      return [s.key, req];
    }),
  );
  // Validate every step now, with placeholders for what earlier steps will make.
  const needed = new Set(steps.flatMap((s) => asList(s.after)));
  const previews = ordered.map((s) => {
    let p: ReturnType<typeof previewChained>;
    try {
      p = previewChained(requests.get(s.key)!, asList(s.after).length);
    } catch (e) {
      throw new Error(`Step “${s.key}”: ${(e as Error).message}`);
    }
    if (needed.has(s.key) && p.jobs > 1) throw new Error(`Step “${s.key}” makes ${p.jobs} jobs; later steps need one result — ask it for fewer outputs`);
    return { key: s.key, ...p };
  });
  const demo = previews.find((p) => p.demo);
  if (demo && previews.some((p) => !p.demo)) {
    throw new Error(`Step “${demo.key}” would run as a demo (${demo.model.name} needs ${providerNames(demo.model, demo.op)}) while the others run for real — connect it in Settings, or turn on demo mode to try it all as a demo`);
  }

  const batchId = opts.batchId ?? nanoid(10);
  const items: Generation[] = [];
  const byKey: Record<string, Generation> = {};
  try {
    for (const s of ordered) {
      const after = asList(s.after);
      const made = createGenerations(requests.get(s.key)!, { batchId, ...(after.length && { dependsOn: after.map((a) => byKey[a].id) }) });
      byKey[s.key] = made[0];
      items.push(...made);
    }
  } catch (e) {
    // Don't leave half a pipeline running.
    for (const g of items) void cancelGeneration(g.id);
    throw e;
  }
  return { batchId, items, byKey };
}
