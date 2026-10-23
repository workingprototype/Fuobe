import type { FocusPoint } from "@/lib/catalog/types";

/**
 * Ken Burns moves over a still (Faceless / Explainer "Frame by frame"): a slow zoom and pan, planned per scene
 * and sent as params.zoomFrom / zoomTo, panFrom / panTo and easing (op still-motion).
 *
 * - Open engine (kenburns-still): a real zoom and pan. The crop centre is a fraction of the still, kept where
 *   the crop stays inside it, at most 10 s per job: longer scenes are split into pieces that continue the
 *   same move (linear, so the speed doesn't dip at a seam) and joined.
 * - Cloud (fal workflow-utilities image-to-video): a zoom only, which always starts (zooming in) or ends
 *   (zooming out) on the whole picture, toward a focal point. Pans become a zoom toward the side they head
 *   for, and scenes alternate in and out.
 *
 * Which move: the scene's motion words when they name one ("zoom out to reveal…", "pan left across…"), else
 * the next in a cycle; where it heads: the place the words name ("towards the tower on the left"), else
 * one of a few focal points near the thirds. Plain data (docs/research/comfyui-oss-4.md §d presets).
 */

export type MoveKind = "push-in" | "pull-out" | "pan-left" | "pan-right" | "tilt-up" | "tilt-down";

export interface KenBurnsMove {
  kind: MoveKind;
  /** 1 = the whole picture (the widest crop with the output's shape), 1.2 = 20 % closer. */
  zoomFrom: number;
  zoomTo: number;
  /** The crop's centre at the start and the end (0–1 of the still). */
  panFrom: FocusPoint;
  panTo: FocusPoint;
  easing: "linear" | "ease-in-out";
}

/** The moves scenes take in turn when their words name none: zoom and pan on the open engine… */
export const OPEN_CYCLE: MoveKind[] = ["push-in", "pan-right", "pull-out", "tilt-up", "pan-left", "push-in", "tilt-down", "pull-out"];
/** …in and out on the cloud. */
export const CLOUD_CYCLE: MoveKind[] = ["push-in", "pull-out"];

/** Where a move heads when the words place nothing: near the thirds, a little above the middle (where faces and subjects sit). */
export const FOCI: FocusPoint[] = [
  { x: 0.5, y: 0.42 },
  { x: 0.36, y: 0.44 },
  { x: 0.64, y: 0.44 },
  { x: 0.44, y: 0.58 },
  { x: 0.58, y: 0.38 },
];

