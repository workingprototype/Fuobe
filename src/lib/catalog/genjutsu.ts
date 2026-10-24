/**
 * Genjutsu (Higgsfield's /genjutsu): keep a clip's motion, camera and framing, change what is in it. Four modes:
 * Motion transfer (your character does what the clip's person does), Object swap (a thing, a person or an outfit in
 * the clip becomes your reference), Restyle (every frame takes a look) and Insert (your reference is added where you
 * say). Higgsfield runs the first three on its Genjutsu models (Lite: motion and swap only, cheaper); Fuobe also runs
 * every mode without a Higgsfield key (Kling O3 edit, Kling 3.0 Motion Control, hosted Wan 2.2 VACE, P-Video Replace,
 * the Shorts restyle models) and on the open engine (Wan Animate 2, Wan 2.1 VACE swap and insert, the Shorts
 * Fun VACE restyle chain).
 *
 * Every model takes a part of the clip (Genjutsu Lite 15 s, Kling 3–15 s, VACE 81 or 241 frames…), so longer
 * selections are cut into pieces or windows, made one by one, joined, and the clip's own sound put back (the
 * remove-object plumbing). Pure module (models per mode and engine, limits, prompts, prices, the pipeline's steps and
 * the shareable setup code), shared by the page, the server (src/server/genjutsu.ts) and the tests.
 * Research: docs/research/higgsfield-delta-4.md §4.2, paid-model-apis-4.md §4, comfyui-oss-4.md §c.
 */
import {
  joinWithSound,
  MASK_TRACKER,
  planCloudPieces,
  planFrameCuts,
  planWindows,
  REMOVE_TOOLS,
  targetPhrase,
  VACE_WINDOW,
  wholeClip,
  type FrameWindow,
  type Piece,
  type RemoveMode,
  type RemoveRange,
  type RemoveSource,
} from "./remove-object";
import { getShortsPreset, lookFromPreset, planShorts, type PlanStep, type ShortsLook } from "./shorts";
import type { ChainSlot, Engine, GenerationRequest, PixelPoint } from "./types";

export type GenjutsuMode = "motion" | "swap" | "restyle" | "insert";
/** How you say what changes (Object swap and Insert): words, clicks on the first frame, or paint on it. */
export type GenjutsuTarget = RemoveMode;
export type GenjutsuQuality = "480p" | "720p" | "1080p";
/** Genjutsu Lite ("standard") or Genjutsu ("high"). */
export type GenjutsuTier = "standard" | "high";

