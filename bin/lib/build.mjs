// Turning `fuobe generate` options into a POST /api/generations body, and the small pure helpers
// around it (which inputs are local files, which model to use when none is named). No I/O.
import { keyValue, suggest, UsageError } from "./args.mjs";

/** Params the server reads at the top level of `params` (anything else from --param goes in `params.extra`). */
const PARAMS = new Set([
  "aspectRatio",
  "resolution",
  "duration",
  "numOutputs",
  "seed",
  "generateAudio",
  "enhancePrompt",
  "draft",
  "draftId",
  "voice",
  "targetLanguage",
  "startTime",
  "endTime",
  "fps",
  "styleId",
  "sourceLanguage",
  "numLayers",
  "palette",
  "multiShot",
  "shots",
  "dialogue",
]);

/** Already a reference the server reads itself: one of its own files, a public link or a data URI. */
export const isRemoteRef = (ref) => /^(https?:\/\/|data:)/i.test(ref) || ref.startsWith("/api/files/");

/**
 * Every file option, in order, as [slot, ref]: `images` (and `endImage`, `mask`), one `video` or
 * several (reference clips, `videos`), `audio`, `audio2` (a background track), `audios`
 * (reference clips), `voiceAudio` (a voice to clone or change into) and `voiceAudio2` (a dialogue's
 * second speaker).
 * @param {Record<string, any>} v parsed options
 * @returns {[string, string][]}
 */
export function fileInputs(v) {
  const list = [];
  for (const ref of v.image ?? []) list.push(["images", ref]);
  if (v["end-image"]) list.push(["endImage", v["end-image"]]);
  if (v.mask) list.push(["mask", v.mask]);
  const videos = v.video ?? [];
  if (videos.length === 1 && !v["ref-video"]?.length) list.push(["video", videos[0]]);
  else for (const ref of [...videos, ...(v["ref-video"] ?? [])]) list.push(["videos", ref]);
  const audios = v.audio ?? [];
  if (audios.length > 1) throw new UsageError("Pass one --audio. A second track goes in --background-audio; reference clips in --ref-audio.", "generate");
  if (audios[0]) list.push(["audio", audios[0]]);
  if (v["background-audio"]) list.push(["audio2", v["background-audio"]]);
  for (const ref of v["ref-audio"] ?? []) list.push(["audios", ref]);
  const voices = v["voice-audio"] ?? [];
  if (voices.length > 2) throw new UsageError("Pass at most two --voice-audio samples (one per speaker of a dialogue).", "generate");
  if (voices[0]) list.push(["voiceAudio", voices[0]]);
  if (voices[1]) list.push(["voiceAudio2", voices[1]]);
  return list;
}

/** Local files among the inputs (each uploaded once, however often it's named). */
export const localFiles = (inputs) => [...new Set(inputs.map(([, ref]) => ref).filter((ref) => !isRemoteRef(ref)))];

/**
 * The request body for POST /api/generations (and its `?preview=1`).
 * @param {{ prompt?: string, modelId: string, values: Record<string, any>, uploaded?: Map<string, string> }} a
 *   `uploaded` maps each local path to the URL /api/uploads gave it.
 */
