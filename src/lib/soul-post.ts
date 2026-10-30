/**
 * Fuobe Soul's post steps (research §4.4), the part that runs in the browser when a result arrives: Soul Cinema's
 * 21:9 crop (§4.5), the look's grade (src/lib/grade.ts presets, WebGL) and the text or frame some looks add, which
 * diffusion draws badly (a camera's date stamp, a CCTV caption, a photo-booth print). Pure: the layout of what to draw, and which
 * outputs still need it. src/components/studio/soul-finish.ts draws it; the server keeps the finished picture
 * (POST /api/generations/<id>/finish) and the original beside it (meta.original).
 */
import type { Generation, OutputFile } from "@/lib/catalog/types";

export type SoulOverlay = "date-stamp" | "cctv" | "photo-booth";

/** What an output asks for after generation (the server writes it as meta when the job succeeds). */
export interface FinishSteps {
  /** Soul Cinema's 21:9: the 16:9 picture's middle band. */
  crop?: "21:9";
  grade?: string;
  overlay?: SoulOverlay;
}

const OVERLAYS = new Set<SoulOverlay>(["date-stamp", "cctv", "photo-booth"]);

/** The steps one output still needs (none once it is finished, or for anything but an image). */
export function finishSteps(o: Pick<OutputFile, "kind" | "meta">): FinishSteps | null {
  if (o.kind !== "image" || !o.meta || o.meta.finished) return null;
  const crop = o.meta.crop === "21:9" ? ("21:9" as const) : undefined;
  const grade = typeof o.meta.grade === "string" && o.meta.grade ? o.meta.grade : undefined;
  const overlay = OVERLAYS.has(o.meta.overlay as SoulOverlay) ? (o.meta.overlay as SoulOverlay) : undefined;
  return crop || grade || overlay ? { ...(crop && { crop }), ...(grade && { grade }), ...(overlay && { overlay }) } : null;
}

/** The crop of a `width` × `height` picture to an aspect ratio ("21:9"): the full width, the middle band (or the reverse). */
export function cropRect(width: number, height: number, aspect: string): { x: number; y: number; width: number; height: number } {
  const [a, b] = aspect.split(":").map(Number);
  const want = a / b;
  if (!(want > 0) || !(width > 0) || !(height > 0)) return { x: 0, y: 0, width, height };
  if (width / height > want) {
    const w = Math.round(height * want);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / want);
  return { x: 0, y: Math.round((height - h) / 2), width, height: h };
}

/**
 * A picked output's URL now: the finished picture's when `url` was its raw one (meta.original: a pick made before the
 * grade and crop were applied), else `url`.
 */
export function finishedUrl(gens: Pick<Generation, "outputs">[], url: string): string {
  for (const g of gens) for (const o of g.outputs) if (o.url === url || o.meta?.original === url) return o.url;
  return url;
}

/** Which outputs of a finished job still need their post steps (indexes into outputs). */
export function outputsToFinish(g: Pick<Generation, "status" | "outputs" | "provider">): number[] {
  if (g.status !== "succeeded") return [];
  return g.outputs.flatMap((o, i) => (finishSteps(o) ? [i] : []));
}

export type OverlayText = {
  text: string;
  /** Position in the output picture's pixels. */
  x: number;
  y: number;
  size: number;
  color: string;
  align: "left" | "right" | "center";
  baseline: "top" | "bottom" | "middle";
  font: "mono" | "serif";
  /** A soft glow (an LCD date stamp) or a shadow for legibility. */
  glow?: string;
};

export interface OverlayLayout {
  /** The finished picture's size (a photo-booth print is bigger than the photo). */
  width: number;
  height: number;
  /** Where the photo goes in it. */
  photo: { x: number; y: number };
  /** The print's paper, when there is one. */
  paper?: string;
  texts: OverlayText[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * What an overlay draws on a `width` × `height` picture made at `when`:
 * - date-stamp: an orange LCD date bottom right ('26 10 25), as a 2000s point-and-shoot printed it;
 * - cctv: a camera number top left, the date and time top right, a REC mark bottom left;
 * - photo-booth: a white print border with a deeper bottom edge and the date on it.
 */
export function overlayLayout(kind: SoulOverlay, width: number, height: number, when: Date): OverlayLayout {
  const short = Math.min(width, height);
  const yy = pad(when.getFullYear() % 100);
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  if (kind === "date-stamp") {
    const size = Math.round(short * 0.045);
    const m = Math.round(short * 0.045);
    return {
      width,
      height,
      photo: { x: 0, y: 0 },
      texts: [{ text: `’${yy} ${pad(when.getMonth() + 1)} ${pad(when.getDate())}`, x: width - m, y: height - m, size, color: "#FF9A2E", align: "right", baseline: "bottom", font: "mono", glow: "rgba(255,120,20,0.85)" }],
    };
  }
  if (kind === "cctv") {
    const size = Math.round(short * 0.034);
    const m = Math.round(short * 0.035);
    const shadow = "rgba(0,0,0,0.9)";
    const time = `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
    return {
      width,
      height,
      photo: { x: 0, y: 0 },
      texts: [
        { text: "CAM 03", x: m, y: m, size, color: "#F4F4F4", align: "left", baseline: "top", font: "mono", glow: shadow },
        { text: `${date}  ${time}`, x: width - m, y: m, size, color: "#F4F4F4", align: "right", baseline: "top", font: "mono", glow: shadow },
        { text: "● REC", x: m, y: height - m, size, color: "#FF3B30", align: "left", baseline: "bottom", font: "mono", glow: shadow },
      ],
    };
  }
  // A photo-booth print: an even border, a deeper bottom edge with the date on it.
  const border = Math.round(short * 0.05);
  const bottom = Math.round(short * 0.16);
  const W = width + border * 2;
  const H = height + border + bottom;
  return {
    width: W,
    height: H,
    photo: { x: border, y: border },
    paper: "#F5F2EA",
    texts: [{ text: `PHOTO BOOTH · ${date}`, x: W / 2, y: height + border + bottom / 2, size: Math.round(short * 0.032), color: "#6B6459", align: "center", baseline: "middle", font: "serif" }],
  };
}