export const GENJUTSU = {
  feature: "genjutsu",
  /** Cuts, tracks, pieces, joins and the sound: kept apart from the finished videos. */
  stepFeature: "genjutsu-step",
  /** Higgsfield's source window: "Choose a source video between 4 and 30 seconds". */
  minSeconds: 4,
  maxSeconds: 30,
  maxBytes: 200 * 1024 * 1024,
  /** "Transfer motion or swap objects with up to 10 reference images". */
  maxReferences: 10,
  /** A custom Restyle look: RESTYLE_CUSTOM_PRESET_IMAGE_LIMIT. */
  maxLookImages: 8,
  maxPoints: 12,
  maxPromptChars: 2000,
  qualities: ["480p", "720p", "1080p"] as GenjutsuQuality[],
  defaultQuality: "720p" as GenjutsuQuality,
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export const GENJUTSU_MODES: { id: GenjutsuMode; label: string; hint: string; refs: string }[] = [
  { id: "motion", label: "Motion transfer", hint: "The movement and camera stay exactly as filmed. Swap in your character.", refs: "Your character" },
  { id: "swap", label: "Object swap", hint: "Swap a thing, a person or an outfit in the clip for your reference — everything else stays.", refs: "What goes in" },
  { id: "restyle", label: "Restyle", hint: "Pick a style or bring your own images. Every frame takes the look — motion, camera, and framing stay as filmed.", refs: "Characters (optional)" },
  { id: "insert", label: "Insert", hint: "Add your reference to the shot — say where, or paint the spot on the first frame.", refs: "What to add" },
];

export const getMode = (id: GenjutsuMode) => GENJUTSU_MODES.find((m) => m.id === id)!;

/** The ways of saying what changes, per mode (Motion transfer and Restyle change the whole shot). */
export const MODE_TARGETS: Record<GenjutsuMode, GenjutsuTarget[]> = { motion: [], restyle: [], swap: ["type", "click", "paint"], insert: ["type", "paint"] };

export const TARGET_LABELS: Record<GenjutsuMode, Partial<Record<GenjutsuTarget, { label: string; hint: string }>>> = {
  motion: {},
  restyle: {},
  swap: {
    type: { label: "Type it", hint: "Name what to swap" },
    click: { label: "Click it", hint: "Click it on the first frame" },
    paint: { label: "Paint it", hint: "Brush over it on the first frame" },
  },
  insert: {
    type: { label: "Say where", hint: "Describe where it goes" },
    paint: { label: "Paint the spot", hint: "Brush where it goes on the first frame" },
  },
};

// ---------------------------------------------------------------------------
// Models ("makers")

export interface Maker {
  /** The catalog model. */
  id: string;
  engine: Engine;
  modes: GenjutsuMode[];
  /** Object swap and Insert: how it is told what changes. */
  targets?: GenjutsuTarget[];
  label: string;
  /** One line for the picker: what it's good at and its limits (open: GPU and licence). */
  note: string;
  /** Runs on Higgsfield's own API (a Higgsfield key; demo mode without one). */
  higgsfield?: boolean;
  /** Genjutsu Lite or Genjutsu, and the other one. */
  tier?: GenjutsuTier;
  pair?: string;
  /** Reference images it takes (extra ones are left out, said in a note). */
  refs: { min: number; max: number };
  /** Cloud: the longest piece one call takes, in seconds. */
  maxSeconds?: number;
  minSeconds?: number;
  /** Routes that count frames: one call per window of whole frames (see remove-object's FrameWindow). */
  window?: FrameWindow;
  maxFps?: number;
  /** The result carries the piece's own sound (otherwise the clip's sound is put back). */
  keepsSound: boolean;
  /** The resolutions it renders; the quality asked for goes to the nearest (none: see `renders`). */
  qualities?: string[];
  /** Without a resolution setting: what it renders, in words ("keeps your clip's size", "renders 4K"). */
  renders?: string;
  /** Words aren't needed (Genjutsu and P-Video find what to swap from the references). */
  promptOptional?: boolean;
  /** Swaps the person on camera only. */
  people?: boolean;
  /** The fewest pixels a frame may have (Genjutsu Object Swap: 409,600). */
  minPixels?: number;
  /** Each side of the picture must be within this many pixels (Kling O3 edit: 720–3840). */
  sides?: { min: number; max: number };
  /** Restyle: the looks it takes — Higgsfield's own list, or Fuobe's presets and custom looks. */
  looks?: "higgsfield" | "fuobe";
  /** Restyle on Fuobe looks: it reads the look's reference images. */
  readsLookImages?: number;
}

/** fal's hosted Wan 2.2 VACE Fun: 17–241 frames (4n+1, the clip's own count and rate), at most 30 fps. */
const VACE_CLOUD_WINDOW: FrameWindow = { cap: 241, step: 4, base: 1, min: 17 };
const VACE_CLOUD = "wan-22-vace-inpaint";
const HIGH_RES = ["480p", "720p", "1080p"];

export const MAKERS: Maker[] = [
  // Motion transfer (cloud).
  {
    id: "genjutsu-lite-motion-transfer",
    engine: "cloud",
    modes: ["motion"],
    label: "Genjutsu Lite",
    note: "Higgsfield's own · up to 15 s a call · up to 8 references · sound kept",
    higgsfield: true,
    tier: "standard",
    pair: "genjutsu-motion-transfer",
    refs: { min: 1, max: 8 },
    maxSeconds: 15,
    minSeconds: 4,
    keepsSound: true,
    qualities: HIGH_RES,
  },
  {
    id: "genjutsu-motion-transfer",
    engine: "cloud",
    modes: ["motion"],
    label: "Genjutsu",
    note: "Higgsfield's full model · up to 30 s · up to 8 references · sound kept",
    higgsfield: true,
    tier: "high",
    pair: "genjutsu-lite-motion-transfer",
    refs: { min: 1, max: 8 },
    maxSeconds: 30,
    minSeconds: 4,
    keepsSound: true,
    qualities: HIGH_RES,
  },
  {
    id: "kling-motion-control",
    engine: "cloud",
    modes: ["motion"],
    label: "Kling 3.0 Motion Control",
    note: "No Higgsfield key needed · one character image · pieces of up to 10 s",
    refs: { min: 1, max: 1 },
    maxSeconds: 10,
    minSeconds: 3,
    keepsSound: false,
    renders: "picks its own size",
  },
  // Object swap (cloud).
  {
    id: "genjutsu-lite-object-swap",
    engine: "cloud",
    modes: ["swap"],
    targets: ["type"],
    label: "Genjutsu Lite",
    note: "Higgsfield's own · objects, characters or clothes · up to 15 s a call · words optional",
    higgsfield: true,
    tier: "standard",
    pair: "genjutsu-object-swap",
    refs: { min: 1, max: 8 },
    maxSeconds: 15,
    minSeconds: 4,
    keepsSound: true,
    qualities: HIGH_RES,
    promptOptional: true,
  },
  {
    id: "genjutsu-object-swap",
    engine: "cloud",
    modes: ["swap"],
    targets: ["type"],
    label: "Genjutsu",
    note: "Higgsfield's full model · up to 30 s · words optional",
    higgsfield: true,
    tier: "high",
    pair: "genjutsu-lite-object-swap",
    refs: { min: 1, max: 8 },
    maxSeconds: 30,
    minSeconds: 4,
    keepsSound: true,
    qualities: HIGH_RES,
    promptOptional: true,
    minPixels: 409_600,
  },
  {
    id: "kling-o3",
    engine: "cloud",
    modes: ["swap", "insert"],
    targets: ["type"],
    label: "Kling O3 Omni edit",
    note: "No Higgsfield key needed · up to 4 references as @Image · 3–15 s a piece · keeps the clip's size",
    refs: { min: 1, max: 4 },
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
    renders: "keeps your clip's size",
  },
  {
    id: "p-video-replace",
    engine: "cloud",
    modes: ["swap"],
    targets: ["type"],
    label: "P-Video Replace",
    note: "Swaps the person on camera for 1–3 photos of someone · motion, timing and scene kept",
    refs: { min: 1, max: 3 },
    keepsSound: true,
    qualities: ["720p", "1080p"],
    promptOptional: true,
    people: true,
  },
  {
    id: VACE_CLOUD,
    engine: "cloud",
    modes: ["swap", "insert"],
    targets: ["click", "paint"],
    label: "Wan 2.2 VACE (hosted)",
    note: "Changes exactly the area you mark · up to 4 references · 241 frames a piece · up to 30 fps",
    refs: { min: 1, max: 4 },
    window: VACE_CLOUD_WINDOW,
    maxFps: 30,
    keepsSound: false,
    qualities: ["480p", "580p", "720p"],
  },
  // Restyle (cloud).
  {
    id: "genjutsu-restyle",
    engine: "cloud",
    modes: ["restyle"],
    label: "Genjutsu Restyle",
    note: "Higgsfield's own looks · up to 30 s · up to 5 character references · sound kept",
    higgsfield: true,
    refs: { min: 0, max: 5 },
    maxSeconds: 30,
    minSeconds: 4,
    keepsSound: true,
    qualities: HIGH_RES,
    looks: "higgsfield",
  },
  {
    id: "gemini-omni-flash",
    engine: "cloud",
    modes: ["restyle"],
    label: "Gemini Omni Flash 1.1",
    note: "Higgsfield's Shorts engine · restyles from the look's words · pieces of up to 10 s",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    qualities: ["720p", "1080p"],
    looks: "fuobe",
  },
  {
    id: "kling-o3-4k-edit",
    engine: "cloud",
    modes: ["restyle"],
    label: "Kling O3 4K Edit",
    note: "Reads up to 4 of the look's images · 4K · pieces of up to 10 s",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    renders: "renders 4K",
    looks: "fuobe",
    readsLookImages: 4,
  },
  {
    id: "happy-horse-video-edit",
    engine: "cloud",
    modes: ["restyle"],
    label: "Happy Horse Video Edit",
    note: "Reads up to 4 of the look's images · billed on the clip's seconds too",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    qualities: ["720p", "1080p"],
    looks: "fuobe",
    readsLookImages: 4,
  },
  // Open (workflows/comfyui/manifest.json).
  {
    id: "oss-wan22-animate",
    engine: "open",
    modes: ["motion"],
    label: "Wan Animate 2",
    note: "Your character copies the clip's performance, in 81-frame fragments · one character image · 24 GB GPU · Apache-2.0",
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: ["480p", "720p"],
  },
  {
    id: "oss-vace-swap",
    engine: "open",
    modes: ["swap"],
    targets: ["type"],
    label: "Wan 2.1 VACE + SAM 3.1",
    note: "SAM 3.1 follows what you name, VACE paints your first reference in · 24 GB GPU · Apache-2.0",
    refs: { min: 1, max: 1 },
    window: VACE_WINDOW,
    keepsSound: true,
    qualities: ["480p", "720p"],
  },
  {
    id: "oss-vace-insert",
    engine: "open",
    modes: ["insert"],
    targets: ["paint"],
    label: "Wan 2.1 VACE",
    note: "Your first reference in the painted spot, held for the whole shot (a still or slow camera) · 24 GB GPU · Apache-2.0",
    refs: { min: 1, max: 1 },
    window: VACE_WINDOW,
    keepsSound: true,
    qualities: ["480p", "720p"],
  },
  {
    id: "oss-wan22-vace-restyle",
    engine: "open",
    modes: ["restyle"],
    label: "Wan 2.2 Fun VACE",
    note: "The Shorts chain: the first frame restyled (Qwen-Image-Edit, 2 of the look's images), then every frame with depth · 5 s segments at 16 fps, 480p",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    renders: "renders 480p at 16 fps",
    looks: "fuobe",
    readsLookImages: 2,
  },
];

export const getMaker = (id: string | undefined) => MAKERS.find((m) => m.id === id);

/** The models you can pick for this engine, mode and way of pointing (and, for Restyle, kind of look). */
export function makersFor(engine: Engine, mode: GenjutsuMode, target?: GenjutsuTarget, look?: GenjutsuLook): Maker[] {
  return MAKERS.filter((m) => {
    if (m.engine !== engine || !m.modes.includes(mode)) return false;
    if (MODE_TARGETS[mode].length && !(m.targets ?? []).includes(target ?? MODE_TARGETS[mode][0])) return false;
    // Genjutsu Lite and Genjutsu are one choice in the picker (Quality: Standard / High).
    if (m.tier === "high") return false;
    if (mode === "restyle" && look) return m.looks === (look.kind === "higgsfield" ? "higgsfield" : "fuobe");
    return true;
  });
}

export const OPEN_TARGET_PROBLEM: Partial<Record<GenjutsuMode, string>> = {
  swap: "On your ComfyUI, name what to swap — clicking and painting are on the cloud engine",
  insert: "On your ComfyUI, paint where it goes — saying it in words is on the cloud engine",
};

/** Restyle on the open engine with one of Higgsfield's looks (they run on Higgsfield's Genjutsu Restyle only). */
export const OPEN_LOOK_PROBLEM = "Higgsfield's looks run on the cloud engine — pick one of the 44 looks or Your own";

/**
 * The model a request runs on, or why there is none. Without a modelId: Genjutsu (Lite unless Quality is High) with a
 * Higgsfield key, else the keyless route for the mode; on the open engine, the one graph that does the mode.
 */
export function chooseMaker(o: {
  engine: Engine;
  mode: GenjutsuMode;
  target?: GenjutsuTarget;
  tier?: GenjutsuTier;
  look?: GenjutsuLook;
  modelId?: string;
  /** A Higgsfield key is set. */
  higgsfield: boolean;
}): { maker: Maker } | { problem: string } {
  const target = MODE_TARGETS[o.mode].length ? (o.target ?? MODE_TARGETS[o.mode][0]) : undefined;
  if (target && !MODE_TARGETS[o.mode].includes(target)) return { problem: `${getMode(o.mode).label} doesn't take ${target === "click" ? "clicks" : "that"} — pick another way` };
  const options = makersFor(o.engine, o.mode, target, o.look);
  if (!options.length) {
    if (o.engine === "open" && o.mode === "restyle" && o.look?.kind === "higgsfield") return { problem: OPEN_LOOK_PROBLEM };
    return { problem: (o.engine === "open" && OPEN_TARGET_PROBLEM[o.mode]) || "Nothing on this engine does that yet" };
  }
  const withTier = (m: Maker) => (m.pair && o.tier && m.tier !== o.tier ? (getMaker(m.pair) ?? m) : m);
  const picked = getMaker(o.modelId);
  if (picked) {
    // The picker lists the Lite model; a High pick (or an old setup naming the full model) is the same choice.
    const lite = picked.tier === "high" && picked.pair ? getMaker(picked.pair)! : picked;
    if (options.includes(lite)) return { maker: withTier(lite) };
  }
  const first = (o.higgsfield ? options.find((m) => m.higgsfield) : undefined) ?? options.find((m) => !m.higgsfield) ?? options[0];
  // Restyle with a custom look: a model that reads its images.
  if (o.mode === "restyle" && o.look?.kind === "custom" && o.engine === "cloud") return { maker: options.find((m) => m.readsLookImages) ?? first };
  return { maker: withTier(first) };
}

// ---------------------------------------------------------------------------
// Looks (Restyle)

export type GenjutsuLook =
  /** One of the 44 Shorts presets (Fuobe's words). */
  | { kind: "preset"; id: string }
  /** One of Higgsfield's live Genjutsu looks (its preset_id). */
  | { kind: "higgsfield"; id: string; name?: string }
  /** Your own look from up to 8 images, and words if you like. */
  | { kind: "custom"; images: string[]; words?: string };

/** The Shorts look a Fuobe look restyles with (null: Higgsfield's own, or an unknown preset). */
export function shortsLook(look: GenjutsuLook): ShortsLook | null {
  if (look.kind === "preset") {
    const p = getShortsPreset(look.id);
    return p ? lookFromPreset(p) : null;
  }
  if (look.kind !== "custom") return null;
  const words = look.words?.trim().replace(/[.\s]+$/, "");
  return {
    presetId: "genjutsu-custom",
    name: "Your look",
    look: words ? `the look of the reference images: ${words}` : "the look of the reference images: their colours, textures, lighting and graphic style",
    references: look.images.slice(0, GENJUTSU.maxLookImages),
    custom: true,
    described: !!words,
  };
}

export function lookName(look: GenjutsuLook | undefined): string {
  if (!look) return "a look";
  if (look.kind === "preset") return getShortsPreset(look.id)?.name ?? "a look";
  if (look.kind === "higgsfield") return look.name || "a Higgsfield look";
  return "your look";
}

// ---------------------------------------------------------------------------
// Prices

/**
 * Per-second list prices the catalog doesn't carry per resolution: Higgsfield's Genjutsu tiers (billed on whole
 * seconds; higgsfield-api.json, 50% off on 2026-10-22 and not counted here) and Kling O3's video edit ($0.168/s,
 * paid-model-apis-4.md §4; the catalog's Kling O3 price is its text-to-video one).
 */
export const MAKER_USD: Record<string, Record<string, number>> = {
  "genjutsu-motion-transfer": { "480p": 0.318, "720p": 0.681, "1080p": 1.632 },
  "genjutsu-object-swap": { "480p": 0.318, "720p": 0.681, "1080p": 1.632 },
  "genjutsu-restyle": { "480p": 0.318, "720p": 0.681, "1080p": 1.632 },
  "genjutsu-lite-motion-transfer": { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  "genjutsu-lite-object-swap": { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  "kling-o3": { any: 0.168 },
};

/** A step's own price when MAKER_USD has it (null: the catalog's price applies). */
export function makerStepUsd(modelId: string, params: { duration?: number; resolution?: string } | undefined): number | null {
  const table = MAKER_USD[modelId];
  if (!table) return null;
  const usd = table[params?.resolution ?? ""] ?? table.any ?? table["720p"];
  const secs = params?.duration ?? 0;
  // Higgsfield rounds each call up to whole seconds.
  return usd * (modelId.startsWith("genjutsu") ? Math.ceil(secs - 1e-6) : secs);
}

const px = (q: string) => parseInt(q, 10) || 0;

/** The resolution a model is asked for: the quality picked, or the nearest it renders (the largest not above, else its smallest). */
export function qualityFor(m: Maker, quality: string): string | undefined {
  if (!m.qualities?.length) return undefined;
  if (m.qualities.includes(quality)) return quality;
  const below = m.qualities.filter((q) => px(q) <= px(quality)).sort((a, b) => px(b) - px(a));
  return below[0] ?? [...m.qualities].sort((a, b) => px(a) - px(b))[0];
}

/**
 * What comes out when it isn't the quality picked, in words (undefined: it is): "renders 720p (its lowest)" when the
 * model starts above it, "renders up to 720p" when it stops below it, or the model's own words without a setting.
 */
export function resolutionWords(m: Maker, quality: string): string | undefined {
  const res = qualityFor(m, quality);
  if (!res) return m.renders ?? "keeps your clip's size";
  if (res === quality) return undefined;
  return px(res) > px(quality) ? `renders ${res} (its lowest)` : `renders up to ${res}`;
}

// ---------------------------------------------------------------------------
// Words

const tidy = (s: string | undefined) => (s ?? "").trim().replace(/[.\s]+$/, "");
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const imageTags = (n: number) => Array.from({ length: n }, (_, i) => `@Image${i + 1}`).join(", ");

const SWAP = /^\s*(?:please\s+)?(?:replace|swap(?:\s+out)?|change|turn|exchange|substitute)\s+(.+?)\s+(?:with|for|into|by|to)\s+(.+)$/i;

/** "Replace the red car with a horse" → what goes ("the red car") and what comes in ("a horse"); a bare name is what goes. */
export function swapParts(text: string): { what: string; into?: string } {
  const m = SWAP.exec(text.trim());
  return m ? { what: tidy(m[1]), into: tidy(m[2]) } : { what: tidy(text) };
}

/**
 * What a sentence says to swap, for SAM 3.1 to track on the open engine: "Replace the red car with a horse" → "the red
 * car"; a bare name stays as it is (as remove-object's targetPhrase: the objects alone, comma-separated).
 */
export function swapTarget(text: string): string {
  return targetPhrase(swapParts(text).what);
}

export interface PromptInput {
  mode: GenjutsuMode;
  maker: Maker;
  /** Object swap: what goes. */
  subject?: string;
  /** Guidance: the result (swap), where it goes (insert), the character (motion), extra words (restyle). */
  prompt?: string;
  refs: number;
}

/** Each model's words for the request (undefined: none needed). */
export function makerPrompt(p: PromptInput): string | undefined {
  const m = p.maker;
  const words = tidy(p.prompt);
  const { what, into } = swapParts(p.subject ?? "");
  const also = into ? ` (${into})` : "";
  if (m.id === "kling-o3") {
    const refs = imageTags(Math.max(1, p.refs));
    if (p.mode === "insert") return `Add ${refs} to @Video1${words ? `: ${words}` : ""}. Keep everything else the same: the motion, camera, framing and light.`;
    return `Replace ${what || "the main subject"} in @Video1 with ${refs}${also}${words ? `. ${cap(words)}` : ""}. Keep everything else the same: the motion, camera, framing and light.`;
  }
  if (m.id === VACE_CLOUD || m.id === "oss-vace-swap" || m.id === "oss-vace-insert") {
    // VACE's prompt describes the result; the mask (or SAM's track) says where.
    if (words) return `${cap(words)}, matching the light, perspective and motion of the shot.`;
    if (p.mode === "insert") return "The object from the reference image in the marked area, matching the light, perspective and motion of the shot.";
    if (into) return `${cap(into)} in place of ${what}, matching the light, perspective and motion of the shot.`;
    return `${what ? `${cap(what)} replaced by` : "The marked area becomes"} the object from the reference image, matching the light, perspective and motion of the shot.`;
  }
  if (p.mode === "swap") {
    const lead = what ? `Replace ${what} with the reference${p.refs > 1 ? "s" : ""}${also}.` : "";
    const out = [lead, words ? `${cap(words)}.` : ""].filter(Boolean).join(" ");
    return out || undefined;
  }
  if (p.mode === "restyle" && m.looks === "higgsfield") return words ? `${cap(words)}.` : "Keep the motion, camera and framing exactly as filmed.";
  return words ? `${cap(words)}.` : undefined;
}

/** A short name for the result ("Genjutsu · Motion transfer"). */
export function genjutsuTitle(o: { mode: GenjutsuMode; subject?: string; look?: GenjutsuLook }): string {
  if (o.mode === "restyle") return `Genjutsu · ${lookName(o.look)}`;
  const s = tidy(o.subject);
  if (o.mode === "swap" && s) return `Genjutsu · swap ${s.length > 48 ? `${s.slice(0, 45)}…` : s}`;
  return `Genjutsu · ${getMode(o.mode).label.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Checks

export interface GenjutsuCheck {
  mode: GenjutsuMode;
  maker: Maker;
  source: RemoveSource;
  range: RemoveRange;
  references: number;
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  points?: number;
  mask?: boolean;
  look?: GenjutsuLook;
}

/** What's wrong with the selection whatever the model, or null. */
export function rangeProblem(source: Pick<RemoveSource, "duration">, range: RemoveRange): string | null {
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (source.duration !== undefined && range.end > source.duration + 0.05) return "The selection runs past the end of the clip";
  if (len < GENJUTSU.minSeconds - 0.05) return `Choose a part between ${GENJUTSU.minSeconds} and ${GENJUTSU.maxSeconds} seconds (this is ${len.toFixed(1)} s)`;
  if (len > GENJUTSU.maxSeconds + 0.05) return `Choose up to ${GENJUTSU.maxSeconds} seconds — trim the clip with the handles`;
  return null;
}

const REFS_MISSING: Record<GenjutsuMode, string> = {
  motion: "Add a picture of your character",
  swap: "Add a picture of what goes in",
  insert: "Add a picture of what to add",
  restyle: "",
};

/** The first thing that stops this request, in words, or null. */
export function genjutsuProblem(c: GenjutsuCheck): string | null {
  const general = rangeProblem(c.source, c.range);
  if (general) return general;
  const m = c.maker;
  const len = c.range.end - c.range.start;
  const { width: w, height: h } = c.source;
  const target = MODE_TARGETS[c.mode].length ? (c.target ?? MODE_TARGETS[c.mode][0]) : undefined;
  if (m.minSeconds && len < m.minSeconds - 0.01) return `${m.label} needs at least ${m.minSeconds} s`;
  if (m.sides && w && h) {
    if (Math.min(w, h) < m.sides.min) return `${m.label} needs a clip at least ${m.sides.min} px on each side (this one is ${w}×${h}) — pick another model`;
    if (Math.max(w, h) > m.sides.max) return `${m.label} takes clips up to ${m.sides.max} px on a side (this one is ${w}×${h})`;
  }
  if (m.minPixels && w && h && w * h < m.minPixels) return `${m.label} needs a sharper clip (at least ${Math.round(m.minPixels / 1000)} thousand pixels a frame; this one is ${w}×${h}) — Genjutsu Lite takes it`;
  if (m.window && !c.source.fps) return "Couldn't read this clip's frame rate — save it as an MP4 (H.264) and try again";
  if (m.maxFps && c.source.fps && c.source.fps > m.maxFps + 0.01) {
    // The hosted VACE is the only model for clicks and paint: the way out is words (or a slower copy of the clip).
    const others = makersFor(m.engine, c.mode, target).filter((x) => x.id !== m.id);
    const words = TARGET_LABELS[c.mode].type?.label;
    const way = others.length ? "pick another model" : words && target !== "type" ? `switch to “${words}”, or save the clip at ${m.maxFps} fps and add it again` : `save the clip at ${m.maxFps} fps and add it again`;
    return `${m.label} takes up to ${m.maxFps} fps (this clip is ${Math.round(c.source.fps)} fps) — ${way}`;
  }
  if (c.mode !== "restyle" && c.references < Math.max(1, m.refs.min)) return REFS_MISSING[c.mode];
  if (c.mode === "restyle") {
    if (!c.look) return "Pick a look";
    if (c.look.kind === "custom" && !c.look.images.length) return "Add up to 8 images for your look";
    if (m.looks === "higgsfield" && c.look.kind !== "higgsfield") return "Genjutsu Restyle takes Higgsfield's looks — pick one of them";
    if (m.looks === "fuobe" && c.look.kind === "higgsfield") return "Higgsfield's looks run on Genjutsu Restyle";
    if (c.look.kind === "custom" && !m.readsLookImages && !c.look.words?.trim()) return `${m.label} restyles from words only — describe your look, or pick Kling O3 4K Edit`;
  }
  if (target === "type") {
    if (c.mode === "swap" && !m.promptOptional && !c.subject?.trim()) return "Say what to swap, e.g. “the red car”";
    if (c.mode === "insert" && !c.prompt?.trim()) return "Say where it goes, e.g. “on the table, next to the cup”";
  }
  if (target === "click" && !c.points) return "Click what to swap on the first frame";
  if (target === "paint" && !c.mask) return c.mode === "insert" ? "Paint where it goes on the first frame" : "Paint over what to swap";
  return null;
}

// ---------------------------------------------------------------------------
// Pieces

/** The pieces a selection is made in: windows on the open engine, frame cuts or equal cuts on the cloud, or one. */
export function planMakerPieces(m: Maker, source: RemoveSource, range: RemoveRange): Piece[] {
  if (m.window) {
    if (!source.fps) return [];
    return m.engine === "open" ? planWindows(range, source.fps, m.window) : planFrameCuts(range, source.fps, m.window);
  }
  if (m.maxSeconds) return planCloudPieces(range, m.maxSeconds, source.fps);
  return [{ index: 0, start: range.start, end: range.end }];
}

// ---------------------------------------------------------------------------
// The pipeline

export interface GenjutsuPlanInput {
  engine: Engine;
  mode: GenjutsuMode;
  maker: Maker;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  quality: string;
  /** Reference images (the model takes its first refs.max). */
  references: string[];
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  /** Click it: points on the range's first frame, in the clip's pixels (paint on the cloud: points found in the paint). */
  points?: PixelPoint[];
  /** Paint it: the mask of the range's first frame (white = what changes, or where it goes). */
  mask?: string;
  look?: GenjutsuLook;
  seed?: number;
}

export interface GenjutsuPlan {
  steps: PlanStep[];
  /** The finished video's step. */
  final: string;
  /** Pieces (cloud), windows (open) or segments (Restyle on Fuobe looks). */
  pieces: number;
  /** The clip's own sound is put back on the joined result. */
  sound: boolean;
  /** Cloud clicks and paint: SAM 3.1 follows the object through the selection first. */
  tracked: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pieceLabel = (p: Piece, n: number, what: string) => ({ label: n > 1 ? `Piece ${p.index + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: p.index, of: n });

const OP: Record<GenjutsuMode, GenerationRequest["op"]> = { motion: "motion-transfer", swap: "video-swap", insert: "video-insert", restyle: "v2v" };

/**
 * The whole job, as steps for createPipeline (src/server/chains.ts):
 * - Restyle on Fuobe looks: the Shorts chain (segments restyled, joined, the sound put back) in the clip's own shape;
 * - open VACE swap / insert: one window per job straight from the upload (the graph reads its own window), the
 *   painted spot the same in every window; Wan Animate 2: the selection in one job (it loops its own fragments);
 * - cloud: the selection cut into pieces, each made with the references; marked areas for the hosted VACE come from
 *   the paint (one piece) or SAM 3.1's track of it (clicks, or paint over several pieces: each piece's first frame);
 * - then the pieces joined and the clip's own sound put back.
 */
export function planGenjutsu(input: GenjutsuPlanInput): GenjutsuPlan {
  if (input.mode === "restyle" && input.maker.looks === "fuobe") return planFuobeRestyle(input);
  const m = input.maker;
  const t = REMOVE_TOOLS[m.engine];
  const pieces = planMakerPieces(m, input.source, input.range);
  if (!pieces.length) throw new Error(genjutsuProblem({ ...input, references: input.references.length, points: input.points?.length, mask: !!input.mask }) ?? "Select a little more of the clip");
  const n = pieces.length;
  const whole = wholeClip(input.range, input.source.duration);
  const base = { feature: GENJUTSU.feature, batchTitle: input.title };
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const steps: PlanStep[] = [];
  const op = OP[input.mode];
  const sound = !!input.source.hasAudio && (n > 1 || !m.keepsSound);
  const own = (one: boolean) => (one && !sound ? { ...base, title: input.title } : helper);
  const refs = input.references.slice(0, m.refs.max);
  const images = refs.length ? { images: refs } : {};
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const resolution = qualityFor(m, input.quality);
  const prompt = makerPrompt({ mode: input.mode, maker: m, subject: input.subject, prompt: input.prompt, refs: refs.length });
  const words = prompt ? { prompt } : {};
  const target = MODE_TARGETS[input.mode].length ? (input.target ?? MODE_TARGETS[input.mode][0]) : undefined;
  const lookParams = input.mode === "restyle" && input.look?.kind === "higgsfield" ? { extra: { preset_id: input.look.id } } : {};
  const keys = pieces.map((_, i) => `make${i}`);

  if (m.engine === "open" && m.window) {
    // VACE windows: the graph reads [startTime, endTime) of the upload itself.
    pieces.forEach((p, i) => {
      steps.push({
        key: keys[i],
        request: {
          ...own(n === 1),
          modelId: m.id,
          op,
          ...words,
          inputs: { video: input.source.url, ...images, ...(input.mask ? { mask: input.mask } : {}) },
          params: {
            startTime: p.startTime,
            endTime: p.endTime,
            aspectRatio: "auto",
            ...(resolution ? { resolution } : {}),
            ...seed,
            ...(input.mode === "swap" && input.subject?.trim() ? { extra: { maskPrompt: swapTarget(input.subject) } } : {}),
          },
          step: pieceLabel(p, n, input.mode === "insert" ? "add it" : "swap it"),
        },
      });
    });
  } else if (m.engine === "open") {
    // Wan Animate 2 runs the whole selection (its graph loops 81-frame fragments) and keeps the clip's fps and sound.
    const cut = !whole;
    if (cut) steps.push({ key: "cut0", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    steps.push({
      key: keys[0],
      request: {
        ...own(true),
        modelId: m.id,
        op,
        ...words,
        inputs: { ...(cut ? {} : { video: input.source.url }), ...images },
        params: { aspectRatio: "auto", ...(resolution ? { resolution } : {}), ...seed },
        step: { label: "Transfer the motion", index: 0, of: 1 },
      },
      ...(cut ? { after: ["cut0"], chain: [{ slot: "video" as const }] } : {}),
    });
  } else {
    // Cloud. The hosted VACE reads a still mask of its piece's first frame and tracks it: the paint for one piece,
    // else SAM 3.1's track of the clicks or the paint, cut like the clip, its first frame for each piece.
    const tracked = m.id === VACE_CLOUD && input.mode === "swap" && (target === "click" || n > 1);
    const cutRange = tracked && !whole;
    if (cutRange) {
      steps.push({ key: "range", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    }
    if (tracked) {
      steps.push({
        key: "track",
        request: {
          ...helper,
          modelId: MASK_TRACKER,
          op: "bg-remove-video",
          ...(cutRange ? {} : { inputs: { video: input.source.url } }),
          params: { points: input.points, duration: r3(input.range.end - input.range.start) },
          step: { label: "Follow what you marked (SAM 3.1)", index: 0, of: 1 },
        },
        ...(cutRange ? { after: ["range"], chain: [{ slot: "video" as const }] } : {}),
      });
    }
    pieces.forEach((p, i) => {
      // One piece that is the whole upload is read as it is (a frame-count piece only when it is every frame).
      const one = n === 1 && whole && (!p.frames || p.end >= (input.source.duration ?? 0) - 0.05);
      const after: string[] = [];
      const chain: ChainSlot[] = [];
      if (n === 1 && cutRange) {
        after.push("range");
        chain.push({ slot: "video" });
      } else if (!one) {
        steps.push({ key: `cut${i}`, request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: pieceLabel(p, n, "cut") } });
        after.push(`cut${i}`);
        chain.push({ slot: "video" });
      }
      let mask: string | undefined;
      if (m.id === VACE_CLOUD) {
        // Insert holds the painted spot in every piece; a swap's paint marks the first piece only.
        if (input.mode === "insert" || (!tracked && input.mask)) mask = input.mask;
        else if (i === 0 && target === "paint" && input.mask) mask = input.mask;
        else {
          let from = "track";
          if (n > 1) {
            const at = { startTime: r3(p.start - input.range.start), endTime: r3(p.end - input.range.start) };
            steps.push({ key: `mcut${i}`, request: { ...helper, modelId: t.cut, op: "trim", params: at, step: pieceLabel(p, n, "cut the mask") }, after: ["track"], chain: [{ slot: "video" }] });
            from = `mcut${i}`;
          }
          steps.push({ key: `mframe${i}`, request: { ...helper, modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } }, step: pieceLabel(p, n, "mask's first frame") }, after: [from], chain: [{ slot: "video" }] });
          after.push(`mframe${i}`);
          chain.push({ slot: "mask" });
        }
      }
      // What per-second prices count: the piece's seconds (VACE bills video seconds at 16 fps: frames ÷ 16).
      const secs = m.window && p.frames ? r6(p.frames / 16) : r3(p.end - p.start);
      steps.push({
        key: keys[i],
        request: {
          ...own(n === 1),
          modelId: m.id,
          op,
          ...words,
          inputs: { ...(one ? { video: input.source.url } : {}), ...images, ...(mask ? { mask } : {}) },
          params: { duration: secs, sourceDuration: r3(p.end - p.start), ...(resolution ? { resolution } : {}), ...(m.window ? { aspectRatio: "auto" } : {}), ...(input.source.fps ? { fps: input.source.fps } : {}), ...lookParams, ...seed },
          step: pieceLabel(p, n, input.mode === "motion" ? "transfer the motion" : input.mode === "insert" ? "add it" : input.mode === "restyle" ? "restyle" : "swap it"),
        },
        ...(after.length ? { after, chain } : {}),
      });
    });
    const end = m.window ? pieces[n - 1].end : input.range.end;
    const final = n === 1 && !sound ? keys[0] : joinWithSound(steps, { engine: m.engine, title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound, end });
    return { steps, final, pieces: n, sound, tracked };
  }
  const final = n === 1 && !sound ? keys[0] : joinWithSound(steps, { engine: m.engine, title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound });
  return { steps, final, pieces: n, sound, tracked: false };
}

/** Restyle on a Fuobe look: the Shorts chain in the clip's own shape, under Genjutsu's features. */
function planFuobeRestyle(input: GenjutsuPlanInput): GenjutsuPlan {
  const look = input.look && shortsLook(input.look);
  if (!look) throw new Error("Pick a look");
  const m = input.maker;
  const plan = planShorts({
    engine: m.engine,
    title: input.title,
    source: { url: input.source.url, duration: input.source.duration, hasAudio: input.source.hasAudio, width: input.source.width, height: input.source.height },
    range: input.range,
    look,
    aspectRatio: (input.source.width ?? 16) >= (input.source.height ?? 9) ? "16:9" : "9:16",
    keepShape: true,
    language: "auto",
    modelId: m.id,
    maxRefs: m.readsLookImages ?? 0,
    ...(qualityFor(m, input.quality) ? { resolution: qualityFor(m, input.quality) } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });
  // Only the finished video is a result; the segments are steps (Shorts keeps each take as a result of its own).
  const final = plan.final ?? plan.takes[0].look;
  const steps = plan.steps.map((s) => ({
    ...s,
    request: s.key === final ? { ...s.request, feature: GENJUTSU.feature, title: input.title } : { ...s.request, feature: GENJUTSU.stepFeature },
  }));
  return { steps, final, pieces: plan.segments.length, sound: !!input.source.hasAudio, tracked: false };
}

// ---------------------------------------------------------------------------
// Setup codes ("share by code", done locally: the settings as base64url JSON)

export interface GenjutsuSetup {
  mode: GenjutsuMode;
  engine?: Engine;
  model?: string;
  tier?: GenjutsuTier;
  quality?: GenjutsuQuality;
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  look?: GenjutsuLook;
  /** Reference images (files in this install's library). */
  references?: string[];
}

const MODES = new Set<string>(GENJUTSU_MODES.map((m) => m.id));
const FILE = /^\/api\/files\/[\w./-]{1,200}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const files = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && FILE.test(x)).slice(0, max) : []);

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A setup as a short code ("gj1." + base64url JSON with short keys; empty fields left out). */
export function encodeSetup(s: GenjutsuSetup): string {
  const look = s.look && (s.look.kind === "custom" ? { k: "c", i: s.look.images, w: s.look.words || undefined } : { k: s.look.kind === "preset" ? "p" : "h", id: s.look.id, n: s.look.kind === "higgsfield" ? s.look.name : undefined });
  const o = { m: s.mode, e: s.engine, x: s.model, t: s.tier, q: s.quality, g: s.target, s: s.subject?.trim() || undefined, p: s.prompt?.trim() || undefined, l: look, r: s.references?.length ? s.references : undefined };
  return `gj1.${toBase64Url(JSON.stringify(o))}`;
}

/** A setup read back from a code (or a link with ?setup=…), checked field by field; null when it isn't one. */
export function decodeSetup(input: string): GenjutsuSetup | null {
  let o: Record<string, unknown>;
  try {
    let code = input.trim();
    // A link: its ?setup= (a malformed %-escape is not a code either).
    const fromLink = /[?&]setup=([^&#\s]+)/.exec(code);
    if (fromLink) code = decodeURIComponent(fromLink[1]);
    if (!code.startsWith("gj1.")) return null;
    o = JSON.parse(fromBase64Url(code.slice(4).replace(/\s+/g, ""))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || typeof o.m !== "string" || !MODES.has(o.m)) return null;
  const mode = o.m as GenjutsuMode;
  const out: GenjutsuSetup = { mode };
  if (o.e === "cloud" || o.e === "open") out.engine = o.e;
  const model = str(o.x, 80);
  if (model && getMaker(model)) out.model = model;
  if (o.t === "standard" || o.t === "high") out.tier = o.t;
  if (typeof o.q === "string" && (GENJUTSU.qualities as string[]).includes(o.q)) out.quality = o.q as GenjutsuQuality;
  if (typeof o.g === "string" && MODE_TARGETS[mode].includes(o.g as GenjutsuTarget)) out.target = o.g as GenjutsuTarget;
  const subject = str(o.s, 300);
  if (subject) out.subject = subject;
  const prompt = str(o.p, GENJUTSU.maxPromptChars);
  if (prompt) out.prompt = prompt;
  const l = o.l as Record<string, unknown> | undefined;
  if (mode === "restyle" && l && typeof l === "object") {
    if (l.k === "p" && typeof l.id === "string" && getShortsPreset(l.id)) out.look = { kind: "preset", id: l.id };
    else if (l.k === "h" && typeof l.id === "string" && /^[\w-]{1,64}$/.test(l.id)) out.look = { kind: "higgsfield", id: l.id, ...(str(l.n, 80) ? { name: str(l.n, 80) } : {}) };
    else if (l.k === "c") {
      const images = files(l.i, GENJUTSU.maxLookImages);
      if (images.length) out.look = { kind: "custom", images, ...(str(l.w, 300) ? { words: str(l.w, 300) } : {}) };
    }
  }
  const refs = files(o.r, GENJUTSU.maxReferences);
  if (refs.length) out.references = refs;
  return out;
}
