/**
 * Genjutsu's Character swap (Openjutsu and Akatz Labs' H3 Character Swap tool, docs/research/openjutsu-6.md): the person
 * in a 5–15 s part of a clip becomes the character in one image, keeping the performance, the scene and the clip's own
 * sound. On your GPU it is MiniMax H3 with Akatz Labs' Character Swap LoRA on the h3_character_swap node pack (SAM 3.1
 * finds the person on the part's first frame and H3 regenerates only them, in 124-frame windows with 18 frames of
 * history); in the cloud it is fal's MiniMax H3 reference-to-video with the same LoRA (no mask: who to swap is said in
 * words). An optional "anchor" first frame (the part's first frame with the character already in it, made by an image
 * edit) starts the swap off right; when it can't be made the swap runs without it.
 *
 * Pure module: limits, prompts, the H3 window plan, who to swap, the anchor's prompt and models, licences as data.
 * The prompts follow Openjutsu's (MIT, Comfy Org 2026) and Akatz Labs' anchor brief (MIT, Akatz Labs 2026).
 */
import type { Engine, LoraRef, PixelPoint } from "./types";

export const CHARACTER_SWAP = {
  /** One H3 call: Openjutsu's part picker (Start 0 … duration − 5 s, Length 5 … 15 s). */
  minSeconds: 5,
  maxSeconds: 15,
  /** Longer parts continue window by window (your GPU) or run as 15 s pieces joined with the sound (cloud). */
  maxContinued: 30,
  /** "Choose a clip at least 5 seconds long." Genjutsu's own upload limit (Openjutsu's is 100 MB). */
  maxBytes: 200 * 1024 * 1024,
  maxDirectionChars: 500,
  maxDescriptionChars: 500,
  /** Seeds Openjutsu takes (uint32); blank is random. */
  maxSeed: 2 ** 32 - 1,
  qualities: ["480p", "768p"] as const,
  defaultQuality: "768p" as const,
  /** H3's frame rate: every part is normalised to 24 fps before it is swapped. */
  fps: 24,
  window: 124,
  history: 18,
  /** H3's documented range ends near 362 frames (15 s): past it the pack prints "Long clip: beyond … trained range". */
  trainedFrames: 362,
  maskGrow: 64,
  maxPeople: 8,
  accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
} as const;

export type CharacterQuality = (typeof CHARACTER_SWAP.qualities)[number];

/** Who to swap when several people are on screen (the pack's SelectSubject). */
export type SwapWho = "largest" | "leftmost" | "rightmost" | "index";
/** Akatz Labs' speaker choice for the performance prompt. */
export type SwapSpeech = "character" | "other" | "offscreen" | "none";
/** Character Swap LoRA releases: V1.5 (Akatz's recommended release), V1, or none (H3 with the Turbo LoRA only). */
export type SwapLora = "v1.5" | "v1" | "none";

export const WHO_LABELS: Record<SwapWho, string> = { largest: "Largest", leftmost: "Leftmost", rightmost: "Rightmost", index: "Person #" };
export const SPEECH_LABELS: Record<SwapSpeech, { label: string; hint: string }> = {
  character: { label: "My character speaks", hint: "Lips follow the clip's own voice" },
  other: { label: "Someone else speaks", hint: "The character listens" },
  offscreen: { label: "Offscreen voice", hint: "The voice isn't anyone on screen" },
  none: { label: "No dialogue", hint: "Nobody speaks in this part" },
};

/** The Character Swap LoRA files (Hugging Face akatz-ai/MiniMax-H3-Character-Swap-LoRA at the researched revisions). */
export const SWAP_LORAS: Record<Exclude<SwapLora, "none">, { label: string; file: string; url: string; bytes: number }> = {
  "v1.5": {
    label: "V1.5 (recommended)",
    file: "h3_character_swap_v1.5.safetensors",
    url: "https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/d06323b7c8e70e97cdab48b78a1e05f786c8cba9/h3_character_swap_v1.5.safetensors",
    bytes: 155_110_792,
  },
  v1: {
    label: "V1",
    file: "h3_character_swap_pro4500_1000.safetensors",
    url: "https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/a665bb7e3bb9804e487d2925f67744f554c8ad49/h3_character_swap_pro4500_1000.safetensors",
    bytes: 155_110_320,
  },
};

