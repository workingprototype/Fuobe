/**
 * Core catalog types shared by the UI and the server.
 *
 * A *model* is something the user picks in the model picker (e.g. "Kling 2.5 Turbo"
 * or "Wan 2.2 (open source)"). Each model has one or more *routes*: a route says how
 * to run one *operation* (text-to-video, image-to-video, ...) on one *provider*
 * (fal, replicate, comfyui, ...). Presets (apps, camera motions, effects) sit on top
 * of models and add prompt templates, fixed inputs and LoRAs.
 */

export type Engine = "cloud" | "open";

export type MediaKind = "image" | "video" | "audio";

export type Operation =
  | "t2i" // text → image
  | "edit" // image(s) + instruction → image
  | "inpaint" // image + mask + prompt → image
  | "outpaint"
  | "t2v" // text → video
  | "i2v" // image → video
  | "flf2v" // first + last frame → video
  | "ref2v" // reference images → video
  | "v2v" // video edit / restyle
  | "lipsync" // video + audio → video
  | "avatar" // portrait + audio → talking video
  | "motion-transfer" // character image + driving video → video
  | "upscale-image"
  | "upscale-video"
  | "bg-remove"
  | "face-swap"
  | "tts"
  | "sfx"
  | "music"
  | "v2a" // video → audio/foley
  | "interpolate";

export const OPERATION_LABELS: Record<Operation, string> = {
  t2i: "Text to image",
  edit: "Image edit",
  inpaint: "Inpaint",
  outpaint: "Outpaint",
  t2v: "Text to video",
  i2v: "Image to video",
  flf2v: "Start & end frame",
  ref2v: "Reference to video",
  v2v: "Video to video",
  lipsync: "Lipsync",
  avatar: "Talking avatar",
  "motion-transfer": "Motion transfer",
  "upscale-image": "Image upscale",
  "upscale-video": "Video upscale",
  "bg-remove": "Background removal",
  "face-swap": "Face swap",
  tts: "Text to speech",
  sfx: "Sound effects",
  music: "Music",
  v2a: "Video to audio",
  interpolate: "Frame interpolation",
};

export const OPERATION_OUTPUT: Record<Operation, MediaKind> = {
  t2i: "image",
  edit: "image",
  inpaint: "image",
  outpaint: "image",
  t2v: "video",
  i2v: "video",
  flf2v: "video",
  ref2v: "video",
  v2v: "video",
  lipsync: "video",
  avatar: "video",
  "motion-transfer": "video",
  "upscale-image": "image",
  "upscale-video": "video",
  "bg-remove": "image",
  "face-swap": "image",
  tts: "audio",
  sfx: "audio",
  music: "audio",
  v2a: "video",
  interpolate: "video",
};

export type ProviderId = "fal" | "replicate" | "openai" | "google" | "comfyui" | "mock";

/** Duration encodings differ between APIs ("5" vs 5 vs "5s"). */
export interface DurationField {
  key: string;
  type: "string" | "number";
  suffix?: string;
  /** e.g. 1000 when the API wants milliseconds. */
  multiplier?: number;
}

export interface EnumField {
  key: string;
  /** Map our canonical value → provider value. Unlisted values pass through. */
  values?: Record<string, string | number | boolean>;
}

/**
 * How a canonical {@link GenInput} maps onto a provider payload.
 * Keys are our canonical fields, values are the provider's field names.
 */
export interface FieldMap {
  prompt?: string | false;
  negativePrompt?: string;
  /** Single primary image field, e.g. "image_url". */
  image?: string;
  /** Array of images field, e.g. "image_urls" (receives every reference image). */
  images?: string;
  endImage?: string;
  mask?: string;
  video?: string;
  audio?: string;
  aspectRatio?: string | EnumField;
  resolution?: string | EnumField;
  duration?: DurationField;
  numOutputs?: string;
  seed?: string;
  generateAudio?: string;
  /** Static fields always sent (e.g. safety checker switches). */
  fixed?: Record<string, unknown>;
}

export interface ModelRoute {
  op: Operation;
  provider: ProviderId;
  /** fal endpoint id, replicate "owner/name", or ComfyUI workflow id from the manifest. */
  endpoint: string;
  map?: FieldMap;
  /** Optional note shown in the UI (e.g. "uses Lightx2v 4-step LoRA"). */
  note?: string;
}

