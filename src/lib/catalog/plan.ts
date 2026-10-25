import { FORMAT_INFO, formatList } from "@/lib/av/formats";
import type {
  Engine,
  GenerationRequest,
  GenParams,
  LoraRef,
  ModelDef,
  ModelRoute,
  Operation,
  Preset,
  PresetRoute,
  Pricing,
} from "./types";
import { chainGapProblem, chainTiming, FIRST_AT_ZERO, frameTimes, keyframeChain, MAX_KEYFRAMES, spread } from "./keyframes";
import { cloudPath, fitLoras, gated, localOnly, loraCapacity, needsToken, routeLoraField } from "./loras";

/** Infer the operation from what the user attached. */
export function inferOperation(model: ModelDef, req: Pick<GenerationRequest, "op" | "inputs" | "params">): Operation {
  if (req.op) return req.op;
  const ops = new Set(model.routes.map((r) => r.op));
  const imgs = req.inputs?.images?.length ?? 0;
  // Reference clips (Cinema Studio, Seedance) only fit reference-to-video.
  const clipRefs = (req.inputs?.videos?.length ?? 0) + (req.inputs?.audios?.length ?? 0);
  const has = (op: Operation) => ops.has(op);
  if (model.kind === "video") {
    if (req.inputs?.video && req.inputs?.audio && has("lipsync")) return "lipsync";
    if (req.inputs?.audio && imgs && has("avatar")) return "avatar";
    if (req.inputs?.video && imgs && has("motion-transfer")) return "motion-transfer";
    if (req.inputs?.video && has("v2v")) return "v2v";
    if (req.inputs?.video && has("extend")) return "extend";
    // Video erasers and swappers (a general video editor above takes these as plain edits unless asked).
    if (req.inputs?.video && imgs && has("video-swap")) return "video-swap";
    if (req.inputs?.video && has("remove-object")) return "remove-object";
    if (imgs && req.inputs?.endImage && has("flf2v")) return "flf2v";
    // Several stills are keyframes when they have times, or when the model takes no references. The open
    // chain (a film of several clips) only with times: stills left over from references stay a start frame.
    if (imgs > 1 && has("keyframes") && (req.params?.keyframeTimes?.length || (!has("ref2v") && !keyframeChain(model)))) return "keyframes";
    if ((imgs > 1 || clipRefs > 0) && has("ref2v")) return "ref2v";
    if (imgs && has("i2v")) return "i2v";
    if (has("t2v")) return "t2v";
  }
  if (model.kind === "image") {
    if (imgs && req.inputs?.mask && has("inpaint")) return "inpaint";
    if (imgs && has("edit")) return "edit";
    if (has("t2i")) return "t2i";
  }
  if (model.kind === "audio") {
    if ((req.inputs?.audios?.length ?? 0) > 1 && has("audio-join")) return "audio-join";
    if (req.inputs?.audio && has("audio-loop")) return "audio-loop";
  }
  if (model.kind === "model3d") {
    if (req.inputs?.model3d && has("rig-3d")) return "rig-3d";
    if (imgs && has("image-to-3d")) return "image-to-3d";
    if (!imgs && has("text-to-3d")) return "text-to-3d";
  }
  return model.routes[0].op;
}

export function routesFor(model: ModelDef, op: Operation): ModelRoute[] {
  return model.routes.filter((r) => r.op === op);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fill a preset prompt template: {prompt} and {option:key}. Collapses leftover whitespace. */
export function composePrompt(
  template: string,
  userPrompt: string | undefined,
  preset: Pick<Preset, "options"> | null,
  selected: Record<string, string> | undefined,
): string {
  let out = template.replace(/\{prompt\}/g, (userPrompt ?? "").trim());
  out = out.replace(/\{option:([a-zA-Z0-9_-]+)\}/g, (_, key: string) => {
    const opt = preset?.options?.find((o) => o.key === key);
    const value = selected?.[key] ?? opt?.default ?? opt?.choices[0]?.value;
    return opt?.choices.find((c) => c.value === value)?.prompt ?? "";
  });
  return out
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:]+|[\s,;:]+$/g, "")
    .trim();
}

