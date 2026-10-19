import { estimateCost } from "./plan";
import type { ChainSlot, Engine, Generation, GenerationRequest, ModelDef } from "./types";

/*
 * Faceless Studio and the Explainer: the data and the pure planning shared by the browser (wizard,
 * script review, timeline editor) and the server (src/server/faceless.ts).
 *
 * Research: docs/research/higgsfield-marketing-agents.json → faceless (4 genres, 12 styles, 1–5 min,
 * Fully animated / Frame by frame, 16:9 / 9:16, ≤3 style references, ≤5,000-character topics, ≤12,000-character
 * scripts, 10-second blocks) and → explainer (22 styles, Auto / 20 s … 10 min / Manual 15–600 s, ≤3 sources).
 * tests/faceless.test.ts checks the copies against the JSON. The style prompts are Fuobe's own words.
 *
 * An episode is a list of blocks (one scene each, ≤10 s). Rendering builds one graph of chained generations:
 *
 *   still(b) ──► clip(b, s)… ──► join (folded) ──► mix ◄── narration, music ──► captions ──► final
 *
 * - still: a picture per block in the episode's style (Nano Banana Pro / Z-Image Turbo; with style
 *   references Nano Banana Pro edit / Qwen-Image-Edit Style Reference).
 * - clip: the still animated (Gemini Omni Flash, Higgsfield's engine, or Seedance 2.5 / Wan 2.2 Lightning).
 *   Frame by frame keeps the still and moves the camera slowly over it (a Ken Burns prompt, cheaper settings).
 * - narration: the whole reviewed script read in one take (one natural voice-over; ElevenLabs v4, or
 *   Chatterbox cloning a voice sample). Blocks are paced to their own lines, so picture and voice stay together.
 * - music: an instrumental bed (Sonilo / ACE-Step), mixed under the voice by the open mixer (oss-mux): the
 *   cloud soundtrack tool takes one track.
 * - captions: Auto Subtitle on the cloud; Qwen3-ASR timings + the open burn-in on the open engine.
 */

// ---------------------------------------------------------------------------
// Research data

export type FacelessGenre = "education" | "history" | "kids" | "storytelling";

export interface GenreInfo {
  id: FacelessGenre;
  label: string;
  hint: string;
  /** Style, narrator and music a new channel of this genre starts with. */
  style: string;
  voice: string;
  music: string;
  /** How the scripts should sound. */
  tone: string;
}

export const GENRES: GenreInfo[] = [
  {
    id: "education",
    label: "Education",
    hint: "Explain how something works",
    style: "editorial-motion-graphics",
    voice: "Xb7hH8MSUJpSbSDYk0k2",
    music: "light, curious documentary underscore, soft piano and pizzicato strings, unobtrusive",
    tone: "clear and curious, one idea at a time, concrete examples, no jargon without explaining it",
  },
  {
    id: "history",
    label: "History",
    hint: "Retell what actually happened",
    style: "watercolor-chronicle",
    voice: "JBFqnCBsd6RMkjVDRZzb",
    music: "cinematic orchestral documentary bed, low strings and soft timpani, slow build",
    tone: "vivid but accurate, dates and names where they matter, tell it like a story",
  },
  {
    id: "kids",
    label: "Kids",
    hint: "Bright, simple, and safe",
    style: "colorful-3d",
    voice: "cgSgspJ2msm6clMCkdW9",
    music: "cheerful playful underscore, ukulele, glockenspiel and soft claps",
    tone: "warm, simple words, short sentences, gentle humour, nothing scary",
  },
  {
    id: "storytelling",
    label: "Storytelling",
    hint: "Carry one story to its end",
    style: "fairy-tale-myth",
    voice: "pFZP5JQG7iQjIQuC4Bku",
    music: "warm cinematic ambient score, gentle swells, mysterious and emotional",
    tone: "one story with a beginning, a turn and an ending; vivid images; a narrator who builds suspense",
  },
];

export const genreInfo = (g: string | null | undefined): GenreInfo => GENRES.find((x) => x.id === g) ?? GENRES[0];

/** The examples under "Channel idea" (research: channelIdeaExamples). */
export const CHANNEL_IDEAS = [
  "Channel about survival in the wild",
  "Channel about the rise and fall of empires",
  "Channel about ancient civilizations",
  "Channel with daily history facts",
  "Channel about famous heists and scams",
  "Channel with songs for kids",
];

export interface VisualStyle {
  id: string;
  name: string;
  description: string;
  /** What every still in this style looks like (Fuobe's own prompt). */
  look: string;
  /** How things move when the still is animated. */
  motion: string;
  /** Card colour (oklch hue). */
  hue: number;
}

const style = (name: string, description: string, look: string, motion: string, hue: number): VisualStyle => ({
  id: styleId(name),
  name,
  description,
  look,
  motion,
  hue,
});

