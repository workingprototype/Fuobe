/**
 * Video tools → Remove object: say what goes by typing it ("the coffee cup"), clicking it on the first
 * frame, or painting over it. Higgsfield runs this as Edit Video with a removal prompt on Kling O3 Omni;
 * Fuobe adds Bria's clicked / masked eraser, VOID for shadows and reflections, and the open engine's
 * SAM 3.1 + Wan 2.1 VACE (or VOID) graphs.
 *
 * Every eraser takes a short clip (Bria under 5 s, Kling 3–15 s, VOID 197 frames, the open graphs 81 or
 * 197 frames per window), so longer clips are cut into pieces, erased and joined, and the clip's own sound
 * is put back. Pure module (erasers per engine and mode, pieces and windows, prompts, the pipeline's steps),
 * shared by the page, the server (src/server/remove-object.ts) and the tests.
 * Research: docs/research/higgsfield-delta-4.md §4.1, paid-model-apis-4.md §3 and §10, comfyui-oss-4.md §b.
 */
import { joinGroups, type PlanStep } from "./shorts";
import type { ChainSlot, Engine, GenerationRequest, PixelPoint } from "./types";

export type RemoveMode = "type" | "click" | "paint";

export const REMOVE = {
  feature: "remove-object",
  /** Cuts, mask tracks, joins and the sound: kept apart from the finished videos. */
  stepFeature: "remove-object-step",
  /** The mask preview (what the engine would remove from the first seconds). */
  previewFeature: "remove-object-preview",
  minSeconds: 0.5,
  maxSeconds: 60,
  maxBytes: 200 * 1024 * 1024,
  /** Seconds the mask preview looks at. */
  previewSeconds: 2,
  maxPoints: 12,
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export const REMOVE_MODES: { id: RemoveMode; label: string; hint: string }[] = [
  { id: "type", label: "Type it", hint: "Name what to remove" },
  { id: "click", label: "Click it", hint: "Click it on the first frame" },
  { id: "paint", label: "Paint it", hint: "Brush over it on the first frame" },
];

/** Higgsfield's two example prompts (verbatim) and two short ones. */
export const REMOVE_EXAMPLES: { label: string; prompt: string }[] = [
  { label: "The coffee cup", prompt: "Remove the coffee cup from her hands and fix her fingers so they're just resting naturally, keep everything else the same." },
  {
    label: "The pogo stick",
    prompt:
      "Remove the pogo stick the guy is bouncing on, including the black handle grips in his hands and the platform under his feet, plus its shadow on the ground — make him just jump in the air, and fill in the patio behind it.",
  },
  { label: "People in the background", prompt: "the people walking in the background" },
  { label: "A logo", prompt: "the logo in the corner" },
];

// ---------------------------------------------------------------------------
// Erasers

export interface Eraser {
  /** The catalog model. */
  id: string;
  engine: Engine;
  /** How you can point at the object with it. */
  modes: RemoveMode[];
  label: string;
  /** One line for the picker: what it's good at, its limits, and (open) the GPU and licence. */
  note: string;
  /** Cloud: the longest piece one call takes, in seconds (longer clips are cut, erased and joined). */
  maxSeconds?: number;
  /** Cloud: the longest piece in frames at the clip's own rate (VOID: 197). */
  maxFrames?: number;
  /** The shortest clip it takes, in seconds. */
  minSeconds?: number;
  /** Open: one job per window of frames: at most `cap`, `step`·n + `base` frames (VACE 4n+1 ≤ 81, VOID 8n+5 ≤ 197). */
  window?: FrameWindow;
  /** The result carries the piece's own sound (otherwise the clip's sound is put back). */
  keepsSound: boolean;
  /** Also removes what the object causes: shadows, reflections, things it moves. */
  effects?: boolean;
  /** Removes every person; nothing to point at. */
  everyone?: boolean;
  /** Each side of the picture must be within this many pixels (Kling O3 edit: 720–3840). */
  sides?: { min: number; max: number };
}

/**
 * Windows of `step`·n + `base` frames, at most `cap`. `overlap`: each window after the first starts on the last
 * `overlap` frames of the one before (dropped again before the join).
 */
export interface FrameWindow {
  cap: number;
  step: number;
  base: number;
  overlap?: number;
}

const VACE_WINDOW: FrameWindow = { cap: 81, step: 4, base: 1 };
/**
 * The painted eraser hands on the tracked mask of a window's last frame, and a mask must be of the window's first
 * frame: so each window starts on the last frame of the one before (a one-frame overlap, cut off before the join).
 */
const VACE_PAINTED_WINDOW: FrameWindow = { ...VACE_WINDOW, overlap: 1 };
const VOID_WINDOW: FrameWindow = { cap: 197, step: 8, base: 5 };
/** Bria's erasers take clips "shorter than 5 s": pieces stay a little under. */
const BRIA_PIECE = 4.8;

export const ERASERS: Eraser[] = [
  // Cloud (docs/research/paid-model-apis-4.md §3).
  {
    id: "kling-o3",
    engine: "cloud",
    modes: ["type"],
    label: "Kling O3 Omni edit",
    note: "Higgsfield's own route · 3–15 s per piece · sound kept",
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
  },
  {
    id: "kling-o3-4k-edit",
    engine: "cloud",
    modes: ["type"],
    label: "Kling O3 4K edit",
    note: "The same edit rendered in 4K · 3–15 s per piece · sound kept",
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
  },
  { id: "bria-video-erase", engine: "cloud", modes: ["type"], label: "Bria Video Eraser", note: "Finds what you name · pieces under 5 s · sound kept", maxSeconds: BRIA_PIECE, keepsSound: true },
  {
    id: "void-video-inpainting",
    engine: "cloud",
    modes: ["type"],
    label: "VOID",
    note: "Also removes its shadows and reflections · up to 197 frames per piece",
    maxFrames: 197,
    keepsSound: false,
    effects: true,
  },
  {
    id: "ltx-2-3-clean-plate",
    engine: "cloud",
    modes: ["type"],
    label: "LTX 2.3 Clean Plate",
    note: "Removes every person — no words needed · up to 6 s per piece",
    maxSeconds: 6,
    minSeconds: 0.5,
    keepsSound: false,
    everyone: true,
  },
  { id: "bria-video-erase-points", engine: "cloud", modes: ["click"], label: "Bria Video Eraser", note: "Erases what you click · SAM 3.1 follows it through clips over 5 s", maxSeconds: BRIA_PIECE, keepsSound: true },
  { id: "bria-video-erase-mask", engine: "cloud", modes: ["paint"], label: "Bria Video Eraser", note: "SAM 3.1 follows what you painted, Bria erases it · sound kept", maxSeconds: BRIA_PIECE, keepsSound: true },
  // Open (docs/research/comfyui-oss-4.md §b; workflows/comfyui/manifest.json).
  {
    id: "oss-vace-remove",
    engine: "open",
    modes: ["type"],
    label: "Wan 2.1 VACE + SAM 3.1",
    note: "Only the object's area changes · 24 GB GPU · Apache-2.0",
    window: VACE_WINDOW,
    keepsSound: true,
  },
  {
    id: "oss-vace-remove-painted",
    engine: "open",
    modes: ["paint"],
    label: "Wan 2.1 VACE + SAM 3.1",
    note: "SAM 3.1 follows what you painted · 24 GB GPU · Apache-2.0",
    window: VACE_PAINTED_WINDOW,
    keepsSound: true,
  },
  {
    id: "oss-void-remove",
    engine: "open",
    modes: ["type"],
    label: "VOID",
    note: "Also removes shadows and reflections · 24–40 GB GPU (unverified) · CogVideoX License: commercial use needs registration",
    window: VOID_WINDOW,
    keepsSound: true,
    effects: true,
  },
];

export const getEraser = (id: string | undefined) => ERASERS.find((e) => e.id === id);

/** The default eraser for a way of pointing (and "shadows and reflections too"), per engine. */
const DEFAULT_ERASER: Record<Engine, Partial<Record<RemoveMode | "effects", string>>> = {
  cloud: { type: "kling-o3", effects: "void-video-inpainting", click: "bria-video-erase-points", paint: "bria-video-erase-mask" },
  open: { type: "oss-vace-remove", effects: "oss-void-remove", paint: "oss-vace-remove-painted" },
};

/** The SAM 3.1 tracker that turns clicks or paint into a mask video (cloud). */
export const MASK_TRACKER = "sam-3-1-video-mask";

/** What the helpers of the pipeline run on, per engine. */
export const REMOVE_TOOLS = {
  cloud: { cut: "trim-video", join: "join-clips", mux: "merge-audio-video", joinMax: 24, preview: MASK_TRACKER },
  open: { cut: "oss-trim", join: "oss-join-clips", mux: "oss-mux", joinMax: 4, preview: "oss-video-matte-sam3" },
} as const;

/** What fills the gap when nobody describes it (the open graphs' scene prompt; fal's VOID route sends the same default). */
export const REMOVE_SCENE = "The same shot with nothing there: the background continues naturally, matching the light, texture and motion around it";

export const CLICK_OPEN_PROBLEM = "Clicking works on the cloud engine. On your ComfyUI, type what to remove or paint over it";

/** The erasers you can pick for this engine and way of pointing (the effects one only when typing). */
export function erasersFor(engine: Engine, mode: RemoveMode): Eraser[] {
  return ERASERS.filter((e) => e.engine === engine && e.modes.includes(mode));
}

/** The eraser a request runs on, or why there is none. */
export function chooseEraser(o: { engine: Engine; mode: RemoveMode; effects?: boolean; modelId?: string }): { eraser: Eraser } | { problem: string } {
  if (o.engine === "open" && o.mode === "click") return { problem: CLICK_OPEN_PROBLEM };
  if (o.effects && o.mode !== "type") return { problem: "Shadows and reflections go too when you type what to remove — switch to Type it" };
  const picked = getEraser(o.modelId);
  if (picked && picked.engine === o.engine && picked.modes.includes(o.mode) && (!o.effects || picked.effects)) return { eraser: picked };
  const id = DEFAULT_ERASER[o.engine][o.effects ? "effects" : o.mode];
  const eraser = getEraser(id);
  return eraser ? { eraser } : { problem: "Nothing on this engine removes objects that way yet" };
}

// ---------------------------------------------------------------------------
// Words

const VERB = /^\s*(?:please\s+)?(?:remove|erase|delete|get rid of|take out|cut out|clean up|wipe out|wipe)\s+/i;

/**
 * The object alone, for a segmenter or an eraser that finds things by name (SAM 3.1, Bria, VOID's mask
 * prompt): "Remove the coffee cup from her hands and fix her fingers…" → "the coffee cup".
 */
export function targetPhrase(text: string): string {
  const t = text.trim().replace(VERB, "");
  const stop = t.search(/\s+(?:from|in)\s+@video\d*|\s+from\s+|[,.;:!?—–(]|\s-\s|\s+(?:and|so|then|while|but|keep|keeping|leaving|to make|make)\s+/i);
  const out = (stop > 0 ? t.slice(0, stop) : t).replace(/\s+(?:from|in|out of)\s+(?:the\s+)?(?:video|clip|shot|footage|frame)$/i, "").trim();
  return (out || text.trim()).slice(0, 160);
}

/**
 * Kling O3's edit prompt: Higgsfield's "Remove {X} from @Video1, keep everything else the same" for a
 * named object; an instruction the user wrote ("Remove the cup and fix her fingers…") is kept, pointed at
 * @Video1 and told to leave the rest alone.
 */
export function klingPrompt(text: string): string {
  const t = text.trim().replace(/[.\s]+$/, "");
  if (!VERB.test(t)) return `Remove ${t} from @Video1, keep everything else the same.`;
  const keep = /keep everything else|everything else (?:stays|unchanged)/i.test(t) ? "" : ", keep everything else the same";
  return `${/@video1/i.test(t) ? "" : "In @Video1: "}${t}${keep}.`;
}

/** A short name for the result ("Remove · the coffee cup"). */
export function removalTitle(o: { mode: RemoveMode; prompt?: string; everyone?: boolean }): string {
  if (o.everyone) return "Remove · every person";
  if (o.mode === "type" && o.prompt?.trim()) {
    const p = targetPhrase(o.prompt);
    return `Remove · ${p.length > 60 ? `${p.slice(0, 57)}…` : p}`;
  }
  return o.mode === "click" ? "Remove · the clicked object" : "Remove · the painted object";
}

// ---------------------------------------------------------------------------
// Pieces and windows

export interface RemoveRange {
  start: number;
  end: number;
}

export interface Piece {
  index: number;
  /** Seconds in the source clip. */
  start: number;
  end: number;
  /** Open: the window's exact frame count, and the window as the graph reads it (startTime, endTime). */
  frames?: number;
  startTime?: number;
  endTime?: number;
  /** Open: frames at the window's start that the window before already made (cut off before the join). */
  skip?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Split `total` frames into windows of `step`·n + `base` frames, each at most `cap`, as even as possible
 * (the fewest windows that fit). The windows cover all but fewer than `step` frames at the end; with an
 * overlap, each window after the first also reads the last `overlap` frames of the one before.
 */
export function frameWindows(total: number, w: FrameWindow): number[] {
  if (total < w.base) return [];
  const o = w.overlap ?? 0;
  const k = Math.max(1, Math.ceil((total - o) / (w.cap - o)));
  const units = Math.floor((total + (k - 1) * o - k * w.base) / w.step);
  if (units < 0) return [];
  const each = Math.floor(units / k);
  const extra = units % k;
  return Array.from({ length: k }, (_, i) => w.step * (each + (i < extra ? 1 : 0)) + w.base);
}

/**
 * Open engine: windows on whole frames at the clip's own rate, back to back (or overlapping by `overlap`
 * frames, which are cut off again), so the joined clip has exactly the range's frames (less fewer than
 * `step` at the end) and stays on the original sound. Each window is read from `(f − ¼)/fps` for `n/fps`
 * seconds: the graph's Video Slice then decodes exactly frames f … f + n − 1, and a trim from
 * `(skip − ¼)/fps` drops exactly `skip` frames (both run on the live ComfyUI with 24, 29.97 and 30 fps clips).
 */
export function planWindows(range: RemoveRange, fps: number, w: FrameWindow): Piece[] {
  const first = Math.round(range.start * fps);
  const total = Math.floor((range.end - range.start) * fps + 1e-6);
  let at = first;
  return frameWindows(total, w).map((frames, index) => {
    const skip = index > 0 ? (w.overlap ?? 0) : 0;
    const from = at - skip;
    const startTime = Math.max(0, (from - 0.25) / fps);
    const piece: Piece = { index, start: r3(at / fps), end: r3((from + frames) / fps), frames, startTime: r6(startTime), endTime: r6(startTime + frames / fps) };
    if (skip) piece.skip = skip;
    at = from + frames;
    return piece;
  });
}

/**
 * Cloud: equal pieces of at most `max` seconds (on whole frames when the rate is known), so no piece is
 * a sliver (14 s for Bria → three 4.67 s pieces, not two of 4.8 s and one of 4.4 s… or a 0.4 s one).
 */
export function planCloudPieces(range: RemoveRange, max: number, fps?: number): Piece[] {
  const len = range.end - range.start;
  const n = Math.max(1, Math.ceil(len / max - 1e-9));
  const edge = (i: number) => {
    if (i === n) return range.end;
    const t = range.start + (len * i) / n;
    return fps ? Math.round(t * fps) / fps : t;
  };
  return Array.from({ length: n }, (_, i) => ({ index: i, start: r3(edge(i)), end: r3(edge(i + 1)) }));
}

/** The longest piece a cloud eraser takes for this clip. */
export function pieceSeconds(e: Eraser, fps?: number): number {
  const byFrames = e.maxFrames ? e.maxFrames / (fps && fps > 0 ? fps : 24) : Infinity;
  return Math.min(e.maxSeconds ?? Infinity, byFrames);
}

export interface RemoveSource {
  url: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

/** What's wrong with a selection whatever the eraser, or null. */
export function rangeProblem(source: Pick<RemoveSource, "duration">, range: RemoveRange): string | null {
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (source.duration !== undefined && range.end > source.duration + 0.05) return "The selection runs past the end of the clip";
  if (len < REMOVE.minSeconds - 0.01) return `Select at least ${REMOVE.minSeconds} s`;
  if (len > REMOVE.maxSeconds + 0.05) return `Select up to ${REMOVE.maxSeconds} s — longer clips cost a lot and take long; trim them in Video tools → Trim`;
  return null;
}

/** Why this eraser can't take this clip (or range), or null. */
export function removalProblem(e: Eraser, source: RemoveSource, range: RemoveRange): string | null {
  const general = rangeProblem(source, range);
  if (general) return general;
  const len = range.end - range.start;
  const name = e.label;
  if (e.minSeconds && len < e.minSeconds - 0.01) return `${name} needs at least ${e.minSeconds} s — ${e.engine === "cloud" ? "Bria Video Eraser takes shorter clips" : "select more"}`;
  if (e.sides && source.width && source.height) {
    const lo = Math.min(source.width, source.height);
    const hi = Math.max(source.width, source.height);
    if (lo < e.sides.min) return `${name} needs a clip at least ${e.sides.min} px on each side (this one is ${source.width}×${source.height}) — Bria Video Eraser takes smaller ones`;
    if (hi > e.sides.max) return `${name} takes clips up to ${e.sides.max} px on a side (this one is ${source.width}×${source.height})`;
  }
  if (e.window) {
    if (!source.fps) return "Couldn't read this clip's frame rate — save it as an MP4 (H.264) and try again";
    if (Math.floor(len * source.fps + 1e-6) < e.window.base) return "Select a little more of the clip";
  }
  return null;
}

/** The pieces a clip is erased in: windows on the open engine, equal cuts on the cloud. */
export function planPieces(e: Eraser, source: RemoveSource, range: RemoveRange): Piece[] {
  if (e.window) return source.fps ? planWindows(range, source.fps, e.window) : [];
  return planCloudPieces(range, pieceSeconds(e, source.fps), source.fps);
}

/** Whether the range is the whole clip (then the upload itself is the piece, and carries the sound). */
export function wholeClip(range: RemoveRange, duration?: number): boolean {
  return range.start <= 0.05 && duration !== undefined && range.end >= duration - 0.05;
}

// ---------------------------------------------------------------------------
// Painted masks → points for SAM 3.1 (cloud)

/**
 * Up to `max` points well inside a painted mask (`on[i]` true = painted, `width` × `height`), in its own
 * pixels: the deepest point of the paint, then the deepest one away from it, and so on. SAM 3.1 tracks
 * the object under them (fal's tracker takes points or boxes, not a painted mask).
 */
export function paintedPoints(on: ArrayLike<number | boolean>, width: number, height: number, max = 3): PixelPoint[] {
  const cell = Math.max(1, Math.ceil(Math.max(width, height) / 96));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  // A grid cell is paint when at least half its pixels are.
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0;
      let k = 0;
      for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y++) {
        for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x++) {
          n++;
          if (on[y * width + x]) k++;
        }
      }
      grid[gy * gw + gx] = n && k * 2 >= n ? 1 : 0;
    }
  }
  // Chamfer distance to the nearest unpainted cell (or the edge).
  const INF = 1e9;
  const d = new Float64Array(gw * gh);
  for (let i = 0; i < d.length; i++) d[i] = grid[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x]);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = gh - 1; y >= 0; y--)
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  const points: PixelPoint[] = [];
  const left = Float64Array.from(d);
  for (let p = 0; p < max; p++) {
    let best = -1;
    for (let i = 0; i < left.length; i++) if (left[i] > 0 && (best < 0 || left[i] > left[best])) best = i;
    if (best < 0 || (points.length && left[best] < 1)) break;
    const bx = best % gw;
    const by = Math.floor(best / gw);
    points.push({ x: Math.min(width - 1, Math.round((bx + 0.5) * cell)), y: Math.min(height - 1, Math.round((by + 0.5) * cell)), label: "positive" });
    // The next point is found away from this one (beyond the paint's thickness here).
    const r = Math.max(2, d[best] * 2);
    for (let y = Math.max(0, Math.floor(by - r)); y <= Math.min(gh - 1, Math.ceil(by + r)); y++)
      for (let x = Math.max(0, Math.floor(bx - r)); x <= Math.min(gw - 1, Math.ceil(bx + r)); x++) if ((x - bx) ** 2 + (y - by) ** 2 <= r * r) left[y * gw + x] = 0;
  }
  return points;
}