/** "Shot 1 [0–3s]: … Shot 2 [3–8s]: …" — the format Seedance, Wan and LTX follow for multi-shot prompts. */
export function composeShots(overall: string, shots: { prompt: string; duration: number }[]): string {
  let t = 0;
  const parts = shots.map((s, i) => {
    const from = t;
    t += s.duration;
    return `Shot ${i + 1} [${from}-${t}s]: ${s.prompt.trim().replace(/[.\s]+$/, "")}.`;
  });
  return [overall.trim() && `${overall.trim().replace(/[.\s]+$/, "")}.`, ...parts].filter(Boolean).join(" ");
}

export function presetRoute(preset: Preset, engine: Engine): PresetRoute | null {
  return engine === "open" ? preset.open : preset.cloud;
}

export interface Plan {
  model: ModelDef;
  op: Operation;
  prompt: string;
  params: GenParams;
  loras: LoraRef[];
  /** Number of separate provider jobs (models that can't batch need several). */
  jobs: number;
  perJobOutputs: number;
}

/** Operations that work from their inputs alone. */
const PROMPTLESS = new Set<Operation>([
  "concat", "frame", "color-match", "finalize", "reframe", "dialogue", "voice-change", "dub", "bg-remove-video", "depth-video", "upscale-image", "upscale-video", "bg-remove",
  "interpolate", "v2a", "face-swap", "motion-transfer", "lipsync", "avatar",
  // round 3: tools that work from their inputs (open caption burn-in takes timed lines as its prompt and says so when they're missing)
  "trim", "transcribe", "mux", "separate-audio", "layers", "image-to-3d", "captions", "text-layers", "vectorize", "level",
  // av-tools: the dub voice track (clips placed on the video's timeline)
  "timeline",
  // round 4: tools that work from their inputs (removing an object needs a prompt only on models that read one)
  "sdr-to-hdr", "export-video", "ocr", "still-motion", "audio-loop", "audio-join", "scene-3d", "splat", "rig-3d", "extract-frames", "images-to-video", "overlay",
]);

/**
 * The prompt can be left empty: the operation works from its inputs, the model takes no prompt at all
 * (try-on, transcription, 3D), or (when the routes' field maps are known, on the server) none of the
 * routes for this operation sends one.
 */
export function promptOptional(model: ModelDef, op: Operation): boolean {
  if (PROMPTLESS.has(op) || model.options.promptless || model.options.promptOptional) return true;
  const routes = routesFor(model, op);
  return routes.length > 0 && routes.every((r) => r.map?.prompt === false);
}

/**
 * Removing an object: what to erase is named (the prompt), painted (inputs.mask) or clicked (params.points).
 * A mask or points stand in for the words when a route reads them (unknown on the client, whose catalog
 * has no field maps, and on ComfyUI routes, whose workflows bind them).
 */
function markedTarget(model: ModelDef, op: Operation, req: GenerationRequest, params: GenParams): boolean {
  if (op !== "remove-object") return false;
  const routes = routesFor(model, op);
  const reads = (k: "mask" | "points") => routes.some((r) => !r.map || !!r.map[k]);
  return (!!req.inputs?.mask && reads("mask")) || (!!params.points?.length && reads("points"));
}