export function styleId(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Every style either studio offers (the 22 Explainer styles; Faceless uses 12 of them). */
export const STYLES: VisualStyle[] = [
  style(
    "Editorial Motion Graphics",
    "Layered cutouts, animated labels, diagrams and documentary pacing",
    "editorial motion-graphics explainer frame: layered photo cutouts and bold flat shapes, clean labels, arrows and simple diagrams, documentary colour grade, generous negative space, crisp modern design",
    "elements slide in on separate layers, labels and arrows pop on, subtle parallax between the layers",
    265,
  ),
  style(
    "Stickman Cartoon",
    "A story or concept told with simple stickman characters",
    "simple stickman cartoon on an off-white background: thick clean black lines, round heads, a few flat colour accents, expressive poses, minimal props",
    "the stick figures move with bouncy, snappy cartoon timing; simple squash and stretch",
    40,
  ),
  style(
    "Watercolor Chronicle",
    "Painterly watercolour documentary look",
    "painterly watercolour documentary illustration: loose washes with bleeding edges, muted historical palette, textured cold-press paper, cinematic composition",
    "watercolour washes bloom gently, figures move slowly, the camera drifts like a documentary",
    30,
  ),
  style(
    "Fairy Tale & Myth",
    "Imaginative scenes inspired by fairy tales and mythology",
    "storybook fairy-tale illustration: mythic, imaginative scenes in soft painterly gouache, glowing magical light, rich jewel tones, ornate decorative details",
    "magical particles drift, cloth and hair sway, slow dreamlike movement",
    300,
  ),
  style(
    "Paper Diorama",
    "Layered paper-like scenes and cutout characters",
    "layered paper diorama: cut-paper scenery and characters arranged in depth layers, visible paper texture, soft shadows between the layers, a handmade miniature set in warm light",
    "gentle parallax between the paper layers, characters move like paper puppets",
    50,
  ),
  style(
    "Pastel Flat 2D",
    "Soft pastel colours and simple flat illustrations",
    "soft pastel flat 2D illustration: simple rounded shapes without outlines, gentle gradients, calm friendly characters, lots of breathing room",
    "soft eased motion, elements float gently, calm pacing",
    330,
  ),
  style(
    "Colorful 3D",
    "Bright, toy-like 3D renders",
    "bright colourful 3D render: toy-like rounded shapes, glossy plastic and soft clay materials, soft global illumination, playful saturated palette",
    "bouncy playful 3D animation, soft camera drift",
    200,
  ),
  style(
    "Hand Drawn",
    "Hand-drawn illustrations and animated scenes, sketched and storybook-like",
    "hand-drawn ink and pencil illustration with a light watercolour wash: sketchy linework, storybook feel, off-white paper texture",
    "lines wobble slightly as if redrawn every frame, gentle hand-animated motion",
    70,
  ),
  style(
    "Poster Vector",
    "Flat poster-style vector illustration",
    "bold flat vector poster illustration: strong silhouettes, a limited palette, geometric shapes, subtle screen-print grain, dramatic composition",
    "shapes shift with smooth vector motion, gentle parallax between the planes",
    15,
  ),
  style(
    "Mannequin",
    "Stylized mannequin figures instead of an on-camera presenter",
    "stylized faceless mannequin figures acting out the scene: smooth matte artist-mannequin bodies, a clean studio-lit set, soft shadows, a muted palette",
    "the mannequins move with smooth, deliberate gestures",
    240,
  ),
  style(
    "Whiteboard Doodle",
    "Marker doodles on a whiteboard",
    "whiteboard doodle explainer: black marker line drawings on a clean white board, simple icons, arrows and handwritten-style shapes, a few colour highlights",
    "drawings appear as if being sketched, marker strokes animate on",
    220,
  ),
  style(
    "3D Papercraft",
    "Folded paper models",
    "3D papercraft scene: folded and creased paper models with origami-like geometry, visible paper grain, soft diffuse studio light",
    "paper pieces fold and unfold, a gentle camera move around the models",
    95,
  ),
  style(
    "Mixed Media",
    "Photos, paint and sketches layered together",
    "mixed-media collage: photographs, paint strokes, pencil sketches and graphic shapes layered together, rich textures, editorial art direction",
    "layers slide and blend, painterly marks animate on",
    350,
  ),
  style(
    "Low Poly",
    "Faceted low-poly 3D",
    "low-poly 3D illustration: faceted geometric shapes, flat-shaded polygons, clean gradients, a stylized minimal environment",
    "faceted shapes rotate and shift, a smooth camera glide",
    180,
  ),
  style(
    "2D Illustrator",
    "Polished modern 2D illustration",
    "polished 2D digital illustration: clean linework, rich flat colours with soft shading, modern editorial character design",
    "smooth 2D character animation with layered parallax",
    280,
  ),
  style(
    "Pixel Art",
    "Retro 16-bit pixel art",
    "detailed 16-bit pixel art scene: crisp pixels, a limited retro palette, dithering, a game-like composition",
    "sprite-style animation with a few looping frames",
    140,
  ),
  style(
    "Claymotion",
    "Handmade claymation",
    "claymation stop-motion scene: handmade plasticine characters and sets, fingerprint textures, soft miniature lighting",
    "stop-motion clay animation at a slightly choppy frame rate",
    20,
  ),
  style(
    "Isometric Flat Vector",
    "Isometric flat vector worlds",
    "isometric flat vector illustration on a 30-degree grid: clean geometric buildings and objects, bright flat colours, tiny detailed figures",
    "isometric pieces build up and move along the grid",
    160,
  ),
  style(
    "3D Mix",
    "Clay, plastic and paper in one 3D scene",
    "stylized 3D scene mixing clay, plastic and paper materials: a playful, art-directed composition with soft colourful lighting",
    "playful mixed-material 3D animation",
    120,
  ),
  style(
    "Studio 3D",
    "Clean studio-lit 3D renders",
    "clean studio-lit 3D render: a minimal set on a seamless backdrop, soft key and rim light, physically based materials, product-shot polish",
    "a smooth slow camera orbit, precise 3D motion",
    250,
  ),
  style(
    "Fluffy Toy",
    "A soft plush-toy world",
    "soft fluffy plush-toy world: felt and fur textures, cuddly rounded characters, warm cosy lighting, pastel colours",
    "plush characters wobble and bounce softly",
    320,
  ),
  style(
    "Paper collage",
    "Torn-paper collage cutouts",
    "torn-paper collage: layered magazine cutouts and kraft paper with rough torn edges, halftone print texture, bits of tape",
    "cutouts jitter and slide like stop-motion collage",
    60,
  ),
];

/** Faceless Studio's 12 styles, in Higgsfield's order. */
export const FACELESS_STYLE_IDS = [
  "editorial-motion-graphics",
  "stickman-cartoon",
  "fairy-tale-myth",
  "paper-diorama",
  "hand-drawn",
  "mannequin",
  "poster-vector",
  "colorful-3d",
  "watercolor-chronicle",
  "paper-collage",
  "studio-3d",
  "pastel-flat-2d",
];

/** The Explainer's 22 styles, in Higgsfield's order. */
export const EXPLAINER_STYLE_IDS = STYLES.map((s) => s.id);

export const getStyle = (id: string | null | undefined): VisualStyle => STYLES.find((s) => s.id === id) ?? STYLES[0];

export const MAX_TOPIC = 5000;
export const MAX_SCRIPT = 12_000;
export const MAX_IDEA = 500;
export const MAX_STYLE_REFS = 3;
export const MAX_SOURCES = 3;
/** Faceless lengths: 1–5 minutes. */
export const FACELESS_LENGTHS = [60, 120, 180, 240, 300];
/** Explainer durations ("auto" = as long as the topic needs; "manual" = 15–600 s). */
export const EXPLAINER_DURATIONS: { value: number | "auto" | "manual"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: 20, label: "20 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 180, label: "3 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: "manual", label: "Manual" },
];
export const EXPLAINER_MIN = 15;
export const EXPLAINER_MAX = 600;
/** "Auto" aims for this, the script decides. */
export const AUTO_SECONDS = 60;

/** Higgsfield charges per started 10-second block. */
export const BLOCK_SECONDS = 10;
export const MIN_BLOCK = 3;

// ---------------------------------------------------------------------------
// Settings and script

export type AnimationMode = "animated" | "frames";
export type EpisodeAspect = "16:9" | "9:16";

export const ANIMATION_MODES: { id: AnimationMode; label: string; tagline: string; copy: string }[] = [
  { id: "animated", label: "Fully animated", tagline: "Seamless motion video", copy: "Continuous animation across every scene" },
  {
    id: "frames",
    label: "Frame by frame",
    tagline: "Scene by scene video",
    copy: "Paced stills with a slow camera move — faster and lighter on credits",
  },
];

/** Who reads the script: a premade voice (cloud) or a recording to clone (any engine). */
export type NarratorVoice = { kind: "preset"; id: string; name?: string } | { kind: "sample"; url: string; name?: string };

export interface EpisodeSettings {
  engine: Engine;
  /** Target length in seconds; the reviewed script decides the actual length. */
  length: number;
  animation: AnimationMode;
  aspect: EpisodeAspect;
  subtitles: boolean;
  music: boolean;
  /** A style preset, or up to 3 style reference images (they replace the preset). */
  styleId: string;
  styleRefs: string[];
  voice: NarratorVoice | null;
  /** @handles of the characters / locations the script may use. */
  elements: string[];
  /** Advanced: the video model and its quality ("" = the mode's default). */
  videoModel?: string;
  resolution?: string;
  /** Reference images that show the subject (Explainer sources). */
  sourceImages?: string[];
  /** Explainer "Auto": the script decides the length. */
  auto?: boolean;
}

export interface ScriptBlock {
  id: string;
  /** What the narrator says over this block. */
  narration: string;
  /** What the picture shows (may @mention elements). */
  visual: string;
  /** What moves and how the camera moves. */
  motion: string;
  /** The block's length (from its narration when it's planned). */
  seconds: number;
}

/** Speaking rate used to time blocks (≈150 words a minute). Scripts are written a little under it. */
export const WORDS_PER_SECOND = 2.5;
export const WRITE_WORDS_PER_SECOND = 2.2;

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** How long a block must be for its lines (plus a breath), within one block. */
export function secondsFor(narration: string): number {
  const words = wordCount(narration);
  if (!words) return MIN_BLOCK + 1;
  return Math.max(MIN_BLOCK, Math.min(BLOCK_SECONDS, Math.ceil(words / WORDS_PER_SECOND + 0.6)));
}

/** Lines that need more than one block to be spoken. */
export const tooLong = (narration: string) => wordCount(narration) / WORDS_PER_SECOND + 0.6 > BLOCK_SECONDS;

/** How many blocks a length is (10 s each, at least one). */
export const blockCount = (seconds: number) => Math.max(1, Math.round(seconds / BLOCK_SECONDS));

/** Words a block of this length can carry when the script is written. */
export const wordsFor = (seconds: number) => Math.max(4, Math.floor(seconds * WRITE_WORDS_PER_SECOND));