const CENTRE: FocusPoint = { x: 0.5, y: 0.5 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
// Rounded toward the middle, so a point at the edge of the room stays inside it.
const inward = (v: number, k: number) => (v > 0.5 ? Math.floor(v * k + 1e-6) : Math.ceil(v * k - 1e-6)) / k;
/** Three decimals for a whole move; five for the pieces of a split one (a frame's step is well under 0.001). */
const pt = (p: FocusPoint, k = 1000): FocusPoint => ({ x: inward(p.x, k), y: inward(p.y, k) });

/** The move the words ask for, if any. */
export function readMove(text: string): MoveKind | null {
  const t = ` ${text.toLowerCase()} `;
  // Camera words only: "smoke rising" is not a tilt.
  if (/\b(zoom(s|ing)? out|pull(s|ing)?[- ](back|out|away)|dolly(ing)? out|widen(s|ing)?|reveal(s|ing)?|draw(s|ing)? back)\b/.test(t)) return "pull-out";
  if (/\b(zoom(s|ing)? in|push(es|ing)?[- ]in|push(es|ing)? (slowly |gently )?(towards?|closer|into)|dolly(ing)? in|clos(e|es|ing) in|(camera|it) moves? (in|closer))\b/.test(t)) return "push-in";
  if (/\bpan(s|ning)? (slowly |gently )?(to the |towards? the )?left\b|\bright[- ]to[- ]left\b|\bleftwards?\b/.test(t)) return "pan-left";
  if (/\bpan(s|ning)? (slowly |gently )?(to the |towards? the )?right\b|\bleft[- ]to[- ]right\b|\brightwards?\b/.test(t)) return "pan-right";
  if (/\b(tilt(s|ing)?|crane(s|ing)?|pan(s|ning)?) (slowly |gently )?up(wards?)?\b|\bcamera (rises|rising|moves up)\b/.test(t)) return "tilt-up";
  if (/\b(tilt(s|ing)?|crane(s|ing)?|pan(s|ning)?) (slowly |gently )?down(wards?)?\b|\bcamera (descends|descending|moves down)\b/.test(t)) return "tilt-down";
  if (/\b(pan(s|ning)?|tracking shot|track(s|ing)? across)\b/.test(t)) return "pan-right";
  return null;
}

/**
 * A place the words name ("on the left", "the upper right corner", "the sky", "in the foreground"), as a
 * focal point; null when they name none. "Left" alone is not a place ("the army left the city").
 */
export function focusFromText(text: string): FocusPoint | null {
  const t = ` ${text.toLowerCase()} `;
  const side = /\b(the |its |far )(upper |lower |top |bottom |far )?(left|right)\b|\b(upper|lower|top|bottom)[- ](left|right)\b|\b(left|right)(-hand)? (side|corner|edge|half)\b/.exec(t);
  const word = side?.[0].includes("left") ? "left" : side?.[0].includes("right") ? "right" : null;
  const up = /\b(upper|top|the sky|skies|overhead|above|ceiling|treetops|rooftops?|mountaintop|summit)\b/.test(t);
  const down = /\b(lower|bottom|the ground|the floor|foreground|below|underground|at (his|her|their) feet)\b/.test(t);
  if (!word && up === down) return null;
  return { x: word === "left" ? 0.33 : word === "right" ? 0.67 : 0.5, y: up && !down ? 0.34 : down && !up ? 0.64 : 0.45 };
}

/** How far a crop centre can move from the middle at a zoom (the crop must stay inside the still). */
const room = (zoom: number) => Math.max(0, 0.5 - 0.5 / zoom);
const inside = (p: FocusPoint, zoom: number): FocusPoint => {
  const r = room(zoom);
  return pt({ x: clamp(p.x, 0.5 - r, 0.5 + r), y: clamp(p.y, 0.5 - r, 0.5 + r) });
};

/** How much closer a scene of this length gets: slow, about 2.5 % a second, between 8 % and 25 %. */
export const zoomAmount = (seconds: number) => r3(clamp(0.025 * seconds, 0.08, 0.25));

/** Pans and tilts toward a side become a zoom toward it when only zooms are possible (cloud). */
const SIDE: Partial<Record<MoveKind, Partial<FocusPoint>>> = { "pan-left": { x: 0.3 }, "pan-right": { x: 0.7 }, "tilt-up": { y: 0.3 }, "tilt-down": { y: 0.7 } };

/**
 * One scene's move over `seconds`. Zooms start or end on the whole picture with the centre heading for the
 * focal point; pans and tilts hold a zoom that leaves room and cross as far as the crop can go. With
 * `zoomOnly` (cloud) a pan becomes a push-in toward the side it heads for.
 */
export function kenBurnsMove(kind: MoveKind, focus: FocusPoint, seconds: number, o: { zoomOnly?: boolean } = {}): KenBurnsMove {
  const d = zoomAmount(seconds);
  if (o.zoomOnly && SIDE[kind]) return { ...kenBurnsMove("push-in", { ...focus, ...SIDE[kind] }, seconds), kind };
  const easing = "ease-in-out" as const;
  if (kind === "push-in" || kind === "pull-out") {
    const z = r3(1 + d);
    const at = inside(focus, z);
    return kind === "push-in" ? { kind, zoomFrom: 1, zoomTo: z, panFrom: CENTRE, panTo: at, easing } : { kind, zoomFrom: z, zoomTo: 1, panFrom: at, panTo: CENTRE, easing };
  }
  // A pan needs some zoom to have room to move: at least 12 % closer.
  const z = r3(1 + Math.max(d, 0.12));
  const r = room(z);
  const f = inside(focus, z);
  const from = kind === "pan-left" ? { x: 0.5 + r, y: f.y } : kind === "pan-right" ? { x: 0.5 - r, y: f.y } : kind === "tilt-up" ? { x: f.x, y: 0.5 + r } : { x: f.x, y: 0.5 - r };
  const to = kind === "pan-left" ? { x: 0.5 - r, y: f.y } : kind === "pan-right" ? { x: 0.5 + r, y: f.y } : kind === "tilt-up" ? { x: f.x, y: 0.5 - r } : { x: f.x, y: 0.5 + r };
  return { kind, zoomFrom: z, zoomTo: z, panFrom: pt(from), panTo: pt(to), easing };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frames a second Faceless renders its Ken Burns clips at (the cloud's minimum; the open graph takes any). */
export const KEN_BURNS_FPS = 24;

/**
 * A move cut into pieces of these lengths that play one after another as one move at one speed (linear). A
 * clip shows its move's start on its first frame and its end on its last, so the pieces are cut between
 * frames: piece k runs from the move's frame s to frame s + n − 1 of all N frames (n = its seconds × fps),
 * and the next piece starts one frame-step on: no frame repeats at a seam. One piece keeps the move (eased).
 */
export function splitMove(move: KenBurnsMove, pieces: number[], fps = KEN_BURNS_FPS): KenBurnsMove[] {
  if (pieces.length <= 1) return [move];
  const frames = pieces.map((secs) => Math.max(2, Math.round(secs * fps)));
  const last = frames.reduce((a, b) => a + b, 0) - 1;
  const at = (k: number) => ({ zoom: Math.round(lerp(move.zoomFrom, move.zoomTo, k) * 1e5) / 1e5, pan: pt({ x: lerp(move.panFrom.x, move.panTo.x, k), y: lerp(move.panFrom.y, move.panTo.y, k) }, 1e5) });
  let first = 0;
  return frames.map((n) => {
    const [s, e] = [at(first / last), at((first + n - 1) / last)];
    first += n;
    return { kind: move.kind, zoomFrom: s.zoom, zoomTo: e.zoom, panFrom: s.pan, panTo: e.pan, easing: "linear" as const };
  });
}

/** The reverse move (the camera goes back the way it came). */
export const reverseMove = (m: KenBurnsMove): KenBurnsMove => ({ ...m, kind: m.kind === "push-in" ? "pull-out" : m.kind === "pull-out" ? "push-in" : m.kind, zoomFrom: m.zoomTo, zoomTo: m.zoomFrom, panFrom: m.panTo, panTo: m.panFrom });

/**
 * Pieces of a scene when only whole-picture zooms are possible (cloud, over its 30 s per job): in, then back
 * out to the same focal point, and so on, so each piece starts where the last one ended.
 */
export function zoomOnlyPieces(move: KenBurnsMove, pieces: number[]): KenBurnsMove[] {
  return pieces.map((_, i) => (i % 2 === 0 ? move : reverseMove(move)));
}

export interface SceneMoveInput {
  /** The scene's motion words, its picture's description, and its place in the film. */
  motion: string;
  visual: string;
  index: number;
  /** The clip lengths the scene is made of (one per job). */
  pieces: number[];
  /** Whole-picture zooms only (cloud). */
  zoomOnly?: boolean;
  /** Motion words that say nothing about this scene (a default the script starts every scene with). */
  ignore?: string;
  fps?: number;
}

/** The moves of a scene's clips: its own words' move (or the cycle's), toward the place they name (or a focal point), split per clip. */
export function sceneMoves(s: SceneMoveInput): KenBurnsMove[] {
  const own = s.motion.trim() && s.motion.trim() !== s.ignore ? s.motion : "";
  const cycle = s.zoomOnly ? CLOUD_CYCLE : OPEN_CYCLE;
  const kind = readMove(own) ?? cycle[s.index % cycle.length];
  const focus = focusFromText(own) ?? focusFromText(s.visual) ?? FOCI[s.index % FOCI.length];
  const move = kenBurnsMove(kind, focus, s.pieces.reduce((a, b) => a + b, 0), { zoomOnly: s.zoomOnly });
  return s.zoomOnly ? zoomOnlyPieces(move, s.pieces) : splitMove(move, s.pieces, s.fps);
}

/** Where a point is, in words ("the upper left", "the centre"). */
export function placeWords(p: FocusPoint): string {
  const v = p.y < 0.46 ? "upper" : p.y > 0.54 ? "lower" : "";
  const h = p.x < 0.46 ? "left" : p.x > 0.54 ? "right" : "";
  return v || h ? `the ${[v, h].filter(Boolean).join(" ")}` : "the centre";
}

/** "Slow push-in toward the upper left" (a step's description; the providers take the numbers). */
export function describeMove(m: KenBurnsMove): string {
  if (m.kind === "push-in") return `Slow push-in toward ${placeWords(m.panTo)}`;
  if (m.kind === "pull-out") return `Slow pull-out from ${placeWords(m.panFrom)}`;
  return `Slow ${m.kind.startsWith("pan") ? "pan" : "tilt"} ${m.kind.split("-")[1]}`;
}
