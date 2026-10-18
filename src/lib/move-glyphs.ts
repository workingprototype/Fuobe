/**
 * A small line diagram of each camera move, drawn over a motion card's resting frame so a gallery
 * of moves reads at a glance (arrows for pans and cranes, an ellipse for orbits, nested frames for
 * a dolly zoom…) before any card plays. Pure data, safe on both sides.
 *
 * Glyphs are drawn in a 48 × 36 box (the card's 4:3), as stroke-only paths; dashed parts are the
 * "behind" half of an orbit or the reference line of a tilted frame.
 */
import type { CameraMove } from "./preset-cards";

export type MoveGlyph =
  | "zoom-in"
  | "zoom-out"
  | "crash-in"
  | "crash-out"
  | "push-in"
  | "pull-out"
  | "vertigo"
  | "yoyo"
  | "through"
  | "pan-left"
  | "pan-right"
  | "tilt-up"
  | "tilt-down"
  | "truck-left"
  | "truck-right"
  | "crane-up"
  | "crane-down"
  | "crane-over"
  | "orbit-left"
  | "orbit-right"
  | "orbit-360"
  | "turntable"
  | "overhead"
  | "roll"
  | "dutch"
  | "shake"
  | "fpv"
  | "rise"
  | "whip"
  | "static"
  | "time"
  | "focus"
  | "jump"
  | "impact"
  | "float";

export interface GlyphPart {
  d: string;
  dashed?: true;
}

/** Which diagram each camera move shows. */
export const MOVE_GLYPH: Record<CameraMove, MoveGlyph> = {
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  "optical-zoom": "zoom-in",
  "dolly-in": "push-in",
  "dolly-out": "pull-out",
  "super-dolly-in": "push-in",
  "super-dolly-out": "pull-out",
  "crash-in": "crash-in",
  "crash-out": "crash-out",
  "rapid-in": "crash-in",
  "rapid-out": "crash-out",
  "dolly-zoom-in": "vertigo",
  "dolly-zoom-out": "vertigo",
  yoyo: "yoyo",
  "through-in": "through",
  "through-out": "through",
  "earth-out": "zoom-out",
  "orbit-left": "orbit-left",
  "orbit-right": "orbit-right",
  "orbit-360": "orbit-360",
  "lazy-orbit": "orbit-right",
  "bullet-time": "orbit-360",
  turntable: "turntable",
  "crane-up": "crane-up",
  "crane-down": "crane-down",
  "crane-over": "crane-over",
  overhead: "overhead",
  "tilt-up": "tilt-up",
  "tilt-down": "tilt-down",
  "pan-left": "pan-left",
  "pan-right": "pan-right",
  "whip-pan": "whip",
  "truck-left": "truck-left",
  "truck-right": "truck-right",
  tracking: "truck-right",
  "double-dolly": "orbit-right",
  dutch: "dutch",
  roll: "roll",
  incline: "dutch",
  handheld: "shake",
  snorricam: "shake",
  pov: "shake",
  fpv: "fpv",
  "drone-rise": "rise",
  "road-rush": "crash-in",
  "robo-arm": "crane-over",
  static: "static",
  hyperlapse: "time",
  timelapse: "time",
  "slow-mo": "time",
  "rack-focus": "focus",
  "low-shutter": "whip",
  spin: "roll",
  jump: "jump",
  "slide-left": "truck-left",
  "slide-right": "truck-right",
  impact: "impact",
  float: "float",
};

const r = (n: number) => Math.round(n * 100) / 100;

/** An arrowhead whose tip is at (x, y), pointing along `deg` (0 = right, 90 = down). */
function head(x: number, y: number, deg: number, size = 3.4): string {
  const a = (deg * Math.PI) / 180;
  const wing = (s: number) => `${r(x - size * Math.cos(a + s))} ${r(y - size * Math.sin(a + s))}`;
  return `M${wing(0.55)} L${r(x)} ${r(y)} L${wing(-0.55)}`;
}

/** A straight arrow from (x1, y1) to (x2, y2). */
function arrow(x1: number, y1: number, x2: number, y2: number, size?: number): string {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return `M${x1} ${y1} L${x2} ${y2} ${head(x2, y2, deg, size)}`;
}

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
/** The four corner arrows of a zoom, pointing in (to the inner frame) or out (from it). */
const corners = (inward: boolean, from = 6, to = 13.5) => {
  const pts: [number, number, number, number][] = [
    [from, from * 0.75, to, to * 0.75],
    [48 - from, from * 0.75, 48 - to, to * 0.75],
    [from, 36 - from * 0.75, to, 36 - to * 0.75],
    [48 - from, 36 - from * 0.75, 48 - to, 36 - to * 0.75],
  ];
  return pts.map(([a, b, c, d]) => (inward ? arrow(a, b, c, d, 3) : arrow(c, d, a, b, 3))).join(" ");
};
const INNER = rect(16, 12, 16, 12);
const DOT = "M24 18 m-1.2 0 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0";
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${r(48 - Number(x))} ${y}`);
const flipY = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${x} ${r(36 - Number(y))}`);

const PAN_LEFT = `M37 23 Q24 13 11 23 ${head(11, 23, 152)}`;
const TILT_UP = `M20 29 Q31 18 20 7 ${head(20, 7, -118)}`;
// (Only absolute x y pairs here: mirror() flips them.)
const TRUCK_LEFT = `${arrow(37, 15, 11, 15)} M8 24 L40 24 M12 24 L12 27 M20 24 L20 27 M28 24 L28 27 M36 24 L36 27`;
const ORBIT_FRONT = `M8 19 A16 6.5 0 0 0 40 19`;
const ORBIT_BACK = `M40 19 A16 6.5 0 0 0 8 19`;