export function planGeneration(
  req: GenerationRequest,
  getModel: (id: string) => ModelDef | undefined,
  getPreset: (id: string) => Preset | undefined,
): Plan {
  const preset = req.presetId ? getPreset(req.presetId) : undefined;
  if (req.presetId && !preset) throw new Error(`Unknown preset ${req.presetId}`);
  const model = getModel(req.modelId);
  if (!model) throw new Error(`Unknown model ${req.modelId}`);

  let prompt = req.prompt?.trim() ?? "";
  let params: GenParams = { ...model.defaults, ...req.params };
  let loras: LoraRef[] = [];
  let op: Operation | undefined = req.op;

  if (preset) {
    const route = presetRoute(preset, model.engine);
    if (!route) throw new Error(`${preset.name} has no ${model.engine === "open" ? "open-source" : "cloud"} version yet`);
    if (route.modelId !== model.id && !preset.type.match(/motion|effect/)) {
      // Apps pin their model; motions/effects let the user pick any compatible video model.
      throw new Error(`${preset.name} runs on ${route.modelId}, not ${model.id}`);
    }
    prompt = composePrompt(route.promptTemplate ?? preset.promptTemplate, req.prompt, preset, req.presetOptions);
    // Preset params/LoRAs are tuned for the preset's own model; other compatible models only get the prompt.
    const sameModel = route.modelId === model.id;
    params = { ...model.defaults, ...(sameModel ? route.params : {}), ...req.params };
    // Option choices that set model settings (Angles: rotate / tilt / zoom); a value the user set wins.
    const chosen = Object.assign({}, ...(preset.options ?? []).map((o) => o.choices.find((c) => c.value === (req.presetOptions?.[o.key] ?? o.default ?? o.choices[0]?.value))?.extra ?? {}));
    if (sameModel && Object.keys(chosen).length) params = { ...params, extra: { ...chosen, ...params.extra } };
    loras = sameModel ? (route.loras ?? []) : [];
    if (sameModel) op = op ?? route.op;
  }

  if (preset && /motion|effect/.test(preset.type)) {
    const k = clamp01(req.presetStrength ?? 1);
    if (k < 1) loras = loras.map((l) => ({ ...l, strength: round2((l.strength ?? 1) * k) }));
    if (req.mix) {
      const second = getPreset(req.mix.presetId);
      if (!second || !/motion|effect/.test(second.type)) throw new Error("Pick a camera motion or effect to mix in");
      if (second.id !== preset.id) {
        const m = clamp01(req.mix.strength);
        // The second preset's own words, without the user's prompt; worded by strength.
        const words = composePrompt(second.promptTemplate.replace(/\{prompt\}\.?/g, ""), "", second, undefined).replace(/[.\s]+$/, "");
        const lead = m >= 0.75 ? "At the same time" : m >= 0.4 ? "Also, more subtly" : "With a slight hint of this";
        prompt = `${prompt.replace(/[.\s]+$/, "")}. ${lead}: ${words.charAt(0).toLowerCase()}${words.slice(1)}.`;
        // Its LoRAs stack on the same open model, scaled by the mix strength.
        const route = presetRoute(second, model.engine);
        if (route?.modelId === model.id && route.loras?.length) loras = [...loras, ...route.loras.map((l) => ({ ...l, strength: round2((l.strength ?? 1) * m) }))];
      }
    }
  }

  // The user's own LoRAs (an @character's trained identity) go first: on an API that takes so many, the first
  // ones win, so a look's or motion's LoRAs give way to them (fitLoras).
  if (req.loras?.length) loras = [...req.loras, ...loras];
  // A LoRA at strength 0 changes nothing: leave it out, so preset strength 0 is the preset's prompt alone (and its file isn't needed).
  const kept = loras.filter((l) => (l.strength ?? 1) !== 0);
  // Its trigger word goes with it: an open motion's template starts with its LoRA's trigger ("e13c7r1c electricity
  // effect. …", see withOssLoras), which means nothing to the model without the LoRA.
  const keptTriggers = new Set(kept.map((l) => l.trigger).filter(Boolean));
  for (const l of loras) {
    if ((l.strength ?? 1) !== 0 || !l.trigger || keptTriggers.has(l.trigger)) continue;
    const lead = [". ", ", ", " "].map((sep) => l.trigger + sep).find((t) => prompt.startsWith(t));
    if (lead) prompt = prompt.slice(lead.length);
  }
  loras = kept;

  // Multi-shot: the clip is as long as its shots, and models without per-shot prompts get them written out.
  const shots = params.shots?.filter((s) => s.prompt.trim());
  if (shots?.length) {
    if (!model.options.multiShot) throw new Error(`${model.name} can't do multi-shot — try Kling 3.0, Seedance 2.5 or Wan 2.6`);
    if (shots.length > model.options.multiShot.maxShots) throw new Error(`${model.name} takes up to ${model.options.multiShot.maxShots} shots`);
    const total = shots.reduce((n, s) => n + s.duration, 0);
    const max = Math.max(...(model.options.durations ?? [total]));
    // Joined films (open models) render each shot as its own clip: only each shot has to fit.
    const concat = model.options.multiShot.mode === "concat";
    if (concat && shots.some((s) => s.duration > max)) throw new Error(`${model.name} makes clips up to ${max}s per shot`);
    if (!concat && total > max) throw new Error(`The shots add up to ${total}s — ${model.name} makes up to ${max}s`);
    // Per-shot prompts carry the overall description (and @element legend) with them.
    const overall = prompt.trim().replace(/[.\s]+$/, "");
    const native = model.options.multiShot.mode === "native";
    params = { ...params, shots: native && overall ? shots.map((s) => ({ ...s, prompt: `${overall}. ${s.prompt.trim()}` })) : shots, duration: total };
    prompt = composeShots(prompt, shots);
  } else if (params.multiShot === "auto" && model.options.multiShot?.mode === "prompt") {
    prompt = `${prompt.replace(/[.\s]+$/, "")}. Multi-shot sequence: tell it in several distinct shots with clean cuts between them.`;
  }
  op = op ?? inferOperation(model, req);
  if (!routesFor(model, op).length) {
    throw new Error(`${model.name} can't do ${op} — try another model`);
  }
  if (op === "finalize" && !params.draftId) throw new Error("Pick a draft to finish");
  if (op === "dialogue" && !params.dialogue?.some((l) => l.text.trim())) throw new Error("Write at least one line");
  if (op === "dub" && !params.targetLanguage) throw new Error("Pick a language to translate into");
  if (model.options.motionPaths && !(params.extra?.motionPaths as { paths?: unknown[] } | undefined)?.paths?.length) {
    throw new Error(`Draw on the start frame — ${model.name} moves things along the paths you draw`);
  }
  if (op === "dialogue" && model.options.voiceClone && (!req.inputs?.voiceAudio || !req.inputs?.voiceAudio2)) throw new Error("Add a voice sample for each speaker");
  if ((op === "tts" || op === "voice-change") && model.options.voiceClone && !model.options.voices?.length && !req.inputs?.voiceAudio) {
    throw new Error(op === "tts" ? "Pick or record the voice to speak with" : "Pick or record the voice to change into");
  }
  if (op === "dub" && !req.inputs?.video && !req.inputs?.audio) throw new Error("Add the video to translate");
  if (op === "keyframes") checkKeyframes(model, req.inputs?.images?.length ?? 0, params);
  // A format the model doesn't write (an API caller, or a request moved to another model).
  const formats = model.options.formats;
  if (params.format && formats?.length && !formats.includes(params.format)) {
    throw new Error(`${model.name} writes ${formatList(formats)}, not ${FORMAT_INFO[params.format]?.short ?? params.format}`);
  }
  // A join takes as many clips as the API's list does (fal merge-audios: 5); longer joins run in steps.
  const maxAudios = model.options.maxAudios;
  if (op === "audio-join" && maxAudios && (req.inputs?.audios?.length ?? 0) > maxAudios) throw new Error(`${model.name} joins up to ${maxAudios} clips at a time — join the rest in a second step`);
  const requires = model.options.requires;
  if (requires?.images && (req.inputs?.images?.length ?? 0) < requires.images) throw new Error(requires.msg);
  if (requires?.prompt && !prompt) throw new Error(requires.msg);
  if (requires?.mask && !req.inputs?.mask) throw new Error(requires.msg);
  if (requires?.points && !params.points?.length) throw new Error(requires.msg);
  if (op === "bg-remove-video" || op === "depth-video") checkVideoToolOptions(model, op, prompt, params);
  // Remove background on a model that makes both files: the picker's default (the cut-out) unless asked, so the job
  // makes the one file the picker showed, not both.
  const matteOutputs = model.options.matteOutputs;
  if (op === "bg-remove-video" && !params.matteOutput && matteOutputs && matteOutputs.length > 1) params = { ...params, matteOutput: matteOutputs[0] };
  if (!prompt && !promptOptional(model, op) && !markedTarget(model, op, req, params)) {
    throw new Error(op === "remove-object" ? "Say what to remove, e.g. “the coffee cup in her hand”" : "Write a prompt first");
  }

  const missing = missingInputs(op, req) ?? unreadInputs(model, op, req) ?? missingImages(model, req);
  if (missing) throw new Error(missing);
  const presets = model.options.presets;
  if (presets?.required && !params.extra?.[presets.param]) throw new Error(`Pick a ${presets.label.toLowerCase()} first`);

  const requested = Math.max(1, Math.min(8, params.numOutputs ?? 1));
  const maxPerJob = Math.max(1, model.options.maxOutputs ?? 1);
  const perJobOutputs = Math.min(requested, maxPerJob);
  const jobs = Math.ceil(requested / perJobOutputs);
  return { model, op, prompt, params: { ...params, numOutputs: perJobOutputs }, loras, jobs, perJobOutputs };
}