/** Points from one picture's pixels to another size (the first frame the browser showed → the clip's own size). */
export function scalePoints(points: PixelPoint[], from: { width: number; height: number }, to: { width: number; height: number }): PixelPoint[] {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  return points.map((p) => ({ ...p, x: Math.round(Math.min(to.width - 1, Math.max(0, p.x * kx))), y: Math.round(Math.min(to.height - 1, Math.max(0, p.y * ky))) }));
}

// ---------------------------------------------------------------------------
// The pipeline: steps for createPipeline (src/server/chains.ts)

export interface RemovalPlanInput {
  engine: Engine;
  mode: RemoveMode;
  eraser: Eraser;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  /** Type it: the user's words. */
  prompt?: string;
  /** Click it: points on the range's first frame, in the clip's pixels (paint on the cloud: points found in the paint). */
  points?: PixelPoint[];
  /** Paint it: the mask of the range's first frame (white = remove). */
  mask?: string;
  seed?: number;
}

export interface RemovalPlan {
  steps: PlanStep[];
  /** The finished video's step. */
  final: string;
  pieces: Piece[];
  /** Whether the clip's own sound is put back on the joined result. */
  sound: boolean;
  /** Cloud clicks and paint: a SAM 3.1 track of the whole range first. */
  tracked: boolean;
}