const H3_LORA_LICENCE = { commercial: true, hostedOk: true, snapshotDate: "2026-10-27", name: "MiniMax H3 Community License" };

/** The swap LoRA a run carries (fal loads it by its pinned Hugging Face URL; ComfyUI gets the file downloaded). */
export function swapLoraRef(lora: SwapLora | undefined): LoraRef {
  const l = SWAP_LORAS[lora === "v1" ? "v1" : "v1.5"];
  return { file: l.file, url: l.url, weightName: l.file, strength: 1, version: l.url.split("/resolve/")[1]?.split("/")[0], licence: H3_LORA_LICENCE };
}

/** lightx2v's FL2V Turbo 8-step LoRA the open graphs load (Apache-2.0 at this revision). */
export const TURBO_LORA: LoraRef = {
  file: "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
  url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
  version: "3ec17a324ced54151364f24f8b5fb6bf7e26414f",
  licence: { commercial: true, hostedOk: true, snapshotDate: "2026-10-27", name: "Apache-2.0" },
};

/** The ComfyUI workflows of the Character swap. */
export const H3_WORKFLOWS = ["video-character-swap-h3", "video-character-swap-h3-relay"] as const;

/**
 * The LoRA files a Character swap graph loads itself (not injected: its own loaders name them), so a run can download
 * the ones ComfyUI lacks before it starts: the Turbo LoRA and the swap LoRA's release (none: only Turbo).
 */
export function graphLoras(endpoint: string, extra: Record<string, unknown> | undefined): LoraRef[] {
  if (!(H3_WORKFLOWS as readonly string[]).includes(endpoint)) return [];
  const lora = extra?.lora;
  return lora === "none" ? [TURBO_LORA] : [TURBO_LORA, swapLoraRef(lora === "v1" ? "v1" : "v1.5")];
}

/** The settings of one swap (the body's `character`, all optional: the defaults are Openjutsu's and Akatz's). */
export interface CharacterOptions {
  who?: SwapWho;
  /** Person #n, from 0 (the pack's index). */
  index?: number;
  /** What SAM 3.1 looks for ("person"; "the man in the red jacket" picks among several). */
  subject?: string;
  /** Pixels the person's mask grows by (0–256). */
  maskGrow?: number;
  /** The anchor first frame (on by default). */
  anchor?: boolean;
  /** The image model that makes it (the engine's choice by default, ANCHOR_MODELS). */
  anchorModel?: string;
  /** What the character looks like, in words (Akatz found generic prompts weak). */
  description?: string;
  speech?: SwapSpeech;
  /** The part's words (a transcript), for the performance prompt. */
  dialogue?: string;
  lora?: SwapLora;
  /** H3's audio guide: the clip's own sound conditions the performance (the result keeps the sound either way). */
  audioGuide?: boolean;
  /** Masked regeneration (off: the whole frame is regenerated). */
  useMask?: boolean;
  /** Advanced: H3's window and continuation history (frames). */
  windowFrames?: number;
  historyFrames?: number;
}

// ---------------------------------------------------------------------------
// Quality, sizes and windows

/** Genjutsu's qualities to H3's two: 480p stays, anything higher is 768p (H3's native top). */
export function characterQuality(q: string | undefined): CharacterQuality {
  return q === "480p" ? "480p" : "768p";
}

/** What the unpatched h3_character_swap pack's PrepareVideo takes: the strings "480" / "768" (the patched one: integers). */
export const packResolution = (q: string | undefined, patched = false): string | number => {
  const v = characterQuality(q) === "480p" ? "480" : "768";
  return patched ? Number(v) : v;
};

/** fal's H3 resolution enum for a quality. */
export const falResolution = (q: string | undefined) => (characterQuality(q) === "480p" ? "480P" : "768P");

/** H3's frame grid: the first count of the form 17n + 5 at or above n (ComfyUI's align_frame_count). */
export function alignFrames(n: number): number {
  let f = Math.max(5, Math.ceil(n));
  while (f % 17 !== 5) f++;
  return f;
}