/**
 * Remove background and Depth map options (Higgsfield's Video tools): what to keep, the cut-out or its alpha mask,
 * the colour map and side by side, each checked against what the model makes, so nothing is quietly swapped.
 */
function checkVideoToolOptions(model: ModelDef, op: "bg-remove-video" | "depth-video", prompt: string, params: GenParams) {
  const o = model.options;
  if (op === "bg-remove-video") {
    // A segmenter keeps what is named (or clicked, where its route reads points): with neither it keeps nothing.
    const clicked = !!params.points?.length && routesFor(model, op).some((r) => !!r.map?.points);
    if (o.keepsNamed && !prompt && !clicked) throw new Error("Say what to keep, e.g. “the dog” or “the woman in red”");
    const outputs = o.matteOutputs ?? ["cutout"];
    if (params.matteOutput && !outputs.includes(params.matteOutput)) {
      throw new Error(params.matteOutput === "matte" ? `${model.name} makes the cut-out only — pick BiRefNet or SAM for an alpha mask` : `${model.name} makes the alpha mask only — pick BiRefNet for a cut-out video`);
    }
    return;
  }
  const maps = o.colormaps ?? ["grayscale"];
  if (params.colormap && !maps.includes(params.colormap.toLowerCase())) {
    throw new Error(
      model.engine === "open"
        ? `${model.name} draws ${maps.length > 1 ? `${maps.slice(0, -1).join(", ")} or ${maps.at(-1)}` : "grayscale only"} — the open engine has no ${params.colormap}; it's on the cloud`
        : `${model.name} has no ${params.colormap} colour map`,
    );
  }
  if (params.sideBySide && !o.sideBySide) throw new Error(`${model.name} can't put the original next to the depth map`);
}