export type Badge = "new" | "top" | "fast" | "audio" | "4k" | "hd" | "pro" | "open" | "uncensored" | "beta";

export interface ModelOptions {
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[];
  /** Max outputs per request the model supports natively. */
  maxOutputs?: number;
  /** Max reference images accepted (edit / multi-ref). */
  maxImages?: number;
  seed?: boolean;
  negativePrompt?: boolean;
  /** true = optional toggle, "always" = native audio always on. */
  audio?: boolean | "always";
  endFrame?: boolean;
}

export interface Pricing {
  unit: "image" | "second" | "video" | "request" | "megapixel" | "minute";
  usd: number;
  note?: string;
}

export interface ModelDef {
  id: string;
  name: string;
  vendor: string;
  family: string;
  engine: Engine;
  kind: MediaKind;
  tagline: string;
  badges?: Badge[];
  routes: ModelRoute[];
  options: ModelOptions;
  defaults?: Partial<Pick<GenParams, "aspectRatio" | "resolution" | "duration" | "numOutputs" | "generateAudio">>;
  pricing?: Pricing;
  /** Hidden from pickers (used only internally by presets). */
  hidden?: boolean;
}

/** User-facing generation parameters (canonical, provider-agnostic). */
export interface GenParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  numOutputs?: number;
  seed?: number;
  generateAudio?: boolean;
  enhancePrompt?: boolean;
  /** Free-form advanced params forwarded to the provider payload. */
  extra?: Record<string, unknown>;
}

export interface LoraRef {
  /** File name as placed in ComfyUI models/loras. */
  file: string;
  url?: string;
  strength?: number;
  trigger?: string;
}

/** What the UI posts to /api/generations. Asset references are local asset ids or URLs. */
export interface GenerationRequest {
  feature: string;
  presetId?: string;
  modelId: string;
  op?: Operation;
  prompt?: string;
  negativePrompt?: string;
  inputs?: {
    images?: string[];
    endImage?: string;
    mask?: string;
    video?: string;
    audio?: string;
  };
  params?: GenParams;
  /** Values for preset option pickers (apps). */
  presetOptions?: Record<string, string>;
}

/** Canonical, provider-ready input (asset refs already resolved to provider URLs/filenames). */
export interface GenInput extends GenParams {
  prompt?: string;
  negativePrompt?: string;
  images?: string[];
  endImage?: string;
  mask?: string;
  video?: string;
  audio?: string;
  loras?: LoraRef[];
}

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface OutputFile {
  url: string;
  kind: MediaKind;
  contentType?: string;
  width?: number;
  height?: number;
  assetId?: string;
}

export interface Generation {
  id: string;
  batchId: string | null;
  feature: string;
  presetId: string | null;
  modelId: string;
  engine: Engine;
  provider: ProviderId;
  op: Operation;
  kind: MediaKind;
  status: GenerationStatus;
  progress: number | null;
  message: string | null;
  prompt: string | null;
  request: GenerationRequest;
  outputs: OutputFile[];
  error: string | null;
  costUsd: number | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** Input slot a preset asks the user for. */
export interface InputSlot {
  key: "image" | "image2" | "image3" | "endImage" | "video" | "audio" | "mask";
  label: string;
  hint?: string;
  accept: MediaKind;
  required?: boolean;
}

export interface PresetChoice {
  value: string;
  label: string;
  /** Text substituted for {option:<key>} in the prompt template. */
  prompt: string;
}

export interface PresetOption {
  key: string;
  label: string;
  choices: PresetChoice[];
  default?: string;
}

export interface PresetRoute {
  modelId: string;
  op: Operation;
  params?: GenParams;
  loras?: LoraRef[];
  /** Overrides the preset prompt template for this engine. */
  promptTemplate?: string;
}

export type PresetType = "app" | "motion" | "effect";

export interface Preset {
  id: string;
  type: PresetType;
  name: string;
  category: string;
  description: string;
  /** Visual identity for the card when we have no media preview. */
  look: { icon: string; from: string; to: string };
  badges?: Badge[];
  inputs: InputSlot[];
  options?: PresetOption[];
  /** "{prompt}" = user text, "{option:key}" = selected option prompt. */
  promptTemplate: string;
  userPrompt: "none" | "optional" | "required";
  promptPlaceholder?: string;
  cloud: PresetRoute | null;
  open: PresetRoute | null;
  /** Research confidence / parity notes shown in docs and the UI. */
  parity?: string;
}