/** Frames of a part at H3's 24 fps. */
export const partFrames = (seconds: number) => Math.max(1, Math.round(seconds * CHARACTER_SWAP.fps));

/**
 * How many diffusion windows a part takes (the pack plans source-aligned windows over the part padded to H3's grid):
 * 5 s → 1, 7.5 s and 10 s → 2, 12.5 s and 15 s → 3 (docs/research/openjutsu-6.md §3.4).
 */
export function h3Windows(seconds: number, windowFrames: number = CHARACTER_SWAP.window): number {
  return Math.max(1, Math.ceil(alignFrames(partFrames(seconds)) / Math.max(22, windowFrames)));
}

/** Window sizes the pack takes (17n + 5, 22 … 362) and continuation history (0, 1 or 17n + 1, 18 … 341). */
export const WINDOW_CHOICES = Array.from({ length: 21 }, (_, i) => 22 + 17 * i);
export const HISTORY_CHOICES = [0, 1, ...Array.from({ length: 20 }, (_, i) => 18 + 17 * i)];

const nearest = (xs: number[], v: number) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
export const windowFrames = (v: number | undefined) => String(nearest(WINDOW_CHOICES, v ?? CHARACTER_SWAP.window));
export const historyFrames = (v: number | undefined) => String(nearest(HISTORY_CHOICES, v ?? CHARACTER_SWAP.history));

/**
 * The size H3 works at for a clip: the short edge at 768 (or 480) px, the area capped at 768 × 1344 (480 × 840), each side
 * rounded to 32 (ComfyUI's adapt_canvas). Clicks on the first frame are moved into these pixels. For 480p the pack's own
 * rule isn't published: this scales ComfyUI's 768 rule, so clicks there are an estimate.
 */
export function h3Canvas(width: number, height: number, quality: string | undefined): { width: number; height: number } {
  const short = characterQuality(quality) === "480p" ? 480 : 768;
  const maxArea = short * Math.round((short * 1344) / 768);
  const ratio = width / height;
  let [w, h] = ratio >= 1 ? [short * ratio, short] : [short, short / ratio];
  if (w * h > maxArea) {
    const s = Math.sqrt(maxArea / (w * h));
    w *= s;
    h *= s;
  }
  const r32 = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  return { width: r32(w), height: r32(h) };
}

/** Clicks in the clip's pixels → SAM3_Detect's JSON points in H3's canvas: [positive, negative] ("" when none). */
export function samCoords(points: PixelPoint[] | undefined, clip: { width: number; height: number }, quality: string | undefined): [string, string] {
  if (!points?.length || !clip.width || !clip.height) return ["", ""];
  const c = h3Canvas(clip.width, clip.height, quality);
  const at = (p: PixelPoint) => ({ x: Math.round((p.x / clip.width) * c.width), y: Math.round((p.y / clip.height) * c.height) });
  const pos = points.filter((p) => p.label !== "negative").map(at);
  const neg = points.filter((p) => p.label === "negative").map(at);
  return [pos.length ? JSON.stringify(pos) : "", neg.length ? JSON.stringify(neg) : ""];
}

// ---------------------------------------------------------------------------
// Words

const tidy = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

/** Who to swap, in words (the cloud has no mask; the open graph's prompt keeps "the selected person"). */
export function whoWords(o: Pick<CharacterOptions, "who" | "index" | "subject">): string {
  const subject = tidy(o.subject);
  if (subject && subject.toLowerCase() !== "person") return /^(the|a|an)\s/i.test(subject) ? subject : `the ${subject}`;
  switch (o.who ?? "largest") {
    case "leftmost":
      return "the person on the left";
    case "rightmost":
      return "the person on the right";
    case "index":
      return `the ${ORDINALS[Math.max(0, Math.min(ORDINALS.length - 1, o.index ?? 0))]} person from the left`;
    default:
      return "the main person";
  }
}