/**
 * Keyframes: one time per image, from 0 up, inside the clip, no more than the model takes. The open
 * chain (one start/end-frame clip per pair) also needs every gap to be a clip its model can make.
 */
function checkKeyframes(model: ModelDef, n: number, params: GenParams) {
  const chain = keyframeChain(model);
  const max = chain ? MAX_KEYFRAMES : model.options.maxImages;
  if (max && n > max) throw new Error(`${model.name} takes up to ${max} keyframes`);
  const times = params.keyframeTimes;
  const duration = params.duration ?? model.defaults?.duration;
  if (times?.length) {
    if (times.length !== n) throw new Error(`Give each of the ${n} keyframes a time`);
    if (times.some((t, i) => !Number.isFinite(t) || t < 0 || (i > 0 && t <= times[i - 1]))) throw new Error("Keyframe times start at 0 or later and go up");
    // The open chain's film starts on the first frame (FLUX 3 Max can start it later).
    if (chain && times[0] !== 0) throw new Error(FIRST_AT_ZERO);
    const last = times[times.length - 1];
    if (duration !== undefined && last > duration) throw new Error(`The last keyframe is at ${last}s — make the clip at least that long`);
  }
  if (chain && n > 1) {
    const length = duration ?? 5;
    const problem = chainGapProblem(times?.length ? times : frameTimes(spread(n), length), length, chainTiming(model));
    if (problem) throw new Error(problem);
  }
}