export function generationRequest({ prompt, modelId, values: v, uploaded = new Map() }) {
  /** @type {Record<string, any>} */
  const inputs = {};
  for (const [slot, ref] of fileInputs(v)) {
    const url = isRemoteRef(ref) ? ref : uploaded.get(ref);
    if (!url) throw new Error(`${ref} wasn't uploaded`);
    if (slot === "images" || slot === "videos" || slot === "audios") (inputs[slot] ??= []).push(url);
    else inputs[slot] = url;
  }
  if ((inputs.images?.length ?? 0) > 14) throw new UsageError("Pass at most 14 images", "generate");
  /** @type {Record<string, any>} */
  const params = {};
  if (v.aspect) params.aspectRatio = v.aspect;
  if (v.resolution) params.resolution = v.resolution;
  if (v.duration !== undefined) {
    if (!(v.duration > 0)) throw new UsageError("--duration is a number of seconds above 0", "generate");
    params.duration = v.duration;
  }
  if (v.count !== undefined) {
    if (!Number.isInteger(v.count) || v.count < 1 || v.count > 8) throw new UsageError("--count is a whole number from 1 to 8", "generate");
    params.numOutputs = v.count;
  }
  if (v.seed !== undefined) {
    if (!Number.isInteger(v.seed)) throw new UsageError("--seed is a whole number", "generate");
    params.seed = v.seed;
  }
  if (v.sound !== undefined) params.generateAudio = v.sound;
  if (v.enhance !== undefined) params.enhancePrompt = v.enhance;
  if (v.voice) params.voice = v.voice;
  if (v.language) params.targetLanguage = v.language;
  if (v["source-language"]) params.sourceLanguage = v["source-language"];
  if (v.start !== undefined) params.startTime = v.start;
  if (v.end !== undefined) params.endTime = v.end;
  for (const pair of v.param ?? []) {
    const [key, value] = keyValue(pair);
    if (PARAMS.has(key)) params[key] = value;
    else (params.extra ??= {})[key] = value;
  }
  const text = prompt?.trim();
  return {
    feature: "cli",
    modelId,
    ...(v.op && { op: v.op }),
    ...(text && { prompt: text }),
    ...(v.negative && { negativePrompt: v.negative }),
    ...(Object.keys(inputs).length && { inputs }),
    ...(Object.keys(params).length && { params }),
  };
}

/** Which of GET /api/models' `defaults` a request without --model takes. */
function defaultKey(kind, want) {
  if (kind === "image") return want.hasImages ? "edit" : "image";
  if (kind !== "audio") return kind;
  // Voice samples (--voice-audio): a model that clones them; two are a dialogue's speakers.
  if (want.op === "dialogue" || want.voices === 2) return want.voices ? "cloneDialogue" : "dialogue";
  return want.voices ? "clone" : "audio";
}

const DEFAULT_WHAT = { clone: "model that clones a voice sample", cloneDialogue: "dialogue model that clones two voice samples", dialogue: "dialogue model" };

/**
 * The studio's own model when none is named: the Image studio's (Edit's when there are images),
 * Video's or Audio's (one that clones the voice for --voice-audio, a dialogue for two samples),
 * on the engine asked for (else cloud, unless the install is open source only).
 * @param {{ engineMode?: string, defaults?: Record<string, { cloud?: string, open?: string }> }} list GET /api/models
 * @param {{ kind?: string, engine?: string, op?: string, hasImages?: boolean, hasMedia?: boolean, voices?: number }} want
 *   `hasMedia`: a video or audio input; `voices`: how many voice samples
 */
export function defaultModel(list, want) {
  // A clip or a recording can go to many kinds of model (edit, extend, lipsync, transcribe…): that's the user's pick.
  if (want.hasMedia) throw new UsageError("Name the model for a video or audio input with --model (fuobe models --search lipsync, for example).", "generate");
  const kind = want.kind ?? "image";
  const key = defaultKey(kind, want);
  const engine = want.engine ?? (list.engineMode === "open" ? "open" : "cloud");
  const id = list.defaults?.[key]?.[engine];
  if (id) return id;
  if (list.engineMode && list.engineMode !== "both" && list.engineMode !== engine) {
    throw new UsageError(`This Fuobe runs ${list.engineMode === "open" ? "open-source" : "cloud"} models only (Settings → Engine mode). Leave out --engine, or pick a model with --model.`, "generate");
  }
  const other = engine === "open" ? "cloud" : "open";
  const alt = list.defaults?.[key]?.[other];
  const fix = alt ? `Add --engine ${other} (${alt}), or pick a model with --model` : "Pick one with --model";
  throw new UsageError(`There's no default ${engine === "open" ? "open-source" : "cloud"} ${DEFAULT_WHAT[key] ?? `${kind} model`}. ${fix} (fuobe models --kind ${kind}).`, "generate");
}