/** One line for who speaks (Akatz Labs' speaker choice), with the part's words when there are some. */
export function speechLine(speech: SwapSpeech | undefined, dialogue?: string): string {
  const words = tidy(dialogue).slice(0, 600);
  const said = words ? ` The words: "${words}".` : "";
  switch (speech) {
    case "character":
      return `The character speaks the clip's lines, lips in sync with its audio.${said}`;
    case "other":
      return `Someone else speaks; the character listens and does not talk.${said}`;
    case "offscreen":
      return `The voice comes from off screen; the character does not speak.${said}`;
    case "none":
      return "Nobody speaks in this part.";
    default:
      return "";
  }
}

export interface SwapPromptInput extends Pick<CharacterOptions, "who" | "index" | "subject" | "description" | "speech" | "dialogue"> {
  engine: Engine;
  /** The anchor first frame goes along (Picture 2 / Image 2). */
  anchor: boolean;
  /** Your direction (≤ 500 characters). */
  direction?: string;
}

/**
 * The swap's prompt: Openjutsu's instruction in H3's reference tags, the anchor sentence only with an anchor, then the
 * character's description, who speaks and your direction. ComfyUI's graph names the inputs <Video 1>, <Picture 1> and
 * <Picture 2>; fal's H3 names them Video 1, Image 1 and Image 2. Open: the mask says who; cloud: the words do.
 */
export function swapPrompt(p: SwapPromptInput): string {
  const open = p.engine === "open";
  const video = open ? "<Video 1>" : "Video 1";
  const picture = (n: number) => (open ? `<Picture ${n}>` : `Image ${n}`);
  const who = open ? "the selected person" : whoWords(p);
  const parts = [`Replace ${who} in ${video} with the character in ${picture(1)}. Preserve the source performance, scene and audio timing.`];
  if (p.anchor) parts.push(`Start from the first frame in ${picture(2)}.`);
  const description = tidy(p.description).slice(0, CHARACTER_SWAP.maxDescriptionChars);
  if (description) parts.push(`The character: ${description}.`);
  const speech = speechLine(p.speech, p.dialogue);
  if (speech) parts.push(speech);
  const direction = tidy(p.direction).slice(0, CHARACTER_SWAP.maxDirectionChars);
  if (direction) parts.push(`${direction[0].toUpperCase()}${direction.slice(1)}.`);
  return parts.join(" ");
}

/**
 * The anchor frame's edit (image 1: the part's first frame, image 2: the character): Openjutsu's instruction, or Akatz
 * Labs' brief when the character is described (it names who to replace and keeps everyone else).
 */
export function anchorPrompt(o: Pick<CharacterOptions, "who" | "index" | "subject" | "description">): string {
  const description = tidy(o.description).slice(0, CHARACTER_SWAP.maxDescriptionChars);
  if (!description) {
    return "Replace the person in image 1 with the character from image 2, including their face, hair, body and complete outfit exactly as shown in image 2. Do not keep any of the original person's clothing. Keep image 1's pose, framing, background and lighting.";
  }
  return (
    `Image 1 is the source frame to edit. Image 2 is character identity only: ${description}. Replace ONLY ${whoWords(o)} with that single character. ` +
    "Match the exact source pose, face angle, gaze, mouth opening, expression, limb placement, scale and occlusions. Preserve all other people, the entire original scene, camera framing, lighting and aspect ratio. " +
    "Keep the reference identity and costume; do not copy the reference pose or background. One full-aspect edited source frame."
  );
}

/** The image edit that makes the anchor frame, per engine (the first is the default; docs/research/openjutsu-6.md §10). */
export const ANCHOR_MODELS: Record<Engine, { id: string; label: string; note: string; extra?: Record<string, string>; tokens?: string }[]> = {
  cloud: [
    // fal bills Sunburst by tokens, so the catalog has no fixed price for it: the estimate leaves it out and says so.
    { id: "gpt-image-2-5-sunburst", label: "GPT Image 2.5 Sunburst", note: "Openjutsu's choice, low quality: billed by tokens", extra: { quality: "low" }, tokens: "$8 per million tokens in, $30 per million out" },
    { id: "nano-banana-pro", label: "Nano Banana Pro", note: "$0.15 an image" },
  ],
  open: [{ id: "oss-qwen-edit", label: "Qwen-Image-Edit 2511", note: "Free on your GPU (24 GB)" }],
};