type InputKey = keyof NonNullable<GenerationRequest["inputs"]>;

const NEEDS: Partial<
  Record<
    Operation,
    { images?: number; video?: boolean; videos?: number; audio?: boolean; audios?: number; endImage?: boolean; mask?: boolean; model3d?: boolean; oneOf?: InputKey[]; msg: string }
  >
> = {
  edit: { images: 1, msg: "Add an image to edit" },
  inpaint: { images: 1, mask: true, msg: "Add an image and paint the area to change" },
  outpaint: { images: 1, msg: "Add an image to extend" },
  i2v: { images: 1, msg: "Add a start frame" },
  flf2v: { images: 1, endImage: true, msg: "Add a start and an end frame" },
  ref2v: { oneOf: ["images", "videos", "audios"], msg: "Add reference images" },
  v2v: { video: true, msg: "Add a video" },
  avatar: { images: 1, audio: true, msg: "Add a portrait and a voice track" },
  lipsync: { video: true, audio: true, msg: "Add a video and a voice track" },
  "motion-transfer": { images: 1, video: true, msg: "Add a character image and a driving video" },
  "upscale-image": { images: 1, msg: "Add an image to upscale" },
  "upscale-video": { video: true, msg: "Add a video to upscale" },
  "bg-remove": { images: 1, msg: "Add an image" },
  "face-swap": { images: 2, msg: "Add a target photo and a face" },
  v2a: { video: true, msg: "Add a video" },
  interpolate: { video: true, msg: "Add a video" },
  extend: { video: true, msg: "Add the video to continue" },
  reframe: { video: true, msg: "Add a video to reframe" },
  "voice-change": { audio: true, msg: "Add the recording to re-voice" },
  "bg-remove-video": { video: true, msg: "Add a video" },
  "depth-video": { video: true, msg: "Add a video" },
  "relight-video": { video: true, msg: "Add a video to relight" },
  concat: { videos: 2, msg: "Add at least two clips to join" },
  frame: { video: true, msg: "Add a video" },
  "color-match": { images: 1, msg: "Add the image or video and a reference image" },
  // round 3 (open engine)
  trim: { video: true, msg: "Add the video to trim" },
  mux: { video: true, audio: true, msg: "Add a video and the soundtrack to put on it" },
  captions: { video: true, msg: "Add the video to caption" },
  layers: { images: 1, msg: "Add the image to split into layers" },
  "image-to-3d": { images: 1, msg: "Add a product or object photo" },
  // round 3 (cloud catalog)
  "text-layers": { images: 1, msg: "Add the image to lift the text from" },
  vectorize: { images: 1, msg: "Add the image to turn into an SVG" },
  transcribe: { oneOf: ["audio", "video"], msg: "Add the audio or video to transcribe" },
  "separate-audio": { oneOf: ["audio", "video"], msg: "Add the audio or video to split" },
  level: { audio: true, msg: "Add the audio to level" },
  // round 4
  "remove-object": { video: true, msg: "Add the video to remove something from" },
  "video-swap": { video: true, images: 1, msg: "Add the video and a picture of what goes in" },
  "video-insert": { video: true, images: 1, msg: "Add the video and a picture of what to add" },
  keyframes: { images: 1, msg: "Add the keyframes, in order" },
  "sdr-to-hdr": { video: true, msg: "Add the video to convert" },
  "export-video": { video: true, msg: "Add the video to export" },
  ocr: { images: 1, msg: "Add the image to read" },
  "still-motion": { images: 1, msg: "Add the still to move over" },
  "audio-loop": { audio: true, msg: "Add the audio to loop" },
  "audio-join": { audios: 2, msg: "Add at least two audio clips to join" },
  "scene-3d": { images: 1, msg: "Add the image to build the scene from" },
  splat: { images: 1, msg: "Add a photo of the subject" },
  "rig-3d": { model3d: true, msg: "Add the 3D model to rig" },
  "extract-frames": { video: true, msg: "Add the video to take frames from" },
  "images-to-video": { images: 1, msg: "Add the images, in order" },
  overlay: { images: 2, msg: "Add the picture and the overlay to put on it" },
};