/** Stroke paths per glyph, in a 48 × 36 box. */
export const GLYPHS: Record<MoveGlyph, GlyphPart[]> = {
  "zoom-in": [{ d: INNER, dashed: true }, { d: corners(true) }],
  "zoom-out": [{ d: INNER }, { d: corners(false) }],
  "crash-in": [{ d: INNER, dashed: true }, { d: corners(true, 4, 14) }, { d: corners(true, 4, 10) }],
  "crash-out": [{ d: INNER }, { d: corners(false, 4, 14) }, { d: corners(false, 8, 14) }],
  "push-in": [{ d: "M9 32 L19 11 M39 32 L29 11" }, { d: arrow(24, 30, 24, 9) }],
  "pull-out": [{ d: "M9 32 L19 11 M39 32 L29 11" }, { d: arrow(24, 10, 24, 31) }],
  vertigo: [{ d: rect(5, 4, 38, 28) }, { d: rect(12.5, 9.5, 23, 17), dashed: true }, { d: rect(19, 14.5, 10, 7) }],
  yoyo: [{ d: INNER, dashed: true }, { d: `${arrow(10, 7.5, 15, 11.25, 2.6)} ${head(6, 4.5, -143, 2.6)} M6 4.5 L10 7.5` }, { d: mirror(`${arrow(10, 7.5, 15, 11.25, 2.6)} ${head(6, 4.5, -143, 2.6)} M6 4.5 L10 7.5`) }],
  through: [{ d: "M26 9 a5 9 0 1 0 0.01 0" }, { d: arrow(6, 18, 43, 18) }],
  "pan-left": [{ d: PAN_LEFT }, { d: "M24 27 v4 M20 31 h8" }],
  "pan-right": [{ d: mirror(PAN_LEFT) }, { d: "M24 27 v4 M20 31 h8" }],
  "tilt-up": [{ d: TILT_UP }, { d: "M14 18 h-4" }],
  "tilt-down": [{ d: flipY(TILT_UP) }, { d: "M14 18 h-4" }],
  "truck-left": [{ d: TRUCK_LEFT }],
  "truck-right": [{ d: mirror(TRUCK_LEFT) }],
  "crane-up": [{ d: arrow(24, 28, 24, 6) }, { d: "M16 31 H32" }],
  "crane-down": [{ d: arrow(24, 6, 24, 27) }, { d: "M16 31 H32" }],
  "crane-over": [{ d: `M9 30 C9 2 39 2 39 26 ${head(39, 26, 90)}` }, { d: DOT }],
  "orbit-left": [{ d: ORBIT_BACK, dashed: true }, { d: `${ORBIT_FRONT} ${head(8, 19, 200)}` }, { d: DOT }],
  "orbit-right": [{ d: ORBIT_BACK, dashed: true }, { d: `${ORBIT_FRONT} ${head(40, 19, -20)}` }, { d: DOT }],
  "orbit-360": [{ d: `${ORBIT_FRONT} ${ORBIT_BACK.replace("M40 19", "")} ${head(40, 19, -20)}` }, { d: DOT }, { d: "M24 8 V13", dashed: true }],
  turntable: [{ d: `M10 27 A14 4.5 0 0 0 38 27 ${head(38, 27, -20, 3)}` }, { d: "M38 27 A14 4.5 0 0 0 10 27", dashed: true }, { d: "M24 6 V27" }],
  overhead: [{ d: "M24 7 a11 11 0 1 0 0.01 0" }, { d: "M24 3 V9 M24 27 V33 M9 18 H15 M33 18 H39" }, { d: DOT }],
  roll: [{ d: `M33.5 13 A11 11 0 1 0 34.5 21 ${head(34.5, 21, 105)}` }, { d: "M17 18 H31", dashed: true }],
  dutch: [{ d: "M8.5 11.3 L37.8 6.1 L39.5 24.7 L10.2 29.9 Z" }, { d: "M6 18 H42", dashed: true }],
  shake: [{ d: "M7 19 L11 13 L15 23 L19 12 L23 24 L27 13 L31 22 L35 14 L39 20 L42 17" }],
  fpv: [{ d: `M7 29 C17 29 15 10 27 10 S38 19 42 13 ${head(42, 13, -52)}` }],
  rise: [{ d: arrow(13, 28, 36, 8) }, { d: "M7 31 H22" }],
  whip: [{ d: arrow(12, 18, 42, 18) }, { d: "M5 12 H24 M8 24 H22", dashed: true }],
  static: [{ d: rect(17, 5, 14, 9) }, { d: "M24 14 V21 M24 21 L15 32 M24 21 L33 32 M24 21 V32" }],
  time: [{ d: "M24 6 a12 12 0 1 0 0.01 0" }, { d: "M24 18 V10 M24 18 L30 21.5" }],
  focus: [{ d: "M18 10 a8 8 0 1 0 0.01 0" }, { d: "M30 10 a8 8 0 1 0 0.01 0", dashed: true }],
  jump: [{ d: `M11 29 Q24 -1 37 29 ${head(37, 29, 66)}` }, { d: "M6 32 H42" }],
  impact: [
    {
      d: Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        return `M${r(24 + 6 * Math.cos(a))} ${r(18 + 6 * Math.sin(a))} L${r(24 + 13 * Math.cos(a))} ${r(18 + 13 * Math.sin(a))}`;
      }).join(" "),
    },
    { d: DOT },
  ],
  float: [{ d: `M20 31 C28 26 16 21 24 16 S28 9 24 5 ${head(24, 5, -105)}` }],
};

export const glyphFor = (move: CameraMove): GlyphPart[] => GLYPHS[MOVE_GLYPH[move]];