export const anchorModel = (engine: Engine, id?: string) => ANCHOR_MODELS[engine].find((m) => m.id === id) ?? ANCHOR_MODELS[engine][0];

/** What a run says when the anchor frame couldn't be made (the swap goes ahead without it). */
export const ANCHOR_FALLBACK = "Couldn't make the first frame — swapped without it";

// ---------------------------------------------------------------------------
// Checks and notes

/** What stops a part from being swapped, or null. `continued`: longer parts are allowed (up to 30 s). */
export function partProblem(part: { start: number; end: number }, clipSeconds?: number): string | null {
  const len = part.end - part.start;
  if (clipSeconds !== undefined && clipSeconds < CHARACTER_SWAP.minSeconds - 0.05) return `Choose a clip at least ${CHARACTER_SWAP.minSeconds} seconds long`;
  if (!(len > 0) || part.start < 0) return "Choose where the part starts";
  if (clipSeconds !== undefined && part.end > clipSeconds + 0.05) return "The part runs past the end of the clip";
  if (len < CHARACTER_SWAP.minSeconds - 0.05) return `Pick a part of ${CHARACTER_SWAP.minSeconds}–${CHARACTER_SWAP.maxSeconds} seconds (this is ${len.toFixed(1)} s)`;
  if (len > CHARACTER_SWAP.maxContinued + 0.05) return `A part can run up to ${CHARACTER_SWAP.maxContinued} seconds — 5–15 s swaps best`;
  return null;
}

export function seedProblem(seed: number | undefined): string | null {
  if (seed === undefined) return null;
  return Number.isInteger(seed) && seed >= 0 && seed <= CHARACTER_SWAP.maxSeed ? null : "Use a whole-number seed, or leave it blank";
}

/** The hard cuts inside a part (times in the clip), from the browser's cut detection (Katana's detectCuts). */
export const cutsInPart = (cuts: number[] | undefined, part: { start: number; end: number }) => (cuts ?? []).filter((t) => t > part.start + 0.2 && t < part.end - 0.2);

/** The warning for a part with a hard cut (the swap breaks at a cut). */
export function cutWarning(cuts: number[]): string | null {
  if (!cuts.length) return null;
  const at = cuts.map((t) => `${t.toFixed(1)} s`).join(", ");
  return `Your part has a cut at ${at} — the swap breaks at a cut. Move the part, or pick one continuous shot`;
}

/** The limits the page shows before a run (Openjutsu's README and Akatz Labs' validation notes). */
export const CHARACTER_LIMITS = [
  "A part of 5–15 seconds (up to 30 s, continued window by window)",
  "One continuous shot: a hard cut breaks the swap",
  "The person must be visible in the part's first frame",
  "With several people, the largest is swapped unless you pick another",
  "A silent clip gives a silent result",
] as const;

/** What the open route was tested on (its authors' words), for the GPU line. */
export const CHARACTER_GPU = {
  weightsGb: 46.33,
  tested: "Tested by its authors on a 96 GB RTX PRO 6000, and on a 24 GB RTX 4090 with 128 GB of RAM and model offloading",
  advice: "24 GB of VRAM with offloading and 64–128 GB of RAM; 48 GB+ for 768p. The NVFP4 text encoder runs at full speed on Blackwell (RTX 50, RTX PRO 6000) and slower on older GPUs",
  speed: "About two minutes for 5 s at 480p on a warm RTX PRO 6000",
} as const;

// ---------------------------------------------------------------------------
// Licences (information for Settings → Models & licences, never a gate: the owner's decision of 2026-10-27)

export type CharacterLicenceClass = "commercial" | "conditions" | "regions" | "non-commercial" | "paid-api";

export interface CharacterLicence {
  /** What it covers. */
  item: string;
  name: string;
  class: CharacterLicenceClass;
  url: string;
  /** Who a restricted-regions licence leaves out. */
  excludes?: string;
  /** Notices the app must show. */
  notices?: string[];
  note: string;
}

const H3_LICENCE_URL = "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE";