const given = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);

/** Human message for the first missing input of an operation, or null. */
export function missingInputs(op: Operation, req: Pick<GenerationRequest, "inputs">): string | null {
  const n = NEEDS[op];
  if (!n) return null;
  const i = req.inputs ?? {};
  if (n.images && (i.images?.length ?? 0) < n.images) return n.msg;
  if (n.video && !i.video) return n.msg;
  // A join may also be one clip and a still appended after it (an ad and its end card).
  const clips = (i.videos?.length ?? 0) + (op === "concat" && i.video && i.images?.length ? 2 : 0);
  if (n.videos && clips < n.videos) return n.msg;
  if (n.audio && !i.audio) return n.msg;
  if (n.audios && (i.audios?.length ?? 0) < n.audios) return n.msg;
  if (n.endImage && !i.endImage) return n.msg;
  if (n.mask && !i.mask) return n.msg;
  if (n.model3d && !i.model3d) return n.msg;
  if (n.oneOf && !n.oneOf.some((k) => given(i[k]))) return n.msg;
  return null;
}

const INPUT_WORDS: Partial<Record<InputKey, string>> = {
  images: "reference images",
  videos: "reference videos",
  audios: "reference audio",
  audio: "audio",
  video: "video",
};

/** Whether a route's field map has a place for this input. */
function readsInput(map: NonNullable<ModelRoute["map"]>, k: InputKey): boolean {
  if (k === "images") return !!(map.image || map.images);
  if (k === "video") return !!(map.video || map.videoArray);
  return !!map[k as keyof typeof map];
}

/**
 * For "this or that" inputs: what was attached is something none of the model's routes can send
 * (Demucs splits audio, not a video; a reference-to-video model that only takes images was given clips).
 * Needs the routes' field maps, so only the server (full catalog) checks it.
 */
function unreadInputs(model: ModelDef, op: Operation, req: Pick<GenerationRequest, "inputs">): string | null {
  const keys = NEEDS[op]?.oneOf;
  const routes = routesFor(model, op);
  if (!keys || !routes.length || routes.some((r) => !r.map)) return null;
  const i = req.inputs ?? {};
  const attached = keys.filter((k) => given(i[k]));
  const reads = (k: InputKey) => routes.some((r) => readsInput(r.map!, k));
  if (!attached.length || attached.some(reads)) return null;
  const words = keys.filter(reads).map((k) => INPUT_WORDS[k] ?? k);
  return words.length ? `${model.name} works from ${words.join(" or ")} — add one` : null;
}

/** Models that need several images (try-on: the person, then the garment). */
function missingImages(model: ModelDef, req: Pick<GenerationRequest, "inputs">): string | null {
  const min = model.options.minImages ?? 0;
  if ((req.inputs?.images?.length ?? 0) >= min) return null;
  const labels = model.options.imageLabels?.slice(0, min);
  return labels?.length === min ? `Add the ${labels.join(" and the ")}` : `${model.name} needs ${min} images`;
}

/** The price that holds at `now`: a launch promo to the end of its last day (UTC), then the list price. */
export function pricingAt(p: Pricing, now = Date.now()): Pricing {
  if (!p.promo) return p;
  const { promo, ...list } = p;
  if (!(now <= Date.parse(`${promo.until}T23:59:59.999Z`))) return list;
  return { ...list, usd: promo.usd, ...(promo.byResolution ? { byResolution: promo.byResolution } : {}) };
}