/**
 * Why a model can't take the voice samples given (null when it can): one sample needs a model
 * that clones voices, two a dialogue that clones both speakers. The server would otherwise run it
 * in a premade voice, or as one speaker, without a word.
 * @param {{ id: string, opIds?: string[], voiceClone?: boolean } | undefined} info the model's GET /api/models item
 * @param {number} voices how many --voice-audio samples
 * @param {Record<string, { cloud?: string, open?: string }>} [defaults] GET /api/models' defaults, for a suggestion
 */
export function voiceSampleProblem(info, voices, defaults = {}) {
  if (!info || !voices) return null;
  const alternatives = (key) => {
    const ids = Object.values(defaults[key] ?? {}).filter(Boolean);
    return ids.length ? `--model ${ids.join(" or --model ")}` : null;
  };
  if (voices === 2 && !(info.voiceClone && info.opIds?.includes("dialogue"))) {
    const clone = alternatives("cloneDialogue");
    return `${info.id} doesn't clone two voices. Two --voice-audio samples are a dialogue's speakers${clone ? `: use ${clone}` : " (fuobe models --op dialogue)"}.`;
  }
  if (!info.voiceClone) {
    const clone = alternatives("clone");
    return `${info.id} speaks in premade voices (--voice <id>) and doesn't clone a voice sample. Leave out --voice-audio, or use a model that clones one${clone ? ` (${clone})` : " (fuobe models --op tts)"}.`;
  }
  return null;
}

/** What the planner asks for ("Add a portrait and a voice track") → the options that give it. */
const HINTS = [
  [/voice sample for each/i, "--voice-audio <file> once per speaker"],
  [/record the voice/i, "--voice-audio <file>"],
  [/\bstart\b|image|photo|portrait|picture|\bface\b/i, "--image <file|url>"],
  [/end frame/i, "--end-image <file|url>"],
  [/paint the area/i, "--mask <file|url>"],
  [/clips\b/i, "--video <file|url> for each clip"],
  [/video|\bclip\b/i, "--video <file|url>"],
  [/audio|voice track|soundtrack|recording/i, "--audio <file|url>"],
  [/language/i, "--language <lang>"],
];

/**
 * The server's reason a request can't run, with the command-line options that fix it:
 * "Add a portrait and a voice track (use --image <file|url> and --audio <file|url>)". The message
 * as it was when no option helps.
 * @param {string} message
 * @param {string[]} [modelIds] for "Unknown model …": the ids to suggest from
 */
export function withInputHint(message, modelIds = []) {
  const unknown = /^Unknown model (\S+)/.exec(message);
  if (unknown) {
    const near = suggest(unknown[1], modelIds);
    return `${message}.${near ? ` Did you mean ${near}?` : ""} fuobe models --search ${unknown[1].split(/[^a-z]+/i)[0] || unknown[1]} lists the ids.`;
  }
  if (/^Write a prompt/.test(message)) return `${message}: it goes in quotes after the command, as in fuobe generate "a red fox in the snow"`;
  if (/^Write at least one line/.test(message)) return `${message} of the dialogue: --param 'dialogue=[{"text": "Hi!", "voice": "A"}, {"text": "Hello.", "voice": "B"}]'`;
  if (!/^(Add|Pick)\b/.test(message)) return message;
  const flags = HINTS.flatMap(([re, flag]) => (re.test(message) ? [flag] : [])).filter((f, i, all) => !(f === "--video <file|url>" && all.includes("--video <file|url> for each clip")));
  if (!flags.length) return message;
  const joined = flags.length === 1 ? flags[0] : `${flags.slice(0, -1).join(", ")} ${/audio or video/i.test(message) ? "or" : "and"} ${flags.at(-1)}`;
  return `${message} (use ${joined})`;
}
