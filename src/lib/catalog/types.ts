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

/** "text" = transcripts, translations, scripts (OutputFile.text); "model3d" = a .glb mesh. */
export type MediaKind = "image" | "video" | "audio" | "text" | "model3d";

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
  | "interpolate"
  | "extend" // video → the same clip, continued
  | "grade" // colour grade, rendered in the browser
  | "reframe" // video → same video at a new aspect ratio (AI-filled edges)
  | "finalize" // draft video → full-quality render of the same take
  | "dialogue" // several speakers → one audio track
  | "voice-change" // speech audio → the same speech in another voice
  | "dub" // video (or audio) → translated, re-voiced and lip-synced
  | "bg-remove-video" // video → the subject on a transparent background
  | "depth-video" // video → depth map video
  | "relight-video" // video → the same shot under new lighting
  | "concat" // several clips → one video, in order
  | "frame" // video → one of its frames (the last, for extending)
  | "color-match" // image or video + reference image → recoloured to the reference's palette
  | "layers" // image → its layers as RGBA images (OutputFile.meta: name, z, bbox)
  | "text-layers" // image → the background with the text removed + the text blocks (OutputFile.meta.textBlocks)
  | "trim" // video → the part between params.startTime and params.endTime
  | "transcribe" // audio or video → timed text (OutputFile.text, OutputFile.meta.cues)
  | "captions" // video → the same video with burned-in captions
  | "mux" // video + audio → the video with that soundtrack
  | "image-to-3d" // image → a 3D model (.glb), optionally a turntable video
  | "separate-audio" // audio or video → voice and background stems
  | "translate" // text → the same text in params.targetLanguage (LLM)
  | "write" // brief → text (LLM: scripts, ad copy, shot lists)
  | "vectorize"; // image → the same picture as an SVG

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
  extend: "Extend video",
  grade: "Color grade",
  reframe: "Reframe",
  finalize: "Final render",
  dialogue: "Dialogue",
  "voice-change": "Voice change",
  dub: "Translate & dub",
  "bg-remove-video": "Video background removal",
  "depth-video": "Video depth map",
  "relight-video": "Video relight",
  concat: "Join clips",
  frame: "Extract frame",
  "color-match": "Match colors",
  layers: "Layers",
  "text-layers": "Text layers",
  trim: "Trim video",
  transcribe: "Transcribe",
  captions: "Captions",
  mux: "Add soundtrack",
  "image-to-3d": "Image to 3D",
  "separate-audio": "Separate voice",
  translate: "Translate",
  write: "Write",
  vectorize: "Vectorize",
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
  extend: "video",
  grade: "image",
  reframe: "video",
  finalize: "video",
  dialogue: "audio",
  "voice-change": "audio",
  dub: "video",
  "bg-remove-video": "video",
  "depth-video": "video",
  "relight-video": "video",
  concat: "video",
  frame: "image",
  "color-match": "image",
  layers: "image",
  "text-layers": "image",
  trim: "video",
  transcribe: "text",
  captions: "video",
  mux: "video",
  "image-to-3d": "model3d",
  "separate-audio": "audio",
  translate: "text",
  write: "text",
  vectorize: "image",
};