/**
 * Operations whose result is as long as the clip they're given (upscale, FPS Boost, HDR, export): a per-second
 * price counts the clip's seconds (params.sourceDuration) when the caller knows them, and slow motion bills
 * the whole stretched result.
 */
const CLIP_LENGTH_OPS = new Set<Operation>(["upscale-video", "interpolate", "sdr-to-hdr", "export-video"]);

/**
 * Which of a plan's LoRAs a route really applies, and why the others are left out: ComfyUI loads every file
 * (injectLoras); a cloud route carries the ones fitLoras keeps (the licence allows hosting, there is a URL to
 * send, the API takes LoRAs and so many). The preview reports it, so a caller (the evaluation harness) records
 * the recipe that ran, not the one it asked for.
 */
export function routeLoras(route: Pick<ModelRoute, "provider" | "map" | "loraEndpoint">, loras: LoraRef[]): { applied: LoraRef[]; dropped: { file: string; reason: string }[] } {
  const applied = fitLoras(loras, route).loras;
  const field = routeLoraField(route);
  const why = (l: LoraRef) => {
    if (localOnly(l)) return "its licence doesn't allow hosting, so it runs only on your GPU";
    if (gated(l) && !l.hostedUrl) return "it is in a gated Hugging Face repo, so it runs only on your GPU";
    if (!cloudPath(l) && !needsToken(l.url)) return "no URL to send to the LoRA endpoint";
    if (!field) return "this route takes no LoRAs";
    return field.shape === "experts" ? "this API takes one LoRA per expert" : `this API takes up to ${loraCapacity(field)} LoRAs`;
  };
  return { applied, dropped: loras.filter((l) => !applied.includes(l)).map((l) => ({ file: l.file, reason: why(l) })) };
}

/** Rough USD estimate for a plan (BYO-key cloud runs). Open-source runs are free. */
export function estimateCost(model: ModelDef, params: GenParams, jobs = 1, op?: Operation, withLoras = false): number | null {
  if (model.engine === "open" || !model.pricing) return model.engine === "open" ? 0 : null;
  const p = model.pricing;
  const n = params.numOutputs ?? 1;
  const res = params.resolution ?? model.defaults?.resolution;
  // A run with LoRAs goes to the LoRA endpoint, which has its own price.
  const usd = withLoras && p.withLoras !== undefined ? p.withLoras : (res && p.byResolution && (p.byResolution[res] ?? p.byResolution[res.toLowerCase()])) || p.usd;
  let per = usd;
  const clip = op && CLIP_LENGTH_OPS.has(op) && params.sourceDuration && params.sourceDuration > 0 ? params.sourceDuration * (op === "interpolate" ? Math.max(1, params.slowdown ?? 1) : 1) : undefined;
  if (p.unit === "image") per = usd * n;
  if (p.unit === "second") per = usd * (clip ?? params.duration ?? model.defaults?.duration ?? 5) * (p.inputSeconds ? 2 : 1);
  if (p.unit === "minute") per = (usd * (params.duration ?? 60)) / 60;
  // Settings that change the price (60 fps, a Pro tier, a cheaper model).
  for (const f of p.factors ?? []) {
    const v = f.param === "targetFps" ? (params.targetFps ?? model.defaults?.targetFps) : (params.extra?.[f.param] ?? model.options.controls?.find((c) => c.param === f.param)?.default);
    const k = v === undefined || v === null ? undefined : f.values[String(v)];
    if (k !== undefined && k > 0) per *= k;
  }
  if (params.generateAudio === false && model.options.audio === true && p.note?.includes("audio-off-half")) per /= 2;
  if (p.animationUsd && params.animation !== undefined && params.animation !== "") per += p.animationUsd;
  return Math.round(per * jobs * 1000) / 1000;
}