/** Split a length into blocks of at most 10 s, as even as possible (25 s → 9 + 8 + 8). */
export function planBlocks(seconds: number): number[] {
  const total = Math.max(MIN_BLOCK, Math.round(seconds));
  const n = Math.ceil(total / BLOCK_SECONDS);
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

let uid = 0;
/** Ids for new blocks (stable enough for React keys and edit targets). */
export const blockId = () => `b${Date.now().toString(36)}${(uid++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const sentences = (text: string) =>
  text
    .replace(/\r/g, "")
    .split(/(?<=[.!?…])\s+|\n{1,}/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Cut text that's too long for one block into pieces that fit, at commas when it can. */
function fitPieces(sentence: string, max: number): string[] {
  if (wordCount(sentence) <= max) return [sentence];
  const parts = sentence.split(/(?<=[,;:—–])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const next = cur ? `${cur} ${p}` : p;
    if (cur && wordCount(next) > max) {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) out.push(cur);
  // A clause still too long: cut by words.
  return out.flatMap((piece) => {
    const words = piece.split(/\s+/);
    if (words.length <= max) return [piece];
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += max) chunks.push(words.slice(i, i + max).join(" "));
    return chunks;
  });
}

/** A picture to go with lines that came without one (pasted scripts, the offline writer). */
export const visualFromNarration = (narration: string) => {
  const s = narration.replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "");
  return s ? `A scene that shows: ${s.length > 220 ? `${s.slice(0, 217)}…` : s}` : "An establishing scene";
};

const DEFAULT_MOTION = "slow camera push-in, subtle movement in the scene";

/**
 * A pasted script as blocks: sentences grouped so each block's lines fit in 10 s. Pictures come from the
 * words (the writer can do better when an LLM is connected).
 */
export function splitScript(text: string): ScriptBlock[] {
  const max = Math.floor((BLOCK_SECONDS - 0.6) * WORDS_PER_SECOND);
  const pieces = sentences(text).flatMap((s) => fitPieces(s, max));
  const blocks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const next = cur ? `${cur} ${p}` : p;
    if (cur && wordCount(next) > max) {
      blocks.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) blocks.push(cur);
  return blocks.map((narration) => ({ id: blockId(), narration, visual: visualFromNarration(narration), motion: DEFAULT_MOTION, seconds: secondsFor(narration) }));
}

/**
 * Blocks ready to render: trimmed, each timed from its lines, and blocks whose lines don't fit in 10 s
 * split at sentence boundaries (the picture is reused, the camera keeps moving).
 */
export function normalizeBlocks(blocks: Partial<ScriptBlock>[]): ScriptBlock[] {
  const out: ScriptBlock[] = [];
  for (const b of blocks) {
    const narration = (b.narration ?? "").replace(/\s+/g, " ").trim();
    const visual = (b.visual ?? "").trim() || visualFromNarration(narration);
    const motion = (b.motion ?? "").trim() || DEFAULT_MOTION;
    if (!narration && !(b.visual ?? "").trim()) continue;
    if (!tooLong(narration)) {
      out.push({ id: b.id || blockId(), narration, visual, motion, seconds: secondsFor(narration) });
      continue;
    }
    splitScript(narration).forEach((piece, i) =>
      out.push({ ...piece, id: i === 0 && b.id ? b.id : blockId(), visual: i === 0 ? visual : `${visual} (continued, a new angle)`, motion: i === 0 ? motion : DEFAULT_MOTION }),
    );
  }
  return out;
}

export const totalSeconds = (blocks: Pick<ScriptBlock, "seconds">[]) => blocks.reduce((n, b) => n + b.seconds, 0);

/** "2:05" */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The narration as one voice-over: blocks become paragraphs (a natural pause between them). */
export const narrationText = (blocks: Pick<ScriptBlock, "narration">[]) =>
  blocks
    .map((b) => b.narration.trim())
    .filter(Boolean)
    .join("\n\n");

/** Where each block sits in the film, by its planned length. */
export function blockTimes(blocks: Pick<ScriptBlock, "seconds">[]): { start: number; end: number }[] {
  let t = 0;
  return blocks.map((b) => {
    const start = t;
    t += b.seconds;
    return { start, end: t };
  });
}

// ---------------------------------------------------------------------------
// Models

export interface EngineModels {
  still: string;
  /** Stills that follow style reference images. */
  styleStill: string;
  /** "Change the picture": an edit of the block's current still. */
  editStill: string;
  video: string;
  /** Other video models the settings offer. */
  videoChoices: string[];
  narration: string;
  /** Narration that clones a recorded voice. */
  cloneNarration: string;
  /** Narration models that take long scripts (above `narrationMaxChars`). */
  longNarration: string;
  narrationMaxChars: number;
  music: string;
  join: string;
  /** Joins at most this many clips at once (longer films are folded). */
  joinMax: number;
  /** Puts the voice on the film: one track (cloud) or the voice over a music bed (open). */
  mux: string;
  /** The open mixer: the only one that lays music under the voice. */
  mixMusic: string;
  captions: string;
  /** Open captions: transcribe the narration first, then burn the timed lines in. */
  transcribe?: string;
  write: string;
}

export const ENGINE_MODELS: Record<Engine, EngineModels> = {
  cloud: {
    still: "nano-banana-pro",
    styleStill: "nano-banana-pro",
    editStill: "nano-banana-pro",
    video: "gemini-omni-flash",
    videoChoices: ["gemini-omni-flash", "seedance-2-5"],
    narration: "elevenlabs-v4",
    cloneNarration: "chatterbox-cloud",
    longNarration: "elevenlabs-multilingual-v2",
    narrationMaxChars: 5000,
    music: "sonilo-music",
    join: "join-clips",
    joinMax: 24,
    mux: "merge-audio-video",
    mixMusic: "oss-mux",
    captions: "auto-subtitle",
    write: "text-llm",
  },
  open: {
    still: "oss-z-image-turbo",
    styleStill: "oss-style-qwen-edit",
    editStill: "oss-qwen-edit",
    video: "oss-wan22-14b-fast",
    videoChoices: ["oss-wan22-14b-fast"],
    narration: "oss-chatterbox",
    cloneNarration: "oss-chatterbox",
    longNarration: "oss-chatterbox",
    narrationMaxChars: Infinity,
    music: "oss-ace-step",
    join: "oss-join-clips",
    joinMax: 4,
    mux: "oss-mux",
    mixMusic: "oss-mux",
    captions: "oss-captions-burnin",
    transcribe: "oss-qwen3-asr",
    write: "oss-text-llm",
  },
};

/**
 * Clip lengths each block video model can make. Gemini Omni Flash takes any whole number of seconds
 * from 3 to 10 (research: duration 3–10); the others list their durations in the catalog.
 */
export const DURATION_RANGES: Record<string, [number, number]> = { "gemini-omni-flash": [3, 10] };

/** Default quality per mode. Frame by frame trades resolution for price on the cloud. */
export const DEFAULT_RESOLUTION: Record<string, Record<AnimationMode, string>> = {
  "gemini-omni-flash": { animated: "720p", frames: "360p" },
  "seedance-2-5": { animated: "720p", frames: "480p" },
  "oss-wan22-14b-fast": { animated: "480p", frames: "480p" },
};

/**
 * Per-second prices that depend on the resolution (research: Gemini Omni Flash 1.1 is $0.03 / $0.10 /
 * $0.15 / $0.30 per second at 360p / 720p / 1080p / 4K). The catalog lists only the cheapest.
 */
export const PRICE_PER_SECOND: Record<string, Record<string, number>> = {
  "gemini-omni-flash": { "360p": 0.03, "720p": 0.1, "1080p": 0.15, "4k": 0.3 },
};

export type ModelLookup = (id: string) => ModelDef | undefined;

/** Shot lengths that cover a block with the fewest shots, then the least overshoot. */
export function shotsFor(seconds: number, durations: number[] | undefined, range?: [number, number]): number[] {
  const need = Math.max(1, Math.round(seconds));
  if (range) {
    const [lo, hi] = range;
    const n = Math.ceil(need / hi);
    const base = Math.max(lo, Math.ceil(need / n));
    return Array.from({ length: n }, () => Math.min(hi, base));
  }
  const ds = [...new Set(durations?.length ? durations : [5])].filter((d) => d > 0).sort((a, b) => a - b);
  const max = ds[ds.length - 1];
  const n = Math.ceil(need / max);
  // Smallest total ≥ need with n shots (n ≤ 4 in practice: try every combination).
  let best: number[] | null = null;
  const walk = (left: number, picked: number[]) => {
    if (left === 0) {
      const sum = picked.reduce((a, b) => a + b, 0);
      if (sum >= need && (!best || sum < best.reduce((a, b) => a + b, 0))) best = [...picked];
      return;
    }
    for (const d of ds) if (!picked.length || d <= picked[picked.length - 1]) walk(left - 1, [...picked, d]);
  };
  walk(n, []);
  return best ?? Array.from({ length: n }, () => max);
}

/** The block video model's shots for a block. */
export function blockShots(seconds: number, model: ModelDef | undefined): number[] {
  if (!model) return [Math.round(seconds)];
  return shotsFor(seconds, model.options.durations, DURATION_RANGES[model.id]);
}

// ---------------------------------------------------------------------------
// Prompts

/** Slow camera moves for Frame by frame, one per block in turn. */
export const KEN_BURNS = [
  "slow push-in towards the centre of the picture",
  "slow pull-out revealing the whole picture",
  "slow pan from left to right across the picture",
  "slow pan from right to left across the picture",
  "slow tilt upward across the picture",
  "slow diagonal drift with a gentle zoom",
];

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");

/** The picture for a block, in the episode's style (or its style references). */
export function stillPrompt(style: VisualStyle, block: Pick<ScriptBlock, "visual">, o: { aspect: EpisodeAspect; refs: number; sources?: number } = { aspect: "16:9", refs: 0 }): string {
  const frame = o.aspect === "9:16" ? "Vertical 9:16 composition, the subject centred for a phone screen" : "Wide 16:9 composition";
  const look = o.refs
    ? `Draw it in the exact visual style of the reference image${o.refs > 1 ? "s" : ""}: the same technique, palette, line and texture`
    : `Style: ${style.look}`;
  const sources = o.sources ? `Use the attached source picture${o.sources > 1 ? "s" : ""} for what the subject looks like` : "";
  return [clean(block.visual), look, sources, frame, "No text, letters, captions or watermarks in the image"].filter(Boolean).join(". ") + ".";
}

/** What moves when a block's still is animated (Frame by frame: a slow camera over a still picture). */
export function motionPrompt(style: VisualStyle, block: Pick<ScriptBlock, "motion">, mode: AnimationMode, blockIndex: number, shot = 0): string {
  if (mode === "frames") {
    const move = KEN_BURNS[(blockIndex + shot) % KEN_BURNS.length];
    return `A still illustration with a ${move}. The picture itself doesn't change: nothing moves, nothing new appears, no morphing. Smooth and steady, like a documentary.`;
  }
  const then = shot ? "The camera keeps moving from where the last shot ended. " : "";
  return `${then}${clean(block.motion) || DEFAULT_MOTION}. ${style.motion.charAt(0).toUpperCase()}${style.motion.slice(1)}. Keep the art style, characters and colours exactly as in the first frame. No text.`;
}