const pieceLabel = (p: Piece, n: number, what: string) => ({ label: n > 1 ? `Piece ${p.index + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: p.index, of: n });
const seconds = (p: Piece) => r3(p.end - p.start);

/** What the eraser step reads: the words, the clicks or the paint, in its own terms. */
function eraseRequest(input: RemovalPlanInput, p: Piece): Partial<GenerationRequest> {
  const e = input.eraser;
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const fps = input.source.fps ? { fps: input.source.fps } : {};
  if (e.engine === "open") {
    // The graph reads its own window; the words name what SAM 3.1 tracks (the provider makes them maskPrompt).
    return {
      prompt: e.modes.includes("type") ? targetPhrase(input.prompt ?? "") : undefined,
      params: { startTime: p.startTime, endTime: p.endTime, ...seed },
    };
  }
  // Seconds price per-second models; frame-count routes (VOID, LTX) read the piece's length and the clip's rate.
  const len = { duration: seconds(p), sourceDuration: seconds(p), ...fps };
  if (e.id === "kling-o3" || e.id === "kling-o3-4k-edit") return { prompt: klingPrompt(input.prompt ?? ""), params: { ...len, ...seed } };
  if (e.everyone) return { params: { ...len, generateAudio: false, ...seed } };
  if (e.modes.includes("type")) return { prompt: targetPhrase(input.prompt ?? ""), params: { ...len, ...seed } };
  // Bria's clicked eraser reads the points itself; the masked one gets SAM 3.1's track.
  return { params: { ...len, ...(e.id === "bria-video-erase-points" ? { points: input.points } : {}), ...seed } };
}

/**
 * The whole job, as steps for createPipeline:
 * - open: one window per job straight from the upload (the graph cuts its own window), the painted eraser
 *   handing the tracked object on from window to window (its last frame's mask);
 * - cloud: the range cut into pieces (trim), each erased; clicks and paint are first tracked by SAM 3.1 over
 *   the whole range, and the track is cut like the clip, so Bria gets a mask video for every piece;
 * - then the pieces are joined (folded when the join takes fewer clips) and the clip's own sound put back.
 */
export function planRemoval(input: RemovalPlanInput): RemovalPlan {
  const e = input.eraser;
  const t = REMOVE_TOOLS[input.engine];
  const pieces = planPieces(e, input.source, input.range);
  if (!pieces.length) throw new Error(removalProblem(e, input.source, input.range) ?? "Select a little more of the clip");
  const n = pieces.length;
  const whole = wholeClip(input.range, input.source.duration);
  const base = { feature: REMOVE.feature, batchTitle: input.title };
  const helper = { feature: REMOVE.stepFeature, batchTitle: input.title };
  const steps: PlanStep[] = [];
  const op = "remove-object" as const;
  const tracked = e.engine === "cloud" && (e.id === "bria-video-erase-mask" || (e.id === "bria-video-erase-points" && n > 1));
  const sound = !!input.source.hasAudio && (n > 1 || !e.keepsSound);
  const eraseFeature = (one: boolean) => (one && !sound ? { ...base, title: input.title } : helper);

  // What each piece's join input is: its erased window, or (an overlapping window) the window less its first frames.
  const joined = pieces.map((_, i) => `erase${i}`);
  if (e.engine === "open") {
    pieces.forEach((p, i) => {
      const own = eraseRequest(input, p);
      const painted = e.modes.includes("paint");
      steps.push({
        key: `erase${i}`,
        request: {
          ...eraseFeature(n === 1),
          modelId: e.id,
          op,
          ...own,
          inputs: { video: input.source.url, ...(painted && i === 0 && input.mask ? { mask: input.mask } : {}) },
          step: pieceLabel(p, n, "erase"),
        },
        // The painted eraser starts each window from where the last one left the object.
        ...(painted && i > 0 ? { after: [`erase${i - 1}`], chain: [{ slot: "mask" as const }] } : {}),
      });
      if (p.skip && input.source.fps) {
        // The frames the window before already made are cut off (a trim from (skip − ¼)/fps keeps the rest).
        steps.push({
          key: `keep${i}`,
          request: { ...helper, modelId: t.cut, op: "trim", params: { startTime: r6((p.skip - 0.25) / input.source.fps) }, step: pieceLabel(p, n, "drop the overlap") },
          after: [`erase${i}`],
          chain: [{ slot: "video" }],
        });
        joined[i] = `keep${i}`;
      }
    });
  } else {
    // The range itself, when SAM 3.1 has to see it from its first frame (the clicks and paint are on it).
    const cutRange = tracked && !whole;
    if (cutRange) {
      steps.push({ key: "range", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    }
    if (tracked) {
      const len = r3(input.range.end - input.range.start);
      steps.push({
        key: "track",
        request: {
          ...helper,
          modelId: MASK_TRACKER,
          op: "bg-remove-video",
          ...(cutRange ? {} : { inputs: { video: input.source.url } }),
          params: { points: input.points, duration: len },
          step: { label: "Follow the object (SAM 3.1)", index: 0, of: 1 },
        },
        ...(cutRange ? { after: ["range"], chain: [{ slot: "video" as const }] } : {}),
      });
    }
    pieces.forEach((p, i) => {
      const one = n === 1 && whole;
      const own = eraseRequest(input, p);
      const after: string[] = [];
      const chain: ChainSlot[] = [];
      if (n === 1 && cutRange) {
        // One piece: the selection already cut for SAM 3.1 is the piece.
        after.push("range");
        chain.push({ slot: "video" });
      } else if (!one) {
        steps.push({ key: `cut${i}`, request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: pieceLabel(p, n, "cut") } });
        after.push(`cut${i}`);
        chain.push({ slot: "video" });
      }
      if (tracked) {
        // The track starts at the range's start: its piece is cut at the same place, relative to it.
        if (n > 1) {
          const at = { startTime: r3(p.start - input.range.start), endTime: r3(p.end - input.range.start) };
          steps.push({ key: `mcut${i}`, request: { ...helper, modelId: t.cut, op: "trim", params: at, step: pieceLabel(p, n, "cut the mask") }, after: ["track"], chain: [{ slot: "video" }] });
          after.push(`mcut${i}`);
        } else after.push("track");
        chain.push({ slot: "mask" });
      }
      // Clicks on one short clip: Bria's own clicked eraser; clicks on a long one: the masked eraser on the track.
      const modelId = e.id === "bria-video-erase-points" && tracked ? "bria-video-erase-mask" : e.id;
      const params = { ...own.params };
      if (modelId !== e.id) delete params.points;
      steps.push({
        key: `erase${i}`,
        request: { ...eraseFeature(n === 1), modelId, op, ...own, params, ...(one ? { inputs: { video: input.source.url } } : {}), step: pieceLabel(p, n, "erase") },
        ...(after.length ? { after, chain } : {}),
      });
    });
  }

  // Join the pieces in order (folding when the join takes fewer clips than there are).
  let level = joined;
  let depth = 0;
  while (level.length > 1) {
    const groups = joinGroups(level.length, t.joinMax);
    const last = groups.length === 1;
    level = groups.map((g, gi) => {
      const after = g.map((i) => level[i]);
      const key = last ? "join" : `join-${depth}-${gi}`;
      steps.push({
        key,
        request: {
          ...(last && !sound ? { ...base, title: input.title } : helper),
          modelId: t.join,
          op: "concat",
          prompt: input.title,
          // The open join scales to one size: the clip's own shape at its own size.
          params: input.engine === "open" ? { aspectRatio: "auto", resolution: tierFor(input.source) } : {},
          step: { label: last ? "Join the pieces" : "Joining", index: 1000 + depth, of: 1000 },
        },
        after,
        chain: after.map(() => ({ slot: "videos" as const })),
      });
      return key;
    });
    depth++;
  }
  const picture = level[0];
  if (!sound) return { steps, final: picture, pieces, sound, tracked };

  // The clip's own sound under the erased picture: the upload (whole clip), or the range cut out of it.
  const after = [picture];
  const chain: ChainSlot[] = [{ slot: "video" }];
  const inputs: GenerationRequest["inputs"] = {};
  if (whole) inputs.audio = input.source.url;
  else {
    steps.push({ key: "sound", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Original sound", index: 1100, of: 1000 } } });
    after.push("sound");
    chain.push({ slot: "audio" });
  }
  steps.push({
    key: "final",
    request: { ...base, title: input.title, modelId: t.mux, op: "mux", ...(Object.keys(inputs).length ? { inputs } : {}), step: { label: "Put the sound back", index: 1200, of: 1000 } },
    after,
    chain,
  });
  return { steps, final: "final", pieces, sound, tracked };
}

/** The open join's size tier: the clip's own (480p, 720p or 1080p by its short side). */
export function tierFor(s: Pick<RemoveSource, "width" | "height">): string {
  const short = s.width && s.height ? Math.min(s.width, s.height) : 720;
  return short <= 540 ? "480p" : short <= 900 ? "720p" : "1080p";
}

// ---------------------------------------------------------------------------
// The mask preview: what the engine would remove, on the first seconds

export interface PreviewPlanInput {
  engine: Engine;
  mode: RemoveMode;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  prompt?: string;
  points?: PixelPoint[];
}

/**
 * A cheap look at the mask before paying for the removal: the first seconds of the range, segmented by
 * SAM 3.1 (cloud: a mask video of what you named, clicked or painted, about $0.02; open: the SAM 3 matte
 * graph's black-and-white matte of what you named, free). Null when the engine can't make one (open clicks; open
 * paint, whose painted overlay is its own preview).
 */
export function planMaskPreview(input: PreviewPlanInput): PlanStep[] | null {
  if (input.engine === "open" && input.mode !== "type") return null;
  const words = input.mode === "type" ? targetPhrase(input.prompt ?? "") : "";
  if (input.mode === "type" ? !words : !input.points?.length) return null;
  const t = REMOVE_TOOLS[input.engine];
  const end = r3(Math.min(input.range.end, input.range.start + REMOVE.previewSeconds));
  const helper = { feature: REMOVE.stepFeature, batchTitle: input.title };
  return [
    { key: "cut", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: end }, step: { label: "Cut the first seconds", index: 0, of: 2 } } },
    {
      key: "preview",
      request: {
        feature: REMOVE.previewFeature,
        batchTitle: input.title,
        title: `Mask preview · ${input.mode === "type" ? words : input.mode === "click" ? "clicked" : "painted"}`,
        modelId: t.preview,
        op: "bg-remove-video",
        ...(words ? { prompt: words } : {}),
        // The open graph's black-and-white matte (white = what goes), like the cloud's mask video.
        params: { ...(input.points?.length && !words ? { points: input.points } : {}), duration: r3(end - input.range.start), ...(input.engine === "open" ? { matteOutput: "matte" as const } : {}) },
        step: { label: "Mask preview", index: 1, of: 2 },
      },
      after: ["cut"],
      chain: [{ slot: "video" }],
    },
  ];
}
