/**
 * Layers studio (Higgsfield Layers): the layer document, its geometry, the downloads and the edit
 * history. Pure, so the editor, the server and the tests share it; no catalog import (the editor gets
 * model names and prices from its page).
 *
 * A project is one source image plus versions of a {@link LayerDoc}. Each layer is an image file
 * placed on the document: `x, y, w, h` in document pixels (the source image's own pixels), rotated
 * clockwise around its centre, showing the `crop` part of its image (all of it when unset).
 * Full-canvas RGBA layers (Qwen-Image-Layered) are cropped to their alpha box, so selection handles
 * hug what you see.
 */

export type Box = [x: number, y: number, w: number, h: number];

/** One version of a layer's pixels: switch between them in the Layers panel. */
export interface LayerRevision {
  /** Asset URL (/api/files/…), as everywhere in Fuobe (the server's readRef takes it). */
  src: string;
  /** The part of the image the layer shows (image px); null = the whole image. */
  crop?: Box | null;
  /** The image's pixel size. */
  natural?: [number, number];
  label: string;
  prompt?: string;
  at: number;
}

export interface LayerNode {
  id: string;
  name: string;
  /** Stacking order, 0 = bottom; always the node's index after {@link normalize}. */
  z: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise around the centre. */
  rotation: number;
  /** The image (asset URL) this layer shows: the active revision's. */
  src: string;
  crop?: Box | null;
  natural?: [number, number];
  hidden?: boolean;
  /** 0–1 (1 when unset). */
  opacity?: number;
  /** Visibility mask (asset URL, PNG): its alpha is stretched over the layer box; transparent = hidden. */
  maskSrc?: string;
  /** Soft edge in document pixels (a regional edit's “Mask feather”). */
  feather?: number;
  /** The last “Layer edit prompt” and reference image. */
  prompt?: string;
  refSrc?: string;
  revisions: LayerRevision[];
  /** Index of the active revision. */
  revision: number;
  /** A regional edit's pair: the region as it was, and the edited one. */
  role?: "original" | "new";
}

export interface LayerDoc {
  v: 1;
  width: number;
  height: number;
  /** The image the project was opened on (Compare's “before”). */
  source: string;
  /** “An image can only be decomposed once”: set after the first decomposition lands. */
  decomposed: boolean;
  nodes: LayerNode[];
}

// ---------------------------------------------------------------------------
// Projects, versions and jobs as the API returns them

export type LayerTool =
  | "decompose"
  | "split"
  | "regenerate"
  | "generate-layer"
  | "text-detect"
  | "text-edit"
  | "bg-remove"
  | "regional"
  | "upscale"
  | "relight"
  | "angles"
  | "expand";

export interface LayerProject {
  id: string;
  name: string;
  sourceUrl: string;
  coverUrl: string;
  width: number;
  height: number;
  /** Layers in the newest version. */
  layers: number;
  /** "processing" while a decomposition runs, "failed" when the only one failed. */
  status: "ready" | "processing" | "failed";
  createdAt: number;
  updatedAt: number;
}