/** "llm" runs text steps (translate, write) on the configured LLM (Claude or Ollama) inside the server. */
export type ProviderId = "fal" | "replicate" | "higgsfield" | "openai" | "google" | "comfyui" | "mock" | "local" | "llm";

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
  /** What the mask's paint means to this API: white (default), black or transparent = change. */
  maskFormat?: "white" | "black" | "alpha";
  video?: string;
  /** Video field that takes an array (receives the one input video). */
  videoArray?: string;
  /** Array field that receives every clip of `inputs.videos`, in order (join clips). */
  videos?: string;
  audio?: string;
  aspectRatio?: string | EnumField;
  resolution?: string | EnumField;
  duration?: DurationField;
  numOutputs?: string;
  seed?: string;
  /** Inclusive seed limits when the API accepts a narrow range (Fuobe's seeds are folded into it). */
  seedRange?: [number, number];
  /** Boolean field, or an on/off enum such as Kling's `sound: "on" | "off"`. */
  generateAudio?: string | { key: string; on: unknown; off: unknown };
  /** Premade voice name / id (ElevenLabs `voice`). Dotted keys write nested fields. */
  voice?: string;
  /** Reference clip to clone a voice from (zero-shot TTS) or to convert into (voice change). */
  voiceAudio?: string;
  /** Multi-speaker lines: an array of {text, voice}. */
  dialogue?: { key: string; text: string; voice: string };
  /** Language to translate into (dubbing). */
  targetLanguage?: string;
  /** Native multi-shot: an array of {prompt, duration} (Kling's `multi_prompt`). */
  multiShot?: { key: string; durationType: "string" | "number"; json?: boolean; shotType?: string; flag?: string };
  /** Boolean draft switch (Seedance 2.5 renders a cheap 480p take and returns a draft id). */
  draft?: string;
  /** Field that takes the draft id to finish. */
  draftId?: string;
  /** Trim: where the kept part starts and ends (seconds × multiplier). */
  startTime?: DurationField;
  endTime?: DurationField;
  /** Frames per second (frame sampling, images to video). */
  fps?: string;
  /**
   * Colour palette: hex strings converted to the API's shape ("rgb-object" = Recraft on fal [{r,g,b}],
   * "rgb-array" = Recraft on Higgsfield [{rgb:[r,g,b]}], "ideogram" = {members:[{rgb:{r,g,b}, color_weight}]}).
   * `background` names the API's background-colour field: a hex string sent as params.extra[background]
   * is converted to the same shape.
   */
  palette?: { key: string; format: "hex" | "rgb-object" | "rgb-array" | "ideogram"; background?: string };
  /** A saved style id (Recraft styles, Soul 2.0 moodboards). */
  styleId?: string;
  /** How many layers to split an image into. */
  numLayers?: string;
  sourceLanguage?: string;
  /** Second image field (inputs.images[1]): a try-on garment, a product shot's scene reference, a style image. */
  image2?: string;
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
  /** Same model with LoRA support (fal's `/lora` variants): used when a trained identity is mentioned. */
  loraEndpoint?: string;
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
  /** Multi-shot support: "native" sends per-shot prompts, "prompt" writes the shots into one prompt. */
  multiShot?: { mode: "native" | "prompt" | "concat"; maxShots: number };
  /** Draft mode (cheap preview, then a full render of the take you like). */
  draft?: boolean;
  /** A style/template list fetched from the provider (Soul styles, Genjutsu looks, Marketing Studio templates). */
  presets?: { source: string; param: string; label: string; required?: boolean };
  /** Premade voices the model offers (shown in the voice picker). */
  voices?: { id: string; name: string; hint?: string }[];
  /** Takes a reference recording to clone a voice from. */
  voiceClone?: boolean;
  /** Follows motion paths drawn on the start frame (Wan-Move). */
  motionPaths?: boolean;
  /** Languages it can translate into. */
  languages?: string[];
  /** Numeric settings sent as-is (stability, similarity, speed, exaggeration…). */
  sliders?: { param: string; label: string; min: number; max: number; step: number; default: number }[];
  /** Extra enum settings sent as-is (Cinema Studio's genre, lens, light, grade, camera move…). */
  controls?: { param: string; label: string; values: (string | number)[]; default?: string | number }[];
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
  defaults?: Partial<Pick<GenParams, "aspectRatio" | "resolution" | "duration" | "numOutputs" | "generateAudio" | "voice">>;
  pricing?: Pricing;
  /** Trained identities this model accepts by id (Higgsfield Soul ID). */
  identity?: { provider: "higgsfield"; version: "v1" | "v2" | "cinema" };
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
  /** Premade voice (TTS, voice change). */
  voice?: string;
  /** Dialogue lines, each with its own voice. */
  dialogue?: { text: string; voice?: string }[];
  /** Dubbing target language. */
  targetLanguage?: string;
  /** Multi-shot: shots in order (empty/undefined = one shot). "auto" lets the model cut by itself. */
  shots?: { prompt: string; duration: number }[];
  multiShot?: "auto";
  /** Render a cheap draft first (Seedance 2.5 draft mode). */
  draft?: boolean;
  /** Finish this draft at full quality (op "finalize"). */
  draftId?: string;
  /** Trim: the part of the input video to keep, in seconds. */
  startTime?: number;
  endTime?: number;
  /** Output / sampling frame rate. */
  fps?: number;
  /** Colour palette as hex strings ("#1a2b3c"), Soul HEX / Cinema Studio palettes. */
  palette?: string[];
  /** A saved style id (Recraft style, Soul 2.0 moodboard). */
  styleId?: string;
  /** Language of the source speech (transcribe, dub); omit to detect. */
  sourceLanguage?: string;
  /** Layer decomposition: how many layers to ask for. */
  numLayers?: number;
  /** Free-form advanced params forwarded to the provider payload. */
  extra?: Record<string, unknown>;
}