export const MINIMAX_H3_LICENCE: CharacterLicence = {
  item: "MiniMax H3 (diffusion model, VAEs, packaged text encoder) and Akatz Labs' Character Swap LoRA V1 / V1.5",
  name: "MiniMax H3 Community License",
  class: "regions",
  url: H3_LICENCE_URL,
  excludes: "the US, the EU, the UK and South Korea",
  notices: ["MiniMax H3"],
  note:
    "Granted outside the US, the EU, the UK and South Korea (MiniMax sells licences there, through Comfy); written authorization above US$20M yearly revenue; " +
    'show "MiniMax H3" on a commercial product\'s interface; outputs may not be used to improve other AI models; services for others must keep safeguards and a way to report misuse. MiniMax claims no rights over the outputs',
};

/** Every licence the Character swap touches, as data (the model picker's line and Settings → Models & licences). */
export const CHARACTER_LICENCES: CharacterLicence[] = [
  MINIMAX_H3_LICENCE,
  {
    item: "SAM 3.1 (finds and follows the person)",
    name: "Meta SAM License",
    class: "conditions",
    url: "https://huggingface.co/Comfy-Org/sam3.1/blob/7bb8374780a725b4353ed31f3a9395c9742b5621/LICENSE",
    note: "Royalty-free, commercial use allowed; give a copy of the licence when distributing, acknowledge SAM in publications, follow trade controls; no military, nuclear or weapons uses",
  },
  {
    item: "FL2V Turbo 8-step LoRA (lightx2v)",
    name: "Apache-2.0",
    class: "commercial",
    url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/blob/3ec17a324ced54151364f24f8b5fb6bf7e26414f/README.md",
    note: "Apache-2.0 at the pinned revision; the current card no longer states a licence",
  },
  {
    item: "h3_character_swap node pack (Akatz Labs)",
    name: "GPL-3.0",
    class: "commercial",
    url: "https://github.com/akatz-labs/h3-character-swap-tool/tree/0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b/worker_nodes/h3_character_swap",
    note: "GPL-3.0 code, like ComfyUI; a modified NVIDIA INT8 kernel inside is Apache-2.0",
  },
  {
    item: "H3 Relay 2.0 node pack (Akatz Labs)",
    name: "GPL-3.0",
    class: "commercial",
    url: "https://github.com/akatz-ai/h3-relay",
    note: "GPL-3.0 code (Sendy Software LLC and contributors); vendored Context Loop and Spectrum GPL-3.0",
  },
  {
    item: "Openjutsu's workflow and Akatz Labs' app",
    name: "MIT",
    class: "commercial",
    url: "https://github.com/Comfy-Org/comfy-openjutsu",
    note: "The graph Fuobe runs is Openjutsu's (Comfy Org, MIT), derived from Akatz Labs' MIT workflow",
  },
  {
    item: "fal's hosted MiniMax H3 and H3 Max Recast",
    name: "Paid API · fal.ai",
    class: "paid-api",
    url: "https://fal.ai/models/minimax/h3/reference-to-video/lora",
    note: "Pay per second on your fal key, under fal's terms and MiniMax's",
  },
];

/** The node packs, in the shape Settings → Models & licences lists packs (src/lib/licences.ts NODE_PACKS on model-access). */
export const H3_NODE_PACKS = CHARACTER_LICENCES.filter((l) => l.item.includes("node pack")).map((l) => ({
  name: l.item.startsWith("h3_character_swap") ? "h3_character_swap" : "h3-relay",
  repo: l.url,
  licence: { name: l.name, class: l.class, url: l.url, note: l.note },
}));

/** One line for a model picker: the licence that matters most for the route, as information. */
export function characterLicenceLine(engine: Engine, modelId: string): string {
  if (modelId === "h3-max-recast") return "MiniMax's closed H3 Max through fal: pay per second, under fal's and MiniMax's terms";
  const h3 = `MiniMax H3 Community License — not licensed in ${MINIMAX_H3_LICENCE.excludes}; commercial use over US$20M revenue needs MiniMax's OK; show "MiniMax H3"`;
  return engine === "open" ? `${h3} · nodes GPL-3.0 · SAM License` : `${h3} · on fal, pay per second`;
}