export const musicPrompt = (genre: GenreInfo, style: VisualStyle) =>
  `Instrumental background music for a narrated video: ${genre.music}. It sits under a voice-over, no vocals, steady level, no sudden hits. Mood to match ${style.name.toLowerCase()} visuals.`;

// ---------------------------------------------------------------------------
// The render graph

export type StepPart = "still" | "clip" | "join" | "narration" | "music" | "mix" | "words" | "captions";

export interface GraphStep {
  key: string;
  part: StepPart;
  /** Block index (0-based) for still and clip steps. */
  block?: number;
  shot?: number;
  label: string;
  request: GenerationRequest;
  after?: string[];
  chain?: ChainSlot[];
  /** How much film the step covers (prices per second or minute: clips, music, mix, subtitles). */
  seconds?: number;
}

export interface GraphInput {
  feature: "faceless" | "explainer";
  title: string;
  genre: GenreInfo;
  settings: EpisodeSettings;
  blocks: ScriptBlock[];
  /** Per block: a picture edit to make instead of a new still (timeline editor). */
  stillEdits?: Record<string, { source: string; instruction: string }>;
  /** A voice to clone when the settings have none (the demo voice). */
  fallbackVoice?: string;
}

export interface ResolvedModels {
  still: string;
  video: string;
  resolution: string;
  narration: string;
  music: string | null;
  mux: string;
  join: string;
  joinMax: number;
  captions: string | null;
  transcribe: string | null;
}

/** Which models an episode runs on, from its engine and settings. */
export function resolveModels(settings: EpisodeSettings, narrationChars: number, lookup: ModelLookup): ResolvedModels {
  const m = ENGINE_MODELS[settings.engine];
  const video = settings.videoModel && m.videoChoices.includes(settings.videoModel) ? settings.videoModel : m.video;
  const videoDef = lookup(video);
  const offered = videoDef?.options.resolutions ?? [];
  const wanted = settings.resolution && offered.includes(settings.resolution) ? settings.resolution : (DEFAULT_RESOLUTION[video]?.[settings.animation] ?? videoDef?.defaults?.resolution ?? offered[0] ?? "720p");
  const sample = settings.voice?.kind === "sample";
  const narration = settings.engine === "open" ? m.narration : sample ? m.cloneNarration : narrationChars > m.narrationMaxChars ? m.longNarration : m.narration;
  return {
    still: settings.styleRefs.length ? m.styleStill : m.still,
    video,
    resolution: wanted,
    narration,
    music: settings.music ? m.music : null,
    mux: settings.music ? m.mixMusic : m.mux,
    join: m.join,
    joinMax: m.joinMax,
    captions: settings.subtitles ? m.captions : null,
    transcribe: settings.subtitles ? (m.transcribe ?? null) : null,
  };
}

/** Group keys into joins of at most `max`, level by level, so a changed block re-runs only its branch. */
export function foldJoins(keys: string[], max: number): { key: string; after: string[] }[][] {
  const levels: { key: string; after: string[] }[][] = [];
  let level = keys;
  let depth = 0;
  while (level.length > 1) {
    if (level.length <= max) {
      levels.push([{ key: "join", after: level }]);
      break;
    }
    const joins: { key: string; after: string[] }[] = [];
    const next: string[] = [];
    for (let i = 0; i < level.length; i += max) {
      const group = level.slice(i, i + max);
      if (group.length === 1) {
        next.push(group[0]);
        continue;
      }
      const key = `join-${depth + 1}-${joins.length + 1}`;
      joins.push({ key, after: group });
      next.push(key);
    }
    levels.push(joins);
    level = next;
    depth++;
  }
  return levels;
}

const pick = (lookup: ModelLookup, id: string) => {
  const m = lookup(id);
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
};

/** Music beds come in fixed lengths: the shortest that covers the film, else the longest there is. */
export function musicLength(model: ModelDef | undefined, seconds: number): number {
  const ds = [...(model?.options.durations ?? [])].sort((a, b) => a - b);
  if (!ds.length) return Math.ceil(seconds);
  return ds.find((d) => d >= seconds) ?? ds[ds.length - 1];
}

/**
 * Every step of an episode render, in dependency order. Pure: the server turns it into chained
 * generations (createPipeline), the editor uses it to work out what a change re-runs.
 */