export interface LayerVersion {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

/** What a finished generation hands back (a slice of Generation, so the editor needs no catalog). */
export interface LayerJobResult {
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number | null;
  message: string | null;
  error: string | null;
  provider: string;
  outputs: { url: string; kind: string; meta?: Record<string, unknown>; width?: number; height?: number }[];
}

export interface LayerJob {
  id: string;
  tool: LayerTool;
  /** “Separating Subject”, “Upscale”, ““SALE” → “OPEN””. */
  label: string;
  /** The layer it works on (none = the whole image). */
  nodeId?: string;
  /** Where its input sat in the document when it started (doc px). */
  frame: Box;
  /** Tool settings the editor needs when the result lands (the prompt, a region's feather…). */
  settings?: Record<string, unknown>;
  /** Every generation it started; the last one's outputs are the result. */
  generationIds: string[];
  state: "pending" | "applied" | "dismissed";
  createdAt: number;
  /** The result generation, joined by the server. */
  result?: LayerJobResult | null;
}

export interface LayerProjectView {
  project: LayerProject;
  versions: LayerVersion[];
  headVersionId: string;
  doc: LayerDoc;
  jobs: LayerJob[];
}

/** What the editor posts to start a tool. */
export interface LayerJobInput {
  tool: LayerTool;
  engine: "cloud" | "open";
  modelId?: string;
  /** The picture to work on (an uploaded render of the layer, region or composite). */
  image?: string;
  /** Reference images (per-layer generate). */
  refs?: string[];
  prompt?: string;
  nodeId?: string;
  frame: Box;
  label?: string;
  settings?: {
    resolution?: "1K" | "1.5K" | "2K";
    mode?: "standard" | "fast";
    layers?: number;
    keepAlpha?: boolean;
    light?: string;
    direction?: string;
    angle?: string;
    rotate?: number;
    tilt?: number;
    zoom?: number;
    rows?: { from: string; to: string }[];
    pads?: { left: number; top: number; right: number; bottom: number };
    feather?: number;
    aspect?: string;
  };
}

/** Models each tool offers, per engine (the first is the default). Checked against the catalog in tests. */
export const TOOL_MODELS: Record<LayerTool, { cloud: string[]; open: string[] }> = {
  decompose: { cloud: ["seedream-5-layers", "seedream-5-flash-layers", "qwen-image-layered-cloud"], open: ["oss-qwen-layered"] },
  split: { cloud: ["seedream-5-layers", "seedream-5-flash-layers", "qwen-image-layered-cloud"], open: ["oss-qwen-layered", "oss-qwen-layered-control"] },
  regenerate: { cloud: ["nano-banana-pro", "seedream-5-pro", "nano-banana-2"], open: ["oss-qwen-edit", "oss-flux-kontext"] },
  "generate-layer": { cloud: ["nano-banana-pro", "seedream-5-pro"], open: ["oss-z-image-turbo", "oss-qwen-image"] },
  "text-detect": { cloud: ["ideogram-3-text-layers"], open: [] },
  "text-edit": { cloud: ["nano-banana-pro", "seedream-5-pro"], open: ["oss-qwen-edit"] },
  "bg-remove": { cloud: ["birefnet-cloud", "ideogram-remove-bg"], open: ["oss-rmbg"] },
  regional: { cloud: ["seedream-5-pro", "nano-banana-pro"], open: ["oss-qwen-edit", "oss-flux-kontext"] },
  upscale: { cloud: ["topaz-image", "seedvr-image", "recraft-crisp"], open: ["oss-upscale-image", "oss-seedvr2-image"] },
  relight: { cloud: ["nano-banana-pro"], open: ["oss-qwen-relight"] },
  angles: { cloud: ["qwen-multiple-angles", "nano-banana-pro"], open: ["oss-qwen-edit"] },
  expand: { cloud: ["nano-banana-pro"], open: ["oss-flux-fill"] },
};

/** Cuts the background back out after an edit model repaints a transparent layer. */
export const CUTOUT_MODELS = { cloud: "birefnet-cloud", open: "oss-rmbg" } as const;

/** Decomposition list prices per layer (research: paid-model-apis-3 §3). */
export const LAYER_PRICES: Record<string, { perLayer: number; doubleAt2K?: boolean; maxLayers: number }> = {
  "seedream-5-layers": { perLayer: 0.03375, doubleAt2K: true, maxLayers: 16 },
  "seedream-5-flash-layers": { perLayer: 0.027, maxLayers: 16 },
  "qwen-image-layered-cloud": { perLayer: 0.05, maxLayers: 8 },
  "oss-qwen-layered": { perLayer: 0, maxLayers: 10 },
  "oss-qwen-layered-control": { perLayer: 0, maxLayers: 10 },
};

/** Estimated price of a decomposition ("≈"): Seedream bills each layer it returns. */
export function decomposeCost(modelId: string, layers: number, resolution: "1K" | "1.5K" | "2K" = "1K"): number | null {
  const p = LAYER_PRICES[modelId];
  if (!p) return null;
  const n = Math.min(p.maxLayers, Math.max(1, Math.round(layers)));
  return Math.round(p.perLayer * n * (p.doubleAt2K && resolution === "2K" ? 2 : 1) * 1000) / 1000;
}

/** The layer count a decomposition model can be asked for (Seedream picks its own, up to 16). */
export function clampLayers(modelId: string, layers: number): number {
  const max = LAYER_PRICES[modelId]?.maxLayers ?? 10;
  return Math.min(max, Math.max(modelId === "oss-qwen-layered-control" ? 2 : 3, Math.round(layers)));
}

// ---------------------------------------------------------------------------
// Names and downloads

/** "Hero Shot / v2!" → "hero-shot-v2": lower case, runs of anything but a–z0–9 become "-", ≤ 48 chars. */
export function slugify(name: string, max = 48): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** `layer-z{z}-{slug}.png`, or `layer-z{z}-layer-{index}.png` when the name has no usable characters. */
export function layerFileName(z: number, name: string, index = z): string {
  return `layer-z${z}-${slugify(name) || `layer-${index}`}.png`;
}

/** The layers a zip holds, bottom to top, with their file names (every layer, hidden ones too). */
export function zipPlan(doc: LayerDoc): { nodeId: string; file: string }[] {
  const seen = new Set<string>();
  return [...doc.nodes]
    .sort((a, b) => a.z - b.z)
    .map((n, i) => {
      let file = layerFileName(n.z, n.name, i);
      for (let k = 2; seen.has(file); k++) file = file.replace(/(-\d+)?\.png$/, `-${k}.png`);
      seen.add(file);
      return { nodeId: n.id, file };
    });
}

/** The project's file names: "cropped-layers.zip", "positioned-layers.zip", "<slug>.png". */
export function downloadFileName(kind: "cropped" | "positioned" | "image", projectName: string): string {
  if (kind === "cropped") return "cropped-layers.zip";
  if (kind === "positioned") return "positioned-layers.zip";
  return `${slugify(projectName) || "image"}.png`;
}

/** Copy JSON: the document as a design file (absolute image links when `origin` is given). */
export function docJson(doc: LayerDoc, origin = ""): string {
  const abs = (u: string | undefined) => (u && u.startsWith("/") ? `${origin}${u}` : u);
  return JSON.stringify(
    {
      width: doc.width,
      height: doc.height,
      source: abs(doc.source),
      layers: [...doc.nodes]
        .sort((a, b) => a.z - b.z)
        .map((n) => ({
          type: "image",
          layerIndex: n.z,
          name: n.name,
          geometry: { x: round2(n.x), y: round2(n.y), width: round2(n.w), height: round2(n.h), rotation: round2(n.rotation) },
          hidden: !!n.hidden,
          opacity: n.opacity ?? 1,
          source: abs(n.src),
          ...(n.crop ? { crop: n.crop.map(round2) } : {}),
          ...(n.maskSrc ? { mask: abs(n.maskSrc) } : {}),
        })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Geometry

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** [x, y, w, h] from an array of four numbers, else null. */
export function asBox(v: unknown): Box | null {
  return Array.isArray(v) && v.length === 4 && v.every(finite) ? (v as Box) : null;
}

/** Axis-aligned bounds of a box rotated `deg` clockwise around its centre. */
export function rotatedBounds(x: number, y: number, w: number, h: number, deg: number): Box {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const bw = w * c + h * s;
  const bh = w * s + h * c;
  return [x + w / 2 - bw / 2, y + h / 2 - bh / 2, bw, bh];
}

/** Overlap of two boxes, or null. */
export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const r = Math.min(a[0] + a[2], b[0] + b[2]);
  const btm = Math.min(a[1] + a[3], b[1] + b[3]);
  return r > x && btm > y ? [x, y, r - x, btm - y] : null;
}

/**
 * A layer's cropped download: its rotation-aware bounding box, rounded out to whole pixels and kept
 * inside the document (null when nothing of it is on the canvas).
 */
export function cropRect(node: Pick<LayerNode, "x" | "y" | "w" | "h" | "rotation">, doc: Pick<LayerDoc, "width" | "height">): Box | null {
  const [bx, by, bw, bh] = rotatedBounds(node.x, node.y, node.w, node.h, node.rotation);
  const x0 = Math.floor(bx + 1e-6);
  const y0 = Math.floor(by + 1e-6);
  const x1 = Math.ceil(bx + bw - 1e-6);
  const y1 = Math.ceil(by + bh - 1e-6);
  return intersect([x0, y0, x1 - x0, y1 - y0], [0, 0, doc.width, doc.height]);
}

/** The tight box of the pixels with alpha above `threshold` in RGBA data, or null when all are clear. */
export function bboxFromAlpha(data: ArrayLike<number>, width: number, height: number, threshold = 0): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

/** Where a document point falls inside a (rotated) layer: [u, v] in 0–1, or null when outside. */
export function toLocal(node: Pick<LayerNode, "x" | "y" | "w" | "h" | "rotation">, px: number, py: number): [number, number] | null {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const r = (-node.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  const u = lx / node.w + 0.5;
  const v = ly / node.h + 0.5;
  const e = 1e-9;
  return u >= -e && u <= 1 + e && v >= -e && v <= 1 + e ? [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))] : null;
}

/** The image pixels a layer shows, from its crop (or the whole image). */
export function sourceRect(node: Pick<LayerNode, "crop" | "natural">): Box | null {
  if (node.crop) return node.crop;
  return node.natural ? [0, 0, node.natural[0], node.natural[1]] : null;
}

/**
 * The size to render one layer alone at its own resolution (the pixels it shows, not the document's),
 * for handing it to a model. Capped at `max` on the long side.
 */
export function nativeSize(node: Pick<LayerNode, "w" | "h" | "crop" | "natural">, max = 2048): [number, number] {
  const src = sourceRect(node);
  const scale = src ? src[2] / node.w : 1;
  let w = node.w * scale;
  let h = node.h * scale;
  const k = Math.min(1, max / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return [w, h];
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Resize a (rotated) layer by dragging a handle `dx, dy` document pixels (screen direction). The
 * opposite edge or corner stays put; corners keep the aspect ratio unless `free`. Minimum 4 px.
 */
export function resizeBox(node: Pick<LayerNode, "x" | "y" | "w" | "h" | "rotation">, handle: Handle, dx: number, dy: number, free = false): Pick<LayerNode, "x" | "y" | "w" | "h"> {
  const r = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // The drag in the layer's own axes.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let w = Math.max(4, node.w + sx * lx);
  let h = Math.max(4, node.h + sy * ly);
  if (sx && sy && !free) {
    // Corners: follow the larger change, keep the shape.
    const k = Math.max(w / node.w, h / node.h);
    w = Math.max(4, node.w * k);
    h = Math.max(4, node.h * k);
  }
  // The fixed point (opposite edge/corner) in local coords, relative to the old centre.
  const fx = (-sx * node.w) / 2;
  const fy = (-sy * node.h) / 2;
  // New centre = fixed point + half the new size towards the handle, back in document axes.
  const ncx = fx + (sx * w) / 2;
  const ncy = fy + (sy * h) / 2;
  const cx = node.x + node.w / 2 + ncx * cos - ncy * sin;
  const cy = node.y + node.h / 2 + ncx * sin + ncy * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Rotation (degrees, clockwise, -180…180) that points a layer's top at a pointer; `snap` rounds to 15°. */
export function rotationTo(cx: number, cy: number, px: number, py: number, snap = false): number {
  let deg = (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
  if (snap) deg = Math.round(deg / 15) * 15;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  return Math.abs(deg) < 1e-9 ? 0 : deg;
}

/** A rectangle from two corner points, kept inside the document; null when smaller than `min` px. */
export function rectFrom(x0: number, y0: number, x1: number, y1: number, doc: Pick<LayerDoc, "width" | "height">, min = 8): Box | null {
  const b = intersect([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)], [0, 0, doc.width, doc.height]);
  if (!b || b[2] < min || b[3] < min) return null;
  return [Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])];
}

// ---------------------------------------------------------------------------
// Placing model outputs

export interface OutputMeta {
  bbox?: unknown;
  bboxNormalized?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface Placement {
  /** Where the layer goes (doc px). */
  box: Box;
  /** The part of the image to show (image px), null = all of it. */
  crop: Box | null;
  /** A full-canvas image with no box from the provider: crop it to its alpha (see {@link tightenToAlpha}). */
  needsAlpha: boolean;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02);

/**
 * Where a model's layer goes in the document. The model worked on the picture that sat at `frame`;
 * its layer is either the whole canvas (Qwen: full-size RGBA, boxes from alpha) or already cut to its
 * box (Seedream may return cut layers with boxes in the base image's pixels). Boxes come as
 * `bboxNormalized` (0–1000 or 0–1) or `bbox` in pixels of `meta.width × meta.height`, else of `ref`
 * (Seedream: the base layer), else of the image itself.
 */
export function placeOutput(frame: Box, image: [number, number], meta: OutputMeta = {}, ref?: [number, number]): Placement {
  const [iw, ih] = image;
  const refW = finite(meta.width) && meta.width > 0 ? meta.width : ref?.[0] ?? iw;
  const refH = finite(meta.height) && meta.height > 0 ? meta.height : ref?.[1] ?? ih;
  let rel: Box | null = null;
  const bn = asBox(meta.bboxNormalized);
  const b = asBox(meta.bbox);
  if (bn) {
    const k = Math.max(...bn.map(Math.abs)) > 1.5 ? 1000 : 1;
    rel = [bn[0] / k, bn[1] / k, bn[2] / k, bn[3] / k];
  } else if (b) rel = [b[0] / refW, b[1] / refH, b[2] / refW, b[3] / refH];
  if (rel && (rel[2] <= 0 || rel[3] <= 0)) rel = null;
  const map = (r: Box): Box => [frame[0] + r[0] * frame[2], frame[1] + r[1] * frame[3], r[2] * frame[2], r[3] * frame[3]];
  if (!rel) return { box: frame, crop: null, needsAlpha: true };
  const whole = near(rel[0], 0, 0.005) && near(rel[1], 0, 0.005) && near(rel[2], 1, 0.005) && near(rel[3], 1, 0.005);
  if (whole) return { box: frame, crop: null, needsAlpha: false };
  // Already cut to its box: the image is the region's size.
  const cut = near(iw, rel[2] * refW, 2) && near(ih, rel[3] * refH, 2);
  const fullCanvas = !cut && near(iw / ih, refW / refH, 0.01);
  if (!fullCanvas) return { box: map(rel), crop: null, needsAlpha: false };
  return { box: map(rel), crop: [rel[0] * iw, rel[1] * ih, rel[2] * iw, rel[3] * ih], needsAlpha: false };
}

/** A full-canvas layer cropped to its alpha box (image px); null when the layer is empty. */
export function tightenToAlpha(frame: Box, image: [number, number], alpha: Box | null): Placement | null {
  if (!alpha) return null;
  const [iw, ih] = image;
  const rel: Box = [alpha[0] / iw, alpha[1] / ih, alpha[2] / iw, alpha[3] / ih];
  return { box: [frame[0] + rel[0] * frame[2], frame[1] + rel[1] * frame[3], rel[2] * frame[2], rel[3] * frame[3]], crop: alpha, needsAlpha: false };
}

export interface MeasuredOutput {
  url: string;
  meta?: Record<string, unknown>;
  natural: [number, number];
  placement: Placement;
}

/** A layer's display name from a model's meta, else "Background" / "Layer n". */
export function outputName(meta: Record<string, unknown> | undefined, z: number): string {
  const n = typeof meta?.name === "string" ? meta.name.trim() : "";
  return n ? n.slice(0, 80) : z === 0 ? "Background" : `Layer ${z}`;
}

/**
 * New layer nodes from measured model outputs, bottom to top by meta.z (then output order). A split
 * passes the layer's `frame` and `rotation`: the parts turn with it around its centre. Unnamed parts
 * of a split are called “{baseName} · part n”.
 */
export function nodesFromOutputs(
  outs: MeasuredOutput[],
  opts: { id: () => string; label: string; at: number; baseName?: string; frame?: Box; rotation?: number },
): LayerNode[] {
  const rot = opts.rotation ?? 0;
  const r = (rot * Math.PI) / 180;
  return outs
    .map((o, i) => ({ o, i, z: finite(o.meta?.z) ? (o.meta!.z as number) : i }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map(({ o }, i) => {
      let [x, y] = o.placement.box;
      const [, , w, h] = o.placement.box;
      if (rot && opts.frame) {
        // Turn the part's centre around the frame's centre.
        const fcx = opts.frame[0] + opts.frame[2] / 2;
        const fcy = opts.frame[1] + opts.frame[3] / 2;
        const dx = x + w / 2 - fcx;
        const dy = y + h / 2 - fcy;
        x = fcx + dx * Math.cos(r) - dy * Math.sin(r) - w / 2;
        y = fcy + dx * Math.sin(r) + dy * Math.cos(r) - h / 2;
      }
      const rev: LayerRevision = { src: o.url, crop: o.placement.crop, natural: o.natural, label: opts.label, at: opts.at };
      // Providers without names call them "Background" / "Layer n": those read as unnamed parts.
      const named = typeof o.meta?.name === "string" && o.meta.name.trim() && !/^(background|layer \d+)$/i.test(o.meta.name.trim());
      const name = opts.baseName && !named ? `${opts.baseName} · part ${i + 1}`.slice(0, 80) : outputName(o.meta, i);
      return { id: opts.id(), name, z: i, x, y, w, h, rotation: rot, src: o.url, crop: o.placement.crop, natural: o.natural, revisions: [rev], revision: 0 };
    });
}

// ---------------------------------------------------------------------------
// Document operations (all return a new document)

/** A new project's document: the source image as its only layer. */
export function initialDoc(source: string, width: number, height: number, at = Date.now(), id = "original"): LayerDoc {
  const rev: LayerRevision = { src: source, crop: null, natural: [width, height], label: "Original", at };
  return {
    v: 1,
    width,
    height,
    source,
    decomposed: false,
    nodes: [{ id, name: "Original image", z: 0, x: 0, y: 0, w: width, h: height, rotation: 0, src: source, crop: null, natural: [width, height], revisions: [rev], revision: 0 }],
  };
}

/** Nodes sorted by z with z = index. */
export function normalize(doc: LayerDoc): LayerDoc {
  const nodes = [...doc.nodes].sort((a, b) => a.z - b.z).map((n, i) => (n.z === i ? n : { ...n, z: i }));
  return nodes.every((n, i) => n === doc.nodes[i]) ? doc : { ...doc, nodes };
}

const withNodes = (doc: LayerDoc, nodes: LayerNode[]): LayerDoc => normalize({ ...doc, nodes: nodes.map((n, i) => (n.z === i ? n : { ...n, z: i })) });

export function getNode(doc: LayerDoc, id: string | null | undefined): LayerNode | undefined {
  return id ? doc.nodes.find((n) => n.id === id) : undefined;
}

export function updateNode(doc: LayerDoc, id: string, patch: Partial<LayerNode>): LayerDoc {
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    if (n.id !== id) return n;
    const next = { ...n, ...patch };
    changed = (Object.keys(patch) as (keyof LayerNode)[]).some((k) => n[k] !== next[k]);
    return changed ? next : n;
  });
  return changed ? { ...doc, nodes } : doc;
}

/** Move a layer to stacking position `to` (0 = bottom). */
export function moveNode(doc: LayerDoc, id: string, to: number): LayerDoc {
  const sorted = [...doc.nodes].sort((a, b) => a.z - b.z);
  const from = sorted.findIndex((n) => n.id === id);
  const dest = Math.max(0, Math.min(sorted.length - 1, Math.round(to)));
  if (from < 0 || from === dest) return doc;
  const [n] = sorted.splice(from, 1);
  sorted.splice(dest, 0, n);
  return withNodes(doc, sorted);
}

/** A copy right above the original, in the same place. */
export function duplicateNode(doc: LayerDoc, id: string, newId: string): LayerDoc {
  const sorted = [...doc.nodes].sort((a, b) => a.z - b.z);
  const i = sorted.findIndex((n) => n.id === id);
  if (i < 0) return doc;
  const src = sorted[i];
  sorted.splice(i + 1, 0, { ...src, id: newId, name: `${src.name} copy`.slice(0, 80), revisions: src.revisions.map((r) => ({ ...r })), role: undefined });
  return withNodes(doc, sorted);
}

export function deleteNode(doc: LayerDoc, id: string): LayerDoc {
  return doc.nodes.some((n) => n.id === id) ? withNodes(doc, [...doc.nodes].sort((a, b) => a.z - b.z).filter((n) => n.id !== id)) : doc;
}

/** Insert layers at stacking position `at` (default: on top). */
export function addNodes(doc: LayerDoc, add: LayerNode[], at?: number): LayerDoc {
  const sorted = [...doc.nodes].sort((a, b) => a.z - b.z);
  sorted.splice(at === undefined ? sorted.length : Math.max(0, Math.min(sorted.length, at)), 0, ...add);
  return withNodes(doc, sorted);
}

/** Swap layers for others in the place of the topmost one (a split, a merged region). */
export function replaceNodes(doc: LayerDoc, ids: string[], add: LayerNode[]): LayerDoc {
  const sorted = [...doc.nodes].sort((a, b) => a.z - b.z);
  const idx = sorted.map((n, i) => (ids.includes(n.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return doc;
  const keep = sorted.filter((n) => !ids.includes(n.id));
  const at = Math.max(...idx) - (idx.length - 1);
  keep.splice(at, 0, ...add);
  return withNodes(doc, keep);
}

/** Keep the centre and width, take the height from the image's shape. */
function refit(node: LayerNode, rev: Pick<LayerRevision, "crop" | "natural">): Pick<LayerNode, "x" | "y" | "w" | "h"> {
  const src = rev.crop ?? (rev.natural ? ([0, 0, rev.natural[0], rev.natural[1]] as Box) : null);
  if (!src || src[2] <= 0 || src[3] <= 0) return node;
  const aspect = src[2] / src[3];
  if (near(node.w / node.h, aspect, 0.01)) return node;
  const h = node.w / aspect;
  return { x: node.x, y: node.y + node.h / 2 - h / 2, w: node.w, h };
}

/** Add a new version of a layer's pixels and switch to it. */
export function addRevision(node: LayerNode, rev: LayerRevision): LayerNode {
  const revisions = node.revisions.length ? [...node.revisions, rev] : [{ src: node.src, crop: node.crop ?? null, natural: node.natural, label: "Before", at: rev.at - 1 }, rev];
  return { ...node, ...refit(node, rev), src: rev.src, crop: rev.crop ?? null, natural: rev.natural, revisions, revision: revisions.length - 1 };
}

/** Show another of a layer's revisions (“Show previous versions”, “Restore layer revision”). */
export function setRevision(node: LayerNode, index: number): LayerNode {
  const i = Math.max(0, Math.min(node.revisions.length - 1, Math.round(index)));
  const rev = node.revisions[i];
  if (!rev || i === node.revision) return node;
  return { ...node, ...refit(node, rev), src: rev.src, crop: rev.crop ?? null, natural: rev.natural, revision: i };
}

/**
 * Expand & Crop: the document becomes `rect` (doc px, may reach outside the old canvas). Layers keep
 * their pixels and move with the frame. Throws when the frame misses the picture.
 */
export function reframeDoc(doc: LayerDoc, rect: Box): LayerDoc {
  const [rx, ry, rw, rh] = rect.map(Math.round) as Box;
  if (rw < 8 || rh < 8 || !intersect([rx, ry, rw, rh], [0, 0, doc.width, doc.height])) throw new Error("The frame no longer overlaps the image. Move it back over the picture.");
  if (rx === 0 && ry === 0 && rw === doc.width && rh === doc.height) return doc;
  return { ...doc, width: rw, height: rh, nodes: doc.nodes.map((n) => ({ ...n, x: n.x - rx, y: n.y - ry })) };
}

/** Outpaint padding for an expanded frame (whole pixels, multiples of 8 as the open workflow wants). */
export function expandPads(doc: Pick<LayerDoc, "width" | "height">, rect: Box): { left: number; top: number; right: number; bottom: number } {
  const up8 = (n: number) => Math.ceil(Math.max(0, n) / 8) * 8;
  return { left: up8(-rect[0]), top: up8(-rect[1]), right: up8(rect[0] + rect[2] - doc.width), bottom: up8(rect[1] + rect[3] - doc.height) };
}

// ---------------------------------------------------------------------------
// Edit history (undo / redo within a session; versions are saved snapshots on the server)

export interface History {
  past: LayerDoc[];
  present: LayerDoc;
  future: LayerDoc[];
}

export type HistoryAction = { type: "commit"; doc: LayerDoc } | { type: "undo" } | { type: "redo" } | { type: "reset"; doc: LayerDoc };

export const HISTORY_LIMIT = 100;

export function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case "commit":
      if (a.doc === h.present) return h;
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: a.doc, future: [] };
    case "undo":
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case "redo":
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case "reset":
      return { past: [], present: a.doc, future: [] };
  }
}

// ---------------------------------------------------------------------------
// Edit text

export const TEXT_EDIT_PROMPT = "Preserve the original design and change only the requested text.";

export interface TextRow {
  from: string;
  to: string;
}

/** The changes asked for: rows whose text changed (an emptied row removes that text). */
export function textChanges(rows: TextRow[]): TextRow[] {
  return rows.filter((r) => r.from.trim() && r.to.trim() !== r.from.trim()).slice(0, 500);
}

/** The edit instruction: the fixed sentence, then each change. */
export function textEditPrompt(rows: TextRow[]): string {
  const lines = textChanges(rows).map((r) => (r.to.trim() ? `Change “${r.from.trim()}” to “${r.to.trim()}”.` : `Remove “${r.from.trim()}”.`));
  return [TEXT_EDIT_PROMPT, ...lines].join(" ");
}

const cut24 = (s: string) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);

/** “old” → “new” / Remove “old” / {n} text changes. */
export function textJobTitle(rows: TextRow[]): string {
  const c = textChanges(rows);
  if (c.length !== 1) return `${c.length} text changes`;
  const [r] = c;
  return r.to.trim() ? `“${cut24(r.from.trim())}” → “${cut24(r.to.trim())}”` : `Remove “${cut24(r.from.trim())}”`;
}

export interface TextBlock {
  text: string;
  /** 0–1 of the image, when the model said where. */
  box: Box | null;
}

/** Text blocks from a text-layers result (OutputFile.meta.textBlocks), boxes normalised against the image size. */
export function textBlocksFrom(meta: Record<string, unknown> | undefined, image?: [number, number]): TextBlock[] {
  const raw = Array.isArray(meta?.textBlocks) ? meta.textBlocks : [];
  return raw
    .map((b): TextBlock | null => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
      if (!text) return null;
      let box = asBox(o.bbox);
      if (!box && o.bbox && typeof o.bbox === "object") {
        const q = o.bbox as Record<string, unknown>;
        box = asBox([q.x, q.y, q.w ?? q.width, q.h ?? q.height]);
      }
      if (box && Math.max(...box) > 1.0001) box = image ? [box[0] / image[0], box[1] / image[1], box[2] / image[0], box[3] / image[1]] : null;
      return { text, box };
    })
    .filter((b): b is TextBlock => !!b);
}

// ---------------------------------------------------------------------------
// Decomposition states (Higgsfield's copy)

export type DecomposeState = "setting-up" | "submitting" | "processing" | "stalled" | "ready" | "failed" | "decomposed";

export const DECOMPOSE_COPY: Record<DecomposeState, [string, string]> = {
  "setting-up": ["Setting up layer decomposition", "One moment."],
  submitting: ["Starting layer decomposition", "Preparing your image for processing."],
  processing: ["Separating image layers", "Your editable layers are being prepared."],
  stalled: ["This is taking longer than expected", "We could not prepare this image for layers. Try again, and if it keeps happening, reload the page."],
  ready: ["Layers are ready", "Opening the layer editor."],
  failed: ["Layer decomposition failed", "Try again, or return to the settings."],
  decomposed: ["Decomposed", "This image is split into # layers. Edit them on the canvas or in the Layers panel."],
};

/** A queued job that hasn't moved for this long reads as stalled. */
export const STALL_MS = 3 * 60_000;

/** "In queue" / "In progress 40%" for a job's generation. */
export function jobStatusText(r: LayerJobResult | null | undefined): string {
  if (!r) return "Starting…";
  if (r.status === "queued") return "In queue";
  if (r.status === "running") return r.progress ? `In progress · ${Math.round(r.progress * 100)}%` : "In progress";
  if (r.status === "failed") return r.error ?? "Failed";
  if (r.status === "canceled") return "Canceled";
  return "Done";
}

/** Tools whose result changes the document when it lands (text detection only fills the Edit text list). */
export const APPLIES_TO_DOC = new Set<LayerTool>(["decompose", "split", "regenerate", "generate-layer", "text-edit", "bg-remove", "regional", "upscale", "relight", "angles", "expand"]);

// ---------------------------------------------------------------------------
// Zip (stored): built in the browser from rendered PNGs

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of the files, uncompressed (PNGs are already compressed). UTF-8 names. */
export function storedZip(files: { name: string; data: Uint8Array }[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const date = when.getFullYear() < 1980 ? (1 << 5) | 1 : ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);
    head.setUint16(8, 0, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