export interface LoraRef {
  /** File name as placed in ComfyUI models/loras. */
  file: string;
  url?: string;
  strength?: number;
  trigger?: string;
  /** Wan 2.2 MoE: which expert gets the LoRA. */
  target?: "high" | "low" | "both";
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
    /** The first image with painted instructions: a red-tinted mask (inpaint) or drawn arrows/notes (draw to edit/video). */
    sketch?: string;
    video?: string;
    audio?: string;
    /** Reference recording of the voice to speak with / convert into. */
    voiceAudio?: string;
    /** Second speaker's reference voice (open-source dialogue). */
    voiceAudio2?: string;
    /** Several clips in order (join clips). */
    videos?: string[];
  };
  params?: GenParams;
  /** Values for preset option pickers (apps). */
  presetOptions?: Record<string, string>;
  /** Motions/effects: how strongly the preset applies (0–1, default 1). */
  presetStrength?: number;
  /** Higgsfield's Mix: a second motion or effect on top of the first, with its own strength. */
  mix?: { presetId: string; strength: number };
  /** Server-side only: LoRAs added by @element mentions (trained identities). */
  loras?: LoraRef[];
  /** Chained jobs: where the previous job's image goes among `inputs.images` (one dependency). */
  chainFrom?: "first" | "last";
  /** Chained jobs with several dependencies: where each one's first output goes, in dependsOn order. */
  chain?: ChainSlot[];
  /** Storyboard frame this request makes (shown under the frame). */
  frame?: { scene: string; index: number; of: number };
  /** Part of a multi-step job (a shot of a multi-shot film, a step of an extend): shown on its tile. */
  step?: { label: string; index: number; of: number };
}

export interface ChainSlot {
  /**
   * "prompt" takes the dependency's text output (OutputFile.text): it replaces "{text}" in the
   * request's prompt, or becomes the prompt when there is no placeholder.
   * "voiceAudio" clones the voice of the dependency's audio output.
   */
  slot: "images" | "endImage" | "video" | "videos" | "audio" | "voiceAudio" | "prompt";
  /** For list slots: put it before or after the request's own items (default last). */
  position?: "first" | "last";
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
  voiceAudio?: string;
  voiceAudio2?: string;
  videos?: string[];
  loras?: LoraRef[];
}

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface OutputFile {
  url: string;
  /** Text outputs (transcribe, translate, write): the content, also saved as a file at `url`. */
  text?: string;
  /**
   * Structured extras a provider returned with this file: a layer's {name, z, bbox: [x, y, w, h]},
   * transcript cues [{start, end, text}], text blocks, a 3D model's preview…
   */
  meta?: Record<string, unknown>;
  /** Draft renders: the id to finish this take at full quality. */
  draftId?: string;
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
  /** Display names resolved on the server, so result views need no catalog in the browser. */
  modelName?: string;
  presetName?: string | null;
  /** The aspect ratio it was made at (the request's, else the model's default), for tile shapes. */
  aspectRatio?: string | null;
  /** Moved to the Trash at (soft delete; purged after 30 days). */
  deletedAt?: number | null;
  /** Library folder it's in. */
  folderId?: string | null;
}

/** Input slot a preset asks the user for. */
export interface InputSlot {
  key: "image" | "image2" | "image3" | "endImage" | "video" | "audio" | "mask" | "sketch" | "voiceAudio" | "voiceAudio2";
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

/** Route endpoint for models without an extend API: last frame → image-to-video → join (src/server/chains.ts). */
export const LAST_FRAME_CHAIN = "chain:last-frame";