export function buildEpisodeGraph(input: GraphInput, lookup: ModelLookup): GraphStep[] {
  const { settings, blocks, feature } = input;
  if (!blocks.length) throw new Error("The script has no scenes yet");
  const style = getStyle(settings.styleId);
  const voiceText = narrationText(blocks);
  if (!voiceText) throw new Error("The script has no narration yet");
  const models = resolveModels(settings, voiceText.length, lookup);
  const videoDef = pick(lookup, models.video);
  const ar = settings.aspect;
  const batchTitle = input.title;
  const base = { feature, batchTitle } satisfies Partial<GenerationRequest>;
  const steps: GraphStep[] = [];
  const n = blocks.length;
  const clipKeys: string[] = [];
  const sources = (settings.sourceImages ?? []).slice(0, 3);
  const refs = settings.styleRefs.slice(0, MAX_STYLE_REFS);
  const stillDef = pick(lookup, models.still);
  // Reference images go where the still model reads them: a style-reference model takes only the style
  // images; a multi-reference model (Nano Banana Pro) takes them and the sources; a plain t2i model none.
  const takesRefs = stillDef.routes.some((r) => r.op === "edit") || !!stillDef.options.maxImages;
  const maxRefs = stillDef.options.maxImages ?? 1;
  const stillImages = !takesRefs ? [] : stillDef.engine === "open" && refs.length ? refs.slice(0, maxRefs) : [...refs, ...sources].slice(0, maxRefs);
  const refCount = Math.min(refs.length, stillImages.length);

  blocks.forEach((b, i) => {
    const edit = input.stillEdits?.[b.id];
    const stillKey = `still-${b.id}`;
    if (edit) {
      steps.push({
        key: stillKey,
        part: "still",
        block: i,
        label: `Scene ${i + 1} · picture`,
        request: {
          ...base,
          modelId: ENGINE_MODELS[settings.engine].editStill,
          op: "edit",
          prompt: `${clean(edit.instruction)}. Keep everything else the same: the art style, composition, characters and colours.`,
          inputs: { images: [edit.source] },
          params: { aspectRatio: ar, numOutputs: 1 },
          step: { label: `Scene ${i + 1} · picture`, index: i, of: n },
        },
      });
    } else {
      steps.push({
        key: stillKey,
        part: "still",
        block: i,
        label: `Scene ${i + 1} · picture`,
        request: {
          ...base,
          modelId: models.still,
          prompt: stillPrompt(style, b, { aspect: ar, refs: refCount, sources: stillImages.length - refCount }),
          ...(stillImages.length && { inputs: { images: stillImages } }),
          params: { aspectRatio: ar, numOutputs: 1 },
          step: { label: `Scene ${i + 1} · picture`, index: i, of: n },
        },
      });
    }
    const shots = blockShots(b.seconds, videoDef);
    shots.forEach((secs, s) => {
      const key = `clip-${b.id}-${s + 1}`;
      clipKeys.push(key);
      const label = shots.length > 1 ? `Scene ${i + 1} · clip ${s + 1} of ${shots.length}` : `Scene ${i + 1} · clip`;
      steps.push({
        key,
        part: "clip",
        block: i,
        shot: s,
        label,
        seconds: secs,
        after: [stillKey],
        chain: [{ slot: "images", position: "first" }],
        request: {
          ...base,
          modelId: models.video,
          op: "i2v",
          prompt: motionPrompt(style, b, settings.animation, i, s),
          params: {
            aspectRatio: ar,
            duration: secs,
            resolution: models.resolution,
            numOutputs: 1,
            // The narration replaces the clip's own sound.
            ...(videoDef.options.audio === true && { generateAudio: false }),
          },
          step: { label, index: i, of: n },
        },
      });
    });
  });

  // Join the clips (folded when there are more than one join takes).
  const joinDef = pick(lookup, models.join);
  const joinRes = joinDef.options.resolutions?.includes(models.resolution) ? models.resolution : (joinDef.defaults?.resolution ?? undefined);
  const levels = foldJoins(clipKeys, models.joinMax);
  for (const level of levels) {
    for (const j of level) {
      steps.push({
        key: j.key,
        part: "join",
        label: j.key === "join" ? "Joining the scenes" : `Joining scenes (part ${j.key.split("-").slice(1).join(".")})`,
        after: j.after,
        chain: j.after.map(() => ({ slot: "videos" as const })),
        request: {
          ...base,
          modelId: models.join,
          op: "concat",
          prompt: input.title,
          params: { aspectRatio: ar, ...(joinRes && { resolution: joinRes }) },
          step: { label: j.key === "join" ? "Film" : "Joining scenes", index: n, of: n },
        },
      });
    }
  }
  const film = levels.length ? "join" : clipKeys[0];
  const filmSeconds = blocks.reduce((t, b) => t + blockShots(b.seconds, videoDef).reduce((a, c) => a + c, 0), 0);

  // The voice-over, read in one take.
  const narrationDef = pick(lookup, models.narration);
  const voice = settings.voice;
  const sample = voice?.kind === "sample" ? voice.url : narrationDef.options.voiceClone && !narrationDef.options.voices?.length ? input.fallbackVoice : undefined;
  const presetVoice = voice?.kind === "preset" && narrationDef.options.voices?.some((v) => v.id === voice.id) ? voice.id : narrationDef.defaults?.voice;
  steps.push({
    key: "narration",
    part: "narration",
    label: "Narration",
    request: {
      ...base,
      modelId: models.narration,
      op: "tts",
      prompt: voiceText,
      ...(sample && { inputs: { voiceAudio: sample } }),
      params: { ...(presetVoice && !sample && { voice: presetVoice }) },
      step: { label: "Narration", index: n, of: n },
    },
  });

  if (models.music) {
    const musicDef = pick(lookup, models.music);
    steps.push({
      key: "music",
      part: "music",
      label: "Music bed",
      seconds: musicLength(musicDef, filmSeconds),
      request: {
        ...base,
        modelId: models.music,
        op: "music",
        prompt: musicPrompt(input.genre, style),
        params: { duration: musicLength(musicDef, filmSeconds), numOutputs: 1, ...(settings.engine === "open" && { extra: { lyrics: "[Instrumental]" } }) },
        step: { label: "Music", index: n, of: n },
      },
    });
  }

  const muxDef = pick(lookup, models.mux);
  const mixAfter = models.music ? [film, "narration", "music"] : [film, "narration"];
  steps.push({
    key: "mix",
    part: "mix",
    label: models.music ? "Voice and music" : "Voice-over",
    seconds: filmSeconds,
    after: mixAfter,
    chain: models.music ? [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] : [{ slot: "video" }, { slot: "audio" }],
    request: {
      ...base,
      modelId: models.mux,
      op: "mux",
      ...(muxDef.engine === "open" && models.music && { params: { extra: { backgroundVolumeDb: -14 } } }),
      ...(!models.captions && { title: input.title }),
      step: { label: models.music ? "Voice and music" : "Voice-over", index: n, of: n },
    },
  });

  if (models.captions) {
    if (models.transcribe) {
      steps.push({
        key: "words",
        part: "words",
        label: "Caption timing",
        after: ["narration"],
        chain: [{ slot: "audio" }],
        request: { ...base, modelId: models.transcribe, op: "transcribe", step: { label: "Caption timing", index: n, of: n } },
      });
    }
    const vertical = ar === "9:16";
    steps.push({
      key: "captions",
      part: "captions",
      label: "Subtitles",
      seconds: filmSeconds,
      after: models.transcribe ? ["mix", "words"] : ["mix"],
      chain: models.transcribe ? [{ slot: "video" }, { slot: "prompt" }] : [{ slot: "video" }],
      request: {
        ...base,
        modelId: models.captions,
        op: "captions",
        title: input.title,
        params: models.transcribe ? { extra: { fontSize: vertical ? 4 : 6, wordsPerCaption: vertical ? 3 : 5 } } : { extra: { words_per_subtitle: vertical ? 3 : 5 } },
        step: { label: "Subtitles", index: n, of: n },
      },
    });
  }
  return steps;
}

/** The step whose output is the finished episode. */
export const finalKey = (graph: Pick<GraphStep, "key">[]) => (graph.some((s) => s.key === "captions") ? "captions" : "mix");

/** Keys that wait (directly or not) on any of `keys`. */
export function descendants(graph: Pick<GraphStep, "key" | "after">[], keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...keys];
  while (queue.length) {
    const k = queue.shift()!;
    for (const s of graph) {
      if (out.has(s.key) || !s.after?.includes(k)) continue;
      out.add(s.key);
      queue.push(s.key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Changes (timeline editor) and retries

export type ChangePart = "picture" | "motion" | "narration";

/** The steps a change touches directly; everything downstream re-runs too. */
export function changedKeys(graph: GraphStep[], blockIds: string[], part: ChangePart): string[] {
  if (part === "narration") return ["narration"];
  const inBlocks = (s: GraphStep) => s.block !== undefined && blockIds.some((id) => s.key === `still-${id}` || s.key.startsWith(`clip-${id}-`));
  return graph.filter((s) => inBlocks(s) && (part === "picture" || s.part === "clip")).map((s) => s.key);
}

export interface RerunPlan {
  /** Steps to create again, in graph order. */
  rerun: string[];
  /** Steps whose current generation is kept. */
  reuse: string[];
}

/**
 * What a change re-runs: the changed steps and everything after them (the joins up the branch, the mix,
 * the subtitles). The other blocks keep their generations.
 */
export function planRerun(graph: GraphStep[], changed: string[]): RerunPlan {
  const dirty = new Set([...changed, ...descendants(graph, changed)]);
  return { rerun: graph.filter((s) => dirty.has(s.key)).map((s) => s.key), reuse: graph.filter((s) => !dirty.has(s.key)).map((s) => s.key) };
}

/**
 * A retry: the steps that failed (or were never made, or whose request changed) and everything waiting
 * on them. `status` maps a key to its generation's status (missing = never made).
 */
export function planRetry(graph: GraphStep[], status: Record<string, string | undefined>): RerunPlan {
  const broken = graph.filter((s) => !status[s.key] || status[s.key] === "failed" || status[s.key] === "canceled").map((s) => s.key);
  return planRerun(graph, broken);
}

// ---------------------------------------------------------------------------
// Cost

/**
 * What one step costs: "per 1k chars" prices are per thousand characters of the script (not per request),
 * per-second video prices follow the resolution, and per-second or per-minute tools (soundtrack, subtitles)
 * are priced for the `seconds` of film they cover.
 */
export function stepCostUsd(model: ModelDef | undefined, request: GenerationRequest, seconds?: number): number | null {
  if (!model) return null;
  if (model.engine === "open") return 0;
  const p = model.pricing;
  if (!p) return null;
  const params = { ...model.defaults, ...request.params, ...(seconds !== undefined && (p.unit === "second" || p.unit === "minute") && { duration: seconds }) };
  if (p.unit === "request" && /per 1k char/i.test(p.note ?? "")) {
    const chars = request.prompt?.length ?? 0;
    return Math.round(p.usd * Math.max(1, Math.ceil(chars / 1000)) * 1000) / 1000;
  }
  const table = PRICE_PER_SECOND[model.id];
  if (p.unit === "second" && table && params.resolution && table[params.resolution] !== undefined) {
    return Math.round(table[params.resolution] * (params.duration ?? 5) * 1000) / 1000;
  }
  return estimateCost(model, params, 1);
}

export interface CostBreakdown {
  total: number;
  /** Per part: stills, clips, narration… (null = a model with no published price). */
  parts: Partial<Record<StepPart, number>>;
  unknown: boolean;
}

export function estimateGraph(graph: GraphStep[], lookup: ModelLookup, only?: Iterable<string>): CostBreakdown {
  const keep = only ? new Set(only) : null;
  const parts: Partial<Record<StepPart, number>> = {};
  let total = 0;
  let unknown = false;
  for (const s of graph) {
    if (keep && !keep.has(s.key)) continue;
    const c = stepCostUsd(lookup(s.request.modelId), s.request, s.seconds);
    if (c === null) {
      unknown = true;
      continue;
    }
    parts[s.part] = Math.round(((parts[s.part] ?? 0) + c) * 1000) / 1000;
    total += c;
  }
  return { total: Math.round(total * 100) / 100, parts, unknown };
}

/** Blocks for an estimate before the script exists: the target length in 10-second blocks. */
export function placeholderBlocks(seconds: number): ScriptBlock[] {
  return planBlocks(seconds).map((secs, i) => {
    const words = Math.floor(secs * WRITE_WORDS_PER_SECOND);
    return { id: `p${i}`, narration: Array.from({ length: words }, () => "word").join(" "), visual: "A scene", motion: DEFAULT_MOTION, seconds: secs };
  });
}

export const PART_LABELS: Record<StepPart, string> = {
  still: "Pictures",
  clip: "Animation",
  join: "Joining",
  narration: "Narration",
  music: "Music",
  mix: "Mixing",
  words: "Caption timing",
  captions: "Subtitles",
};

// ---------------------------------------------------------------------------
// Writing: briefs for the LLM, parsers for its answers, and the offline writer

export interface TopicIdea {
  title: string;
  hook: string;
}

export const topicsSystem = `You suggest episode topics for a faceless YouTube channel (one narrator over illustrated scenes).
Reply with JSON only: {"topics": [{"title": string, "hook": string}]}.
- title: a specific, clickable episode title (under 70 characters), not generic.
- hook: one sentence on why someone would watch it.
- Every topic fits the channel and its genre, and they differ from each other.`;

export function topicsBrief(o: { idea: string; genre: GenreInfo; count: number; avoid?: string[]; reference?: string }): string {
  return [
    `Channel: ${o.idea}`,
    `Genre: ${o.genre.label} — ${o.genre.hint}. Tone: ${o.genre.tone}.`,
    o.reference ? `The channel takes after: ${o.reference}` : "",
    o.avoid?.length ? `Already suggested (don't repeat): ${o.avoid.join("; ")}` : "",
    `Suggest ${o.count} topics.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The first JSON object or array in a reply (models wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const open = candidate[start];
    const close = open === "{" ? "}" : "]";
    const end = candidate.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }
  return null;
}

export function parseTopics(text: string): TopicIdea[] {
  const j = extractJson(text) as { topics?: unknown } | unknown[] | null;
  const list = Array.isArray(j) ? j : Array.isArray((j as { topics?: unknown })?.topics) ? ((j as { topics: unknown[] }).topics as unknown[]) : [];
  return list
    .map((t) => (typeof t === "string" ? { title: t, hook: "" } : (t as Partial<TopicIdea>)))
    .filter((t): t is TopicIdea => typeof t?.title === "string" && !!t.title.trim())
    .map((t) => ({ title: t.title.trim().slice(0, 140), hook: (t.hook ?? "").toString().trim().slice(0, 240) }));
}

/** "Channel about survival in the wild" → "survival in the wild". */
export function subjectOf(idea: string): string {
  const s = idea
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/^(a |an |my )?(youtube )?channel\s+(about|with|on|for|of)\s+/i, "")
    .replace(/^(please\s+)?(explain|describe|tell (me|us) about|show (me|us)|teach (me|us)( about)?)\s+(to (me|us|kids)\s+)?/i, "")
    .replace(/^(about|on)\s+/i, "")
    .trim();
  return s || "your subject";
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A channel name from the idea (when no LLM is connected). */
export function channelName(idea: string): string {
  const s = subjectOf(idea)
    .replace(/^(daily|weekly)\s+/i, "")
    .split(/\s+/)
    .slice(0, 6)
    .map((w, i) => (i > 0 && /^(a|an|the|of|in|and|or|for|to|on|at|with)$/i.test(w) ? w.toLowerCase() : capital(w)))
    .join(" ");
  return s.length > 48 ? `${s.slice(0, 47)}…` : s || "My channel";
}

const OFFLINE_TOPICS: Record<FacelessGenre, [string, string][]> = {
  education: [
    ["How {s} really works", "The simple idea behind it, step by step."],
    ["5 surprising facts about {s}", "Things most people get wrong."],
    ["The science behind {s}", "What's actually happening, explained with pictures."],
    ["Myths about {s}, busted", "What's true, what isn't, and why."],
    ["{S} explained in three minutes", "Everything you need, nothing you don't."],
    ["What nobody tells you about {s}", "The part the textbooks skip."],
  ],
  history: [
    ["The untold beginning of {s}", "Where it really started."],
    ["The day that changed {s} forever", "One moment, and everything after it."],
    ["How {s} shaped the world", "The ripple effects we still live with."],
    ["The rise and fall of {s}", "From the first spark to the end."],
    ["{S}: the mystery historians still argue about", "The evidence, and the theories."],
    ["A day in the life during {s}", "What it was really like to be there."],
  ],
  kids: [
    ["Let's learn about {s}!", "A bright, friendly first look."],
    ["{S} for little explorers", "Big questions, simple answers."],
    ["A song about {s}", "Sing along and remember it."],
    ["Why is {s} so amazing?", "Fun facts to share at dinner."],
    ["Counting with {s}", "One, two, three — let's go!"],
    ["Bedtime story: {s}", "A calm story to end the day."],
  ],
  storytelling: [
    ["The legend of {s}", "An old tale, told from the beginning."],
    ["A stranger arrives: a story of {s}", "One visitor changes everything."],
    ["The last secret of {s}", "Some secrets are kept for a reason."],
    ["{S}: a story told in one night", "From dusk to dawn, one story."],
    ["The map that led to {s}", "A journey nobody expected to finish."],
    ["When {s} came back", "Some things don't stay gone."],
  ],
};

const fill = (t: string, s: string) => t.replaceAll("{S}", capital(s)).replaceAll("{s}", s);

/** Topic suggestions without an LLM: templates per genre around the channel's subject. */
export function offlineTopics(idea: string, genre: FacelessGenre, count = 5, skip = 0): TopicIdea[] {
  const s = subjectOf(idea);
  const list = OFFLINE_TOPICS[genre] ?? OFFLINE_TOPICS.education;
  return Array.from({ length: Math.min(count, list.length) }, (_, i) => {
    const [title, hook] = list[(i + skip) % list.length];
    return { title: fill(title, s), hook };
  });
}

export const scriptSystem = `You write scripts for faceless videos: one narrator speaking over illustrated scenes, no presenter on camera.
Reply with JSON only: {"title": string, "scenes": [{"narration": string, "visual": string, "motion": string}]}.
- narration: only the words the narrator says (no stage directions, no scene numbers); the scenes read as one continuous voice-over.
- visual: one or two sentences describing the illustration for the scene: subject, setting, composition. Never ask for text, letters or captions in the picture.
- motion: a few words on what moves and how the camera moves.
- Keep each scene's narration within its word limit, so the voice fits the scene.
- Start with a hook in the first scene; end with a short, satisfying close.`;

export interface ScriptBrief {
  topic: string;
  genre: GenreInfo;
  /** Number of scenes and the word limit for each. */
  scenes: number;
  wordsPerScene: number;
  channel?: string;
  styleName?: string;
  elements?: { handle: string; kind: string; description?: string | null }[];
  reference?: string;
  /** Source material (documents, summarised links). */
  sources?: string[];
  /** Explainer: the length decides itself. */
  auto?: boolean;
  subtitles?: boolean;
}

export function scriptBrief(b: ScriptBrief): string {
  const els = b.elements?.length
    ? `These characters and places can appear; write their @handle in the visual whenever they do: ${b.elements.map((e) => `@${e.handle} (${e.kind}${e.description ? `: ${e.description}` : ""})`).join(", ")}.`
    : "";
  return [
    `Topic: ${b.topic}`,
    b.channel ? `Channel: ${b.channel}` : "",
    `Genre: ${b.genre.label} — ${b.genre.hint}. Tone: ${b.genre.tone}.`,
    b.styleName ? `The pictures are drawn as ${b.styleName}.` : "",
    b.auto
      ? `Use as many scenes as the topic needs: between 4 and 12, each at most ${b.wordsPerScene} words of narration.`
      : `Write exactly ${b.scenes} scenes, each at most ${b.wordsPerScene} words of narration (about 10 seconds spoken).`,
    els,
    b.reference ? `Match the pacing and tone of: ${b.reference}` : "",
    b.sources?.length ? `Base the facts on these sources:\n${b.sources.map((s, i) => `[${i + 1}] ${s}`).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pictures and motion for a pasted script, numbered line by line. */
export const visualsSystem = `You plan the pictures for a narrated faceless video. The user sends numbered narration lines "[n] text".
Reply with JSON only: {"scenes": [{"n": number, "visual": string, "motion": string}]}, one per line, in order.
- visual: one or two sentences describing the illustration for that line: subject, setting, composition. No text in the picture.
- motion: a few words on what moves and how the camera moves.`;

export const visualsBrief = (blocks: Pick<ScriptBlock, "narration">[], styleName: string, topic: string) =>
  [`Topic: ${topic}`, `Style: ${styleName}`, ...blocks.map((b, i) => `[${i + 1}] ${b.narration}`)].join("\n");

export function parseVisuals(text: string, count: number): { visual: string; motion: string }[] | null {
  const j = extractJson(text) as { scenes?: unknown } | unknown[] | null;
  const list = (Array.isArray(j) ? j : (j as { scenes?: unknown[] })?.scenes) as { n?: number; visual?: string; motion?: string }[] | undefined;
  if (!Array.isArray(list)) return null;
  const out = Array.from({ length: count }, (_, i) => {
    const s = list.find((x) => Number(x?.n) === i + 1) ?? list[i];
    return typeof s?.visual === "string" && s.visual.trim() ? { visual: s.visual.trim(), motion: (s.motion ?? "").toString().trim() } : null;
  });
  return out.every(Boolean) ? (out as { visual: string; motion: string }[]) : null;
}

export interface ParsedScript {
  title: string | null;
  blocks: ScriptBlock[];
}

/** The LLM's answer as blocks; prose without JSON is used as a pasted script. */
export function parseScript(text: string): ParsedScript | null {
  const j = extractJson(text) as { title?: unknown; scenes?: unknown } | unknown[] | null;
  const scenes = (Array.isArray(j) ? j : (j as { scenes?: unknown })?.scenes) as Partial<ScriptBlock>[] | undefined;
  if (Array.isArray(scenes)) {
    const blocks = normalizeBlocks(
      scenes
        .filter((s) => s && typeof s === "object" && typeof s.narration === "string" && s.narration.trim())
        .map((s) => ({ narration: String(s.narration), visual: typeof s.visual === "string" ? s.visual : "", motion: typeof s.motion === "string" ? s.motion : "" })),
    );
    if (blocks.length) {
      const title = !Array.isArray(j) && typeof (j as { title?: unknown })?.title === "string" ? String((j as { title: string }).title).trim() : null;
      return { title: title || null, blocks };
    }
  }
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  if (wordCount(prose) >= 8 && !/^\s*[[{]/.test(prose)) return { title: null, blocks: splitScript(prose) };
  return null;
}

const BEATS: Record<FacelessGenre, { narration: string; visual: string }[]> = {
  education: [
    { narration: "Today's question: {s}. In the next few minutes, it will all make sense.", visual: "An intriguing establishing picture about {s}, seen from a surprising angle" },
    { narration: "Let's start with the basics, and why this matters more than you might think.", visual: "A simple diagram-like picture introducing {s}" },
    { narration: "Here is the first key idea. Once you see it, the rest starts to click.", visual: "A close-up that highlights the first key part of {s}" },
    { narration: "Now add the second piece. This is where most people get confused, so let's slow down.", visual: "Two parts of {s} side by side, showing how they connect" },
    { narration: "Put together, these pieces explain something you see every day.", visual: "An everyday scene connected to {s}" },
    { narration: "So that's the answer, in a nutshell. Now you know more than most people do.", visual: "A satisfying wide picture that sums up {s}" },
  ],
  history: [
    { narration: "This is the story of {s}, and it begins long before most people think.", visual: "A sweeping historical landscape where the story of {s} begins" },
    { narration: "At first, nobody could have guessed how important it would become.", visual: "Ordinary people going about their day in the early days of {s}" },
    { narration: "Then, one decision changed everything.", visual: "A tense meeting of leaders around a table, candlelight" },
    { narration: "The consequences spread further and faster than anyone expected.", visual: "A map-like scene showing the influence of {s} spreading" },
    { narration: "Not everyone welcomed the change, and the struggle that followed would last for years.", visual: "Two opposing groups facing each other across a field" },
    { narration: "Today, the traces of {s} are still all around us, if you know where to look.", visual: "Modern people walking past ruins and monuments linked to {s}" },
  ],
  kids: [
    { narration: "Hello, friends! Today we're going on an adventure to learn all about {s}!", visual: "A cheerful friendly character waving hello in front of {s}" },
    { narration: "Look closely. What can you see? Let's count the colours together!", visual: "A bright, colourful close-up of {s}" },
    { narration: "Did you know? {S} can do something really, really amazing.", visual: "A delightful surprising moment about {s}" },
    { narration: "Let's try it ourselves. Ready? One, two, three!", visual: "Happy children playing and exploring {s}" },
    { narration: "Wow, you did it! You learned so much today.", visual: "A celebration with confetti and smiling friends" },
    { narration: "See you next time, little explorers. Bye-bye!", visual: "The friendly character waving goodbye at sunset" },
  ],
  storytelling: [
    { narration: "Long ago, in a place nobody remembers, there was a story about {s}.", visual: "A misty, mysterious opening scene of a faraway land tied to {s}" },
    { narration: "Our hero had no idea that a single choice would change their life.", visual: "A lone hero standing at a crossroads at dusk" },
    { narration: "The path ahead was dark, and every step brought a new danger.", visual: "The hero walking through a dark, winding forest path" },
    { narration: "Then came the moment of truth. There was no turning back.", visual: "A dramatic confrontation lit by a single glowing light" },
    { narration: "When the dust settled, nothing would ever be the same again.", visual: "Dawn breaking over a changed landscape" },
    { narration: "And that is why, to this day, people still whisper the legend of {s}.", visual: "Villagers telling the story around a warm fire at night" },
  ],
};

/** A demo-quality script without an LLM: the genre's beats around the topic, as many scenes as asked. */
export function offlineScript(topic: string, genre: FacelessGenre, scenes: number): ScriptBlock[] {
  const s = subjectOf(topic).replace(/[.!?]+$/, "");
  const beats = BEATS[genre] ?? BEATS.education;
  const n = Math.max(1, scenes);
  return normalizeBlocks(
    Array.from({ length: n }, (_, i) => {
      // First and last beats open and close; the middle ones repeat as needed.
      const beat = i === 0 ? beats[0] : i === n - 1 && n > 1 ? beats[beats.length - 1] : beats[1 + ((i - 1) % (beats.length - 2))];
      return { narration: fill(beat.narration, s), visual: fill(beat.visual, s), motion: DEFAULT_MOTION };
    }),
  );
}

export const OFFLINE_NOTE = "Written offline — connect Claude or Ollama in Settings for a real script.";

// ---------------------------------------------------------------------------
// Validation the wizard and the API share

/** A YouTube channel, video or playlist link (research: Reference). */
export function youtubeKind(url: string): "channel" | "video" | "playlist" | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return u.pathname.length > 1 ? "video" : null;
  if (host !== "youtube.com" && host !== "music.youtube.com") return null;
  if (u.pathname === "/playlist" && u.searchParams.get("list")) return "playlist";
  if ((u.pathname === "/watch" && u.searchParams.get("v")) || /^\/(shorts|live|embed)\/[\w-]+/.test(u.pathname)) return "video";
  if (/^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/.test(u.pathname)) return "channel";
  return null;
}

export const YOUTUBE_ERROR = "That does not look like a YouTube channel, video or playlist link.";

/** Explainer duration → seconds (null = Auto). Throws the research's message for a bad manual value. */
export function explainerSeconds(value: number | "auto"): number | null {
  if (value === "auto") return null;
  if (!Number.isInteger(value) || value < EXPLAINER_MIN || value > EXPLAINER_MAX) throw new Error("Duration must be Auto or a whole number of seconds between 15 and 600");
  return value;
}

/** Which narrator voice a channel or episode starts with. */
export const defaultVoice = (engine: Engine, genre: GenreInfo, explainer = false): NarratorVoice | null =>
  engine === "open" ? null : { kind: "preset", id: explainer ? "XrExE9yKIg1WjnnlVkGX" : genre.voice };

/** Settings a new episode starts with. */
export function defaultSettings(engine: Engine, genre: GenreInfo, o: { explainer?: boolean } = {}): EpisodeSettings {
  return {
    engine,
    length: o.explainer ? AUTO_SECONDS : 60,
    animation: "animated",
    aspect: "16:9",
    subtitles: true,
    music: engine === "open",
    styleId: genre.style,
    styleRefs: [],
    voice: defaultVoice(engine, genre, o.explainer),
    elements: [],
  };
}

/** A short line the narrator reads for a voice preview. */
export const previewLine = (name: string) => `Hi, I'm ${name}. I'll be narrating your episode — here's how I sound.`;

// ---------------------------------------------------------------------------
// What the API sends (shared by the server module and the client hooks)

export interface ChannelReference {
  url: string;
  kind: "channel" | "video" | "playlist";
  title?: string;
  author?: string;
  /** The link's thumbnail, saved as an upload (offered as a style reference). */
  thumbnail?: string;
}

/** Saved on the channel so every episode looks and sounds the same. */
export type ChannelSettings = Pick<EpisodeSettings, "engine" | "styleId" | "styleRefs" | "voice" | "aspect" | "subtitles" | "music" | "animation" | "length">;

export interface FacelessChannel {
  id: string;
  name: string;
  idea: string;
  genre: FacelessGenre;
  avatarUrl: string | null;
  reference: ChannelReference | null;
  settings: ChannelSettings;
  createdAt: number;
  updatedAt: number;
  /** Lists: how many episodes, and the newest finished one's poster. */
  episodes?: number;
  cover?: Generation | null;
}

export type EpisodeStatus = "writing" | "write-failed" | "review" | "rendering" | "done" | "failed";

export interface EpisodeScript {
  title?: string;
  blocks: ScriptBlock[];
  /** Written without an LLM (a demo-quality draft), and why. */
  offline?: boolean;
  note?: string;
  source: "ai" | "pasted";
}

/** A source the Explainer read: an image (a reference for the pictures), a document's text, or a summarised link. */
export type ExplainerSource = { kind: "image"; url: string; name?: string } | { kind: "text"; name: string; text: string } | { kind: "link"; url: string; title?: string; text: string };

export interface EpisodeChange {
  at: number;
  blocks: string[];
  part: ChangePart;
  instruction: string;
  costUsd: number | null;
}

export type StillEdits = Record<string, { source: string; instruction: string }>;

export interface EpisodePlan {
  batchId: string;
  /** Step key → the generation that made it (the current version). */
  ids: Record<string, string>;
  /** Picture edits the current version was made with. */
  stillEdits?: StillEdits;
  /** The version before the last change (Undo). */
  previous?: { ids: Record<string, string>; blocks: ScriptBlock[]; stillEdits?: StillEdits };
  /** The last finished film, shown while a change renders. */
  lastFinal?: string;
  changes: EpisodeChange[];
}

export interface FacelessEpisode {
  id: string;
  channelId: string | null;
  kind: "faceless" | "explainer";
  title: string;
  topic: string;
  status: EpisodeStatus;
  error: string | null;
  settings: EpisodeSettings;
  script: EpisodeScript;
  plan: EpisodePlan | null;
  sources: ExplainerSource[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StepView {
  key: string;
  part: StepPart;
  block?: number;
  label: string;
  generation: Generation | null;
}

export interface EpisodeView {
  episode: FacelessEpisode;
  channel: FacelessChannel | null;
  steps: StepView[];
  final: Generation | null;
  /** The previous finished film while a change renders. */
  previousFinal: Generation | null;
  /** 0–1 over every step. */
  progress: number;
  /** What the current version cost so far, and the render's estimate. */
  spentUsd: number;
  estimate: CostBreakdown | null;
}

/** One item in the Explainer's history or a channel's episode list. */
export interface EpisodeCard {
  id: string;
  channelId: string | null;
  kind: "faceless" | "explainer";
  title: string;
  status: EpisodeStatus;
  styleId: string;
  aspect: EpisodeAspect;
  seconds: number;
  favorite: boolean;
  poster: Generation | null;
  progress: number;
  createdAt: number;
}

export interface EstimateResult {
  estimate: CostBreakdown;
  demo: boolean;
  seconds: number;
  blocks: number;
  error?: string;
}

export interface ChangePreview {
  rerun: string[];
  labels: string[];
  costUsd: number | null;
  demo: boolean;
}
