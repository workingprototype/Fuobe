/**
 * Canvas (Higgsfield Canvas parity): node-graph workflows. A canvas is a board of nodes wired
 * with typed edges (text, image, video, audio, element). Generator nodes (any catalog model,
 * plus utilities such as Join clips or Upscale) become generations; edges become chained
 * inputs (`dependsOn` + `request.chain`), which the runner already resolves.
 *
 * Everything here is pure (no server, no DOM) so the editor (live validation, ports, cost) and
 * the server (POST /api/canvases/:id/run) plan a graph exactly the same way.
 */
import { getModel, getPreset, MODELS, supportsOp } from "./index";
import { estimateCost, inferOperation, planGeneration, type Plan } from "./plan";
import {
  OPERATION_LABELS,
  OPERATION_OUTPUT,
  type ChainSlot,
  type Engine,
  type GenerationRequest,
  type GenerationStatus,
  type GenParams,
  type MediaKind,
  type ModelDef,
  type Operation,
} from "./types";

// ---------------------------------------------------------------------------
// Graph types (stored as JSON in the canvases table)

/** What travels along an edge. */
export type PortType = "text" | "image" | "video" | "audio" | "element";

export const PORT_TYPE_LABEL: Record<PortType, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  audio: "Audio",
  element: "Element",
};

export type CanvasNodeType =
  | "prompt"
  | "image-input"
  | "video-input"
  | "audio-input"
  | "element"
  | "model"
  | "join"
  | "frame"
  | "upscale"
  | "bg-remove"
  | "tts"
  | "output"
  | "note";

/** One flat shape for every node type (React Flow wants `data` to be a plain record). */
export interface CanvasNodeData {
  [key: string]: unknown;
  /** User-facing title (defaults to the node type's label). */
  label?: string;
  /** Text prompt and sticky note content. */
  text?: string;
  /** Image / video / audio inputs: an /api/files URL (upload or library pick). */
  url?: string;
  name?: string;
  /** Element node: the @character / location / prop / style it adds. */
  elementId?: string;
  handle?: string;
  preview?: string;
  /** Generator nodes. `op` undefined = worked out from what's connected. */
  modelId?: string;
  op?: Operation;
  prompt?: string;
  params?: GenParams;
  /** Keep the current result: never re-run this node, downstream nodes use its output as is. */
  pinned?: boolean;
  /** Model node: the kind it was added as (filters the model list). Upscale / Remove background: image or video. */
  mediaKind?: MediaKind;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: CanvasNodeData;
  /** Resized nodes (sticky notes, output previews). */
  width?: number;
  height?: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/** What a generator node last ran as: its signature (inputs + settings) and its generations. */
export interface NodeRun {
  sig: string;
  ids: string[];
  at: number;
}

export type CanvasRuns = Record<string, NodeRun>;

export interface Canvas {
  id: string;
  name: string;
  graph: CanvasGraph;
  runs: CanvasRuns;
  templateId: string | null;
  createdAt: number;
  updatedAt: number;
  /** null until the user changes the board ("Never edited"). */
  editedAt: number | null;
}

/** A node's box on the list page's schematic preview. */
export interface OutlineBox {
  x: number;
  y: number;
  type: CanvasNodeType;
}

/** The board in miniature: node boxes and the edges between them (as indexes into `boxes`). */
export interface Outline {
  boxes: OutlineBox[];
  links: [number, number][];
}

export interface CanvasSummary {
  id: string;
  name: string;
  nodeCount: number;
  templateId: string | null;
  /** The newest finished image or video made on this canvas. */
  preview: { url: string; kind: MediaKind } | null;
  outline: Outline;
  createdAt: number;
  updatedAt: number;
  editedAt: number | null;
}

export const EMPTY_GRAPH: CanvasGraph = { nodes: [], edges: [] };

/** Longest text a prompt, script or note may hold (longer pastes are cut, never refused). */
export const CANVAS_TEXT_MAX = 10_000;

// ---------------------------------------------------------------------------
// Node registry

export type NodeGroup = "Inputs" | "Generate" | "Utilities" | "Output";

export interface NodeSpec {
  type: CanvasNodeType;
  label: string;
  group: NodeGroup;
  description: string;
  /** lucide icon name (mapped to a component in the editor). */
  icon: string;
  /** Generator nodes: the operations they run (empty = any operation of the chosen model). */
  ops?: Operation[];
}

export const NODE_SPECS: Record<CanvasNodeType, NodeSpec> = {
  prompt: { type: "prompt", label: "Text prompt", group: "Inputs", icon: "Type", description: "Words that feed the prompt of the nodes it connects to" },
  "image-input": { type: "image-input", label: "Image", group: "Inputs", icon: "ImageIcon", description: "Upload an image or pick one from your library" },
  "video-input": { type: "video-input", label: "Video", group: "Inputs", icon: "Film", description: "Upload a clip or pick one from your library" },
  "audio-input": { type: "audio-input", label: "Audio", group: "Inputs", icon: "AudioLines", description: "A voice sample, music or any sound" },
  element: { type: "element", label: "Element", group: "Inputs", icon: "AtSign", description: "An @character, location, prop or style from Elements" },
  model: { type: "model", label: "Model", group: "Generate", icon: "Sparkles", ops: [], description: "Any model in the catalog — image, video, audio or text" },
  join: { type: "join", label: "Join clips", group: "Utilities", icon: "Combine", ops: ["concat"], description: "Stitch clips into one video, in order (top to bottom)" },
  frame: { type: "frame", label: "Extract frame", group: "Utilities", icon: "Frame", ops: ["frame"], description: "The last frame of a video, as an image" },
  upscale: { type: "upscale", label: "Upscale", group: "Utilities", icon: "ZoomIn", ops: ["upscale-image", "upscale-video"], description: "Sharper, larger images or videos" },
  "bg-remove": { type: "bg-remove", label: "Remove background", group: "Utilities", icon: "Eraser", ops: ["bg-remove", "bg-remove-video"], description: "Cut out the subject of an image or video" },
  tts: { type: "tts", label: "Text to speech", group: "Utilities", icon: "Mic2", ops: ["tts"], description: "Speak a text, in a preset voice or a cloned one" },
  output: { type: "output", label: "Output", group: "Output", icon: "MonitorPlay", description: "Preview what's connected, side by side" },
  note: { type: "note", label: "Sticky note", group: "Output", icon: "StickyNote", description: "A note on the board (not run)" },
};

export const GENERATOR_TYPES = new Set<CanvasNodeType>(["model", "join", "frame", "upscale", "bg-remove", "tts"]);
export const isGenerator = (n: Pick<CanvasNode, "type">) => GENERATOR_TYPES.has(n.type);

/** Entries of the Add-node palette (several entries can make the same node type). */
export interface PaletteItem {
  id: string;
  type: CanvasNodeType;
  label: string;
  group: NodeGroup;
  description: string;
  icon: string;
  data?: CanvasNodeData;
  keywords?: string;
  /** Why it can't be added on this install (no model for it on the only engine allowed). */
  disabled?: string;
}

export const PALETTE: PaletteItem[] = [
  { ...pick("prompt"), id: "prompt", keywords: "text words script" },
  { ...pick("image-input"), id: "image-input", keywords: "upload photo picture library reference" },
  { ...pick("video-input"), id: "video-input", keywords: "upload clip footage library" },
  { ...pick("audio-input"), id: "audio-input", keywords: "upload voice sound music sample" },
  { ...pick("element"), id: "element", keywords: "character location prop style mention @" },
  { id: "model-image", type: "model", label: "Image model", group: "Generate", icon: "ImageIcon", description: "Text to image, or edit connected images", data: { mediaKind: "image" }, keywords: "generate picture edit t2i" },
  { id: "model-video", type: "model", label: "Video model", group: "Generate", icon: "Clapperboard", description: "Text or image to video, start & end frames, references", data: { mediaKind: "video" }, keywords: "generate animate i2v t2v clip" },
  { id: "model-audio", type: "model", label: "Audio model", group: "Generate", icon: "AudioLines", description: "Speech, sound effects, music, voice change", data: { mediaKind: "audio" }, keywords: "sound music sfx voice" },
  { id: "model-text", type: "model", label: "Text model", group: "Generate", icon: "MessageSquareText", description: "Write or translate text with an LLM", data: { mediaKind: "text" }, keywords: "llm write script translate copy" },
  { id: "model-any", type: "model", label: "Any model", group: "Generate", icon: "Sparkles", description: "Pick any model from the catalog", keywords: "catalog" },
  { ...pick("join"), id: "join", keywords: "concat merge stitch film" },
  { ...pick("frame"), id: "frame", keywords: "still last frame screenshot" },
  { ...pick("upscale"), id: "upscale", data: { mediaKind: "image" }, keywords: "enhance resolution 4k sharpen" },
  { ...pick("bg-remove"), id: "bg-remove", data: { mediaKind: "image" }, keywords: "cutout matte transparent" },
  { ...pick("tts"), id: "tts", keywords: "voice speech narration clone" },
  { ...pick("output"), id: "output", keywords: "preview compare result" },
  { ...pick("note"), id: "note", keywords: "comment annotation" },
];

function pick(type: CanvasNodeType): Omit<PaletteItem, "id"> {
  const s = NODE_SPECS[type];
  return { type, label: s.label, group: s.group, description: s.description, icon: s.icon };
}

const paletteCache = new Map<string, PaletteItem[]>();

/**
 * Palette entries whose models exist in this catalog (no text models until an LLM model is
 * installed). On an install locked to one engine, entries with no model there are disabled, with why.
 */
export function paletteItems(mode: "both" | "open" | "cloud" = "both"): PaletteItem[] {
  const hit = paletteCache.get(mode);
  if (hit) return hit;
  const items = PALETTE.filter((p) => p.id !== "model-text" || MODELS.some((m) => m.kind === "text" && !m.hidden)).map((p): PaletteItem => {
    if (mode === "both" || !isGenerator(p) || defaultModelForNode({ type: p.type, data: p.data ?? {} }, mode)) return p;
    return { ...p, disabled: `No ${mode === "open" ? "open-source" : "cloud"} model for ${p.label.toLowerCase()} yet` };
  });
  paletteCache.set(mode, items);
  return items;
}

export function nodeLabel(n: Pick<CanvasNode, "type" | "data">): string {
  const custom = n.data.label?.trim();
  if (custom) return custom;
  if (n.type === "model") {
    const m = n.data.modelId ? getModel(n.data.modelId) : undefined;
    if (m) return m.name;
    const k = n.data.mediaKind;
    return k ? `${k[0].toUpperCase()}${k.slice(1)} model` : "Model";
  }
  return NODE_SPECS[n.type]?.label ?? n.type;
}

// ---------------------------------------------------------------------------
// Models for generator nodes

/** Ops the canvas can't feed (masks, browser-only tools, multi-speaker scripts, draft finishing). */
const UNSUPPORTED_OPS = new Set<Operation>(["grade", "inpaint", "finalize", "dialogue"]);

/** Preferred defaults; anything missing falls back to the first catalog model for that op and engine. */
const PREFERRED: Partial<Record<Operation, Partial<Record<Engine, string>>>> = {
  t2i: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" },
  edit: { cloud: "nano-banana-pro", open: "oss-qwen-edit" },
  t2v: { cloud: "kling-2-5-turbo", open: "oss-wan22-14b-fast" },
  i2v: { cloud: "kling-2-5-turbo", open: "oss-wan22-14b-fast" },
  flf2v: { cloud: "kling-2-5-turbo", open: "oss-wan22-14b-fast" },
  ref2v: { cloud: "seedance-2-5", open: "oss-wan-vace" },
  avatar: { cloud: "kling-avatar-2", open: "oss-infinitetalk" },
  lipsync: { cloud: "sync-lipsync-2-pro" },
  tts: { cloud: "elevenlabs-v4", open: "oss-chatterbox" },
  music: { cloud: "elevenlabs-music", open: "oss-ace-step" },
  sfx: { cloud: "elevenlabs-sfx" },
  concat: { cloud: "join-clips", open: "oss-join-clips" },
  frame: { cloud: "extract-frame" },
  "upscale-image": { cloud: "topaz-image", open: "oss-upscale-image" },
  "upscale-video": { cloud: "topaz-video", open: "oss-upscale-video-esrgan" },
  "bg-remove": { cloud: "birefnet-cloud", open: "oss-rmbg" },
  "bg-remove-video": { cloud: "birefnet-video", open: "oss-video-matte-birefnet" },
  write: { cloud: "text-llm", open: "oss-text-llm" },
  translate: { cloud: "text-llm", open: "oss-text-llm" },
};

/** The ops a generator node may run: fixed for utilities (by image/video choice), the model's own for Model nodes. */
export function nodeOps(n: Pick<CanvasNode, "type" | "data">, model?: ModelDef): Operation[] {
  const spec = NODE_SPECS[n.type];
  if (!spec?.ops) return [];
  if (spec.ops.length) {
    if (spec.ops.length === 1) return spec.ops;
    // Upscale / Remove background: the image or the video variant.
    const video = n.data.mediaKind === "video";
    return [spec.ops[video ? 1 : 0]];
  }
  if (!model) return [];
  return [...new Set(model.routes.map((r) => r.op))].filter((op) => !UNSUPPORTED_OPS.has(op));
}

/** The default model for an op on an engine (utilities may use hidden models, e.g. Extract frame). */
export function defaultModelFor(op: Operation, engine: Engine, opts: { hidden?: boolean } = {}): ModelDef | undefined {
  const preferred = PREFERRED[op]?.[engine];
  const m = preferred ? getModel(preferred) : undefined;
  if (m && m.engine === engine && supportsOp(m, op)) return m;
  return MODELS.find((x) => x.engine === engine && (opts.hidden || !x.hidden) && supportsOp(x, op));
}

const KIND_OP: Record<MediaKind, Operation> = { image: "t2i", video: "t2v", audio: "tts", text: "write", model3d: "image-to-3d" };

/** The model a new generator node starts with. */
export function defaultModelForNode(n: Pick<CanvasNode, "type" | "data">, engine: Engine): ModelDef | undefined {
  if (n.type === "model") {
    const kind = n.data.mediaKind ?? "image";
    return defaultModelFor(n.data.op ?? KIND_OP[kind], engine) ?? MODELS.find((m) => m.engine === engine && !m.hidden && m.kind === kind);
  }
  const op = nodeOps(n)[0];
  return op ? defaultModelFor(op, engine, { hidden: true }) : undefined;
}

/** Models the node's picker offers. */
export function modelChoices(n: Pick<CanvasNode, "type" | "data">): ModelDef[] {
  if (n.type === "model") {
    const kind = n.data.mediaKind;
    return MODELS.filter((m) => !m.hidden && (!kind || m.kind === kind) && m.routes.some((r) => !UNSUPPORTED_OPS.has(r.op)));
  }
  const ops = nodeOps(n);
  return MODELS.filter((m) => ops.some((op) => supportsOp(m, op)) && (!m.hidden || ops.includes("frame")));
}

// ---------------------------------------------------------------------------
// Ports

export type InputPortId = "prompt" | "elements" | "images" | "endImage" | "video" | "videos" | "audio" | "voice";

export interface PortDef {
  id: InputPortId;
  label: string;
  type: PortType;
  multiple: boolean;
}

/** Output handle id of every node that has one; the Output node's input handle id. */
export const OUT = "out";
export const PREVIEW_IN = "in";

const INPUT_ORDER: InputPortId[] = ["prompt", "elements", "images", "endImage", "video", "videos", "audio", "voice"];

/** Which inputs each operation reads. */
const OP_PORTS: Partial<Record<Operation, InputPortId[]>> = {
  t2i: ["prompt", "elements"],
  edit: ["prompt", "elements", "images"],
  outpaint: ["prompt", "images"],
  t2v: ["prompt", "elements"],
  i2v: ["prompt", "elements", "images"],
  flf2v: ["prompt", "images", "endImage"],
  ref2v: ["prompt", "elements", "images"],
  v2v: ["prompt", "elements", "video", "images"],
  lipsync: ["video", "audio"],
  avatar: ["prompt", "images", "audio"],
  "motion-transfer": ["prompt", "images", "video"],
  "upscale-image": ["images"],
  "upscale-video": ["video"],
  "bg-remove": ["images"],
  "face-swap": ["images"],
  tts: ["prompt", "voice"],
  sfx: ["prompt"],
  music: ["prompt"],
  v2a: ["prompt", "video"],
  interpolate: ["video"],
  extend: ["prompt", "video"],
  reframe: ["prompt", "video"],
  "voice-change": ["audio", "voice"],
  dub: ["video"],
  "bg-remove-video": ["video"],
  "depth-video": ["video"],
  "relight-video": ["prompt", "video", "images"],
  concat: ["videos"],
  frame: ["video"],
  "color-match": ["images", "video"],
  layers: ["images"],
  "text-layers": ["images"],
  trim: ["video"],
  transcribe: ["video", "audio"],
  captions: ["video"],
  mux: ["video", "audio"],
  "image-to-3d": ["images"],
  "separate-audio": ["audio", "video"],
  translate: ["prompt"],
  write: ["prompt"],
};

/** Ops whose images list takes several images. */
const MULTI_IMAGE_OPS = new Set<Operation>(["edit", "ref2v", "face-swap", "color-match", "relight-video"]);

const TEXT_LABEL_OPS = new Set<Operation>(["tts", "translate", "write", "sfx", "music"]);

/** The input handles a generator node shows (the union over its ops when the op is automatic). */
export function inputPorts(n: Pick<CanvasNode, "type" | "data">): PortDef[] {
  if (n.type === "output") return [];
  if (!isGenerator(n)) return [];
  const model = n.data.modelId ? getModel(n.data.modelId) : undefined;
  const all = nodeOps(n, model);
  const fallback: Operation[] = n.type === "model" ? (n.data.mediaKind === "video" ? ["t2v", "i2v"] : n.data.mediaKind === "audio" ? ["tts"] : n.data.mediaKind === "text" ? ["write"] : ["t2i", "edit"]) : [];
  const ops = n.data.op && all.includes(n.data.op) ? [n.data.op] : all.length ? all : fallback;
  const ids = new Set(ops.flatMap((op) => OP_PORTS[op] ?? []));
  // Start & end frames: shown on image-to-video models that can take an end frame.
  if (ops.includes("i2v") && (model?.options.endFrame || (model && supportsOp(model, "flf2v")))) ids.add("endImage");
  // A cloned voice only where the model clones voices.
  if (ids.has("voice") && model && !model.options.voiceClone) ids.delete("voice");
  // Visual elements only on image and video models.
  if (ids.has("elements") && model && model.kind !== "image" && model.kind !== "video") ids.delete("elements");
  const maxImages = model?.options.maxImages ?? (ops.some((op) => MULTI_IMAGE_OPS.has(op)) ? 4 : 1);
  const multiImages = ops.some((op) => MULTI_IMAGE_OPS.has(op)) && maxImages > 1;
  const textLabel = ops.every((op) => TEXT_LABEL_OPS.has(op)) ? "Text" : "Prompt";
  const defs: Record<InputPortId, PortDef> = {
    prompt: { id: "prompt", label: textLabel, type: "text", multiple: true },
    elements: { id: "elements", label: "Elements", type: "element", multiple: true },
    images: { id: "images", label: multiImages ? "Images" : ops.includes("i2v") || ops.includes("flf2v") ? "Start frame" : "Image", type: "image", multiple: multiImages },
    endImage: { id: "endImage", label: "End frame", type: "image", multiple: false },
    video: { id: "video", label: "Video", type: "video", multiple: false },
    videos: { id: "videos", label: "Clips", type: "video", multiple: true },
    audio: { id: "audio", label: "Audio", type: "audio", multiple: false },
    voice: { id: "voice", label: "Voice to clone", type: "audio", multiple: false },
  };
  return INPUT_ORDER.filter((id) => ids.has(id)).map((id) => defs[id]);
}

const MEDIA_INPUT_TYPE: Partial<Record<CanvasNodeType, PortType>> = { "image-input": "image", "video-input": "video", "audio-input": "audio" };

const toPortType = (k: MediaKind | undefined): PortType | null => (k === "image" || k === "video" || k === "audio" || k === "text" ? k : null);

/** The type of a node's output handle (null = no output handle). */
export function outputType(_graph: CanvasGraph, n: CanvasNode): PortType | null {
  if (n.type === "prompt") return "text";
  if (n.type === "element") return "element";
  if (MEDIA_INPUT_TYPE[n.type]) return MEDIA_INPUT_TYPE[n.type]!;
  if (!isGenerator(n)) return null;
  // Never inferred from the inputs (that would walk the whole upstream graph): a chosen or fixed op, else the model's kind.
  const model = n.data.modelId ? getModel(n.data.modelId) : undefined;
  const ops = nodeOps(n, model);
  const op = n.data.op && ops.includes(n.data.op) ? n.data.op : n.type !== "model" ? ops[0] : undefined;
  if (op) return toPortType(OPERATION_OUTPUT[op]);
  if (model) return toPortType(model.kind);
  if (n.type === "upscale" || n.type === "bg-remove") return n.data.mediaKind === "video" ? "video" : "image";
  if (n.type === "join") return "video";
  if (n.type === "frame") return "image";
  if (n.type === "tts") return "audio";
  return toPortType(n.data.mediaKind ?? "image");
}

/** Which ports accept which types. */
export function acceptsType(port: PortDef | "preview", type: PortType): boolean {
  return port === "preview" ? type !== "element" : port.type === type;
}

// ---------------------------------------------------------------------------
// Graph helpers

const byPosition = (a: CanvasNode, b: CanvasNode) => a.position.y - b.position.y || a.position.x - b.position.x;

export function nodeMap(graph: CanvasGraph): Map<string, CanvasNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

export function incoming(graph: CanvasGraph, nodeId: string): CanvasEdge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}

/** Every node upstream of these (not including them). */
export function ancestors(graph: CanvasGraph, ids: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.target === id && !out.has(e.source)) {
        out.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return out;
}

export function descendants(graph: CanvasGraph, ids: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.source === id && !out.has(e.target)) {
        out.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return out;
}

/**
 * Topological order (Kahn), ties broken left to right then top to bottom so steps read the way
 * the board does. Nodes on a loop can't be ordered: they come back in `cyclic`.
 */
export function topoOrder(graph: CanvasGraph): { order: string[]; cyclic: string[] } {
  const nodes = nodeMap(graph);
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const valid = graph.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target) && e.source !== e.target);
  for (const e of valid) indeg.set(e.target, indeg.get(e.target)! + 1);
  const cmp = (a: string, b: string) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    return na.position.x - nb.position.x || na.position.y - nb.position.y || a.localeCompare(b);
  };
  const ready = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort(cmp);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    let added = false;
    for (const e of valid) {
      if (e.source !== id) continue;
      const d = indeg.get(e.target)! - 1;
      indeg.set(e.target, d);
      if (d === 0) {
        ready.push(e.target);
        added = true;
      }
    }
    if (added) ready.sort(cmp);
  }
  const done = new Set(order);
  const selfLoops = graph.edges.filter((e) => e.source === e.target).map((e) => e.source);
  const cyclic = [...new Set([...graph.nodes.filter((n) => !done.has(n.id)).map((n) => n.id), ...selfLoops])];
  return { order, cyclic };
}

export interface Connection {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Why this edge can't be drawn, or null when it can. */
export function connectionError(graph: CanvasGraph, c: Connection): string | null {
  const nodes = nodeMap(graph);
  const s = nodes.get(c.source);
  const t = nodes.get(c.target);
  if (!s || !t) return "That node no longer exists";
  if (s.id === t.id) return "A node can't feed itself";
  const type = outputType(graph, s);
  if (!type || (c.sourceHandle && c.sourceHandle !== OUT)) return `${nodeLabel(s)} has no output`;
  if (t.type === "output") {
    if (c.targetHandle && c.targetHandle !== PREVIEW_IN) return "Unknown input";
    if (!acceptsType("preview", type)) return "Elements go into a model's Elements input";
  } else {
    const port = inputPorts(t).find((p) => p.id === c.targetHandle);
    if (!port) return `${nodeLabel(t)} has no ${c.targetHandle ?? ""} input`;
    if (!acceptsType(port, type)) return `${PORT_TYPE_LABEL[type]} can't go into ${port.label}`;
  }
  if (ancestors(graph, [s.id]).has(t.id)) return "That would make a loop";
  return null;
}

/** True when this target handle takes only one edge (a new edge replaces the old one). */
export function singleInput(graph: CanvasGraph, target: string, targetHandle?: string | null): boolean {
  const t = nodeMap(graph).get(target);
  if (!t || t.type === "output") return false;
  const port = inputPorts(t).find((p) => p.id === targetHandle);
  return !!port && !port.multiple;
}

// ---------------------------------------------------------------------------
// From a node to a generation request

type Source =
  | { kind: "text"; text: string }
  | { kind: "media"; url: string }
  | { kind: "element"; handle: string }
  | { kind: "node"; nodeId: string };

const SLOT: Record<InputPortId, ChainSlot["slot"] | null> = {
  prompt: "prompt",
  elements: null,
  images: "images",
  endImage: "endImage",
  video: "video",
  videos: "videos",
  audio: "audio",
  voice: "voiceAudio",
};

type InputKey = "endImage" | "video" | "audio" | "voiceAudio";
const SINGLE_FIELD: Partial<Record<InputPortId, InputKey>> = { endImage: "endImage", video: "video", audio: "audio", voice: "voiceAudio" };

const PLACEHOLDER: Record<MediaKind, string> = {
  image: "/api/files/placeholder.png",
  video: "/api/files/placeholder.mp4",
  audio: "/api/files/placeholder.wav",
  text: "Placeholder text from an earlier step",
  model3d: "/api/files/placeholder.glb",
};

const SLOT_KIND: Record<ChainSlot["slot"], MediaKind> = {
  images: "image",
  endImage: "image",
  video: "video",
  videos: "video",
  audio: "audio",
  voiceAudio: "audio",
  audio2: "audio",
  audios: "audio",
  prompt: "text",
};

/** The request with placeholders where earlier steps' outputs will go (mirrors withChainInputs on the server). */
export function withPlaceholders(req: GenerationRequest): GenerationRequest {
  const slots = req.chain ?? [];
  const inputs = { ...req.inputs };
  let prompt = req.prompt;
  for (const k of ["images", "videos", "audios"] as const) {
    const at = (pos: "first" | "last") => slots.filter((s) => s.slot === k && (s.position ?? "last") === pos).map((s) => PLACEHOLDER[SLOT_KIND[s.slot]]);
    const first = at("first");
    const last = at("last");
    if (first.length || last.length) inputs[k] = [...first, ...(inputs[k] ?? []), ...last];
  }
  for (const s of slots) {
    if (s.slot === "prompt") prompt = prompt?.includes("{text}") ? prompt.replaceAll("{text}", PLACEHOLDER.text) : PLACEHOLDER.text;
    else if (s.slot !== "images" && s.slot !== "videos" && s.slot !== "audios") inputs[s.slot] = PLACEHOLDER[SLOT_KIND[s.slot]];
  }
  return { ...req, prompt, inputs };
}

export interface NodeRequest {
  request: GenerationRequest;
  /** Upstream generator nodes, in the order of `request.chain`. */
  deps: string[];
}

export interface NodeDescription extends Partial<NodeRequest> {
  model?: ModelDef;
  /** The planned run (with placeholders for upstream outputs), when the node is valid. */
  plan?: Plan;
  /** Estimated USD for one run of this node (null = unknown price). */
  costUsd: number | null;
  error?: string;
}

function sourceOf(s: CanvasNode): Source | { error: string } {
  if (s.type === "prompt") return { kind: "text", text: (s.data.text ?? "").trim() };
  if (MEDIA_INPUT_TYPE[s.type]) {
    const what = s.type === "image-input" ? "an image" : s.type === "video-input" ? "a video" : "an audio clip";
    return s.data.url ? { kind: "media", url: s.data.url } : { error: `Add ${what} to “${nodeLabel(s)}”` };
  }
  if (s.type === "element") return s.data.handle ? { kind: "element", handle: s.data.handle } : { error: `Pick an element in “${nodeLabel(s)}”` };
  if (isGenerator(s)) return { kind: "node", nodeId: s.id };
  return { error: `${nodeLabel(s)} has no output` };
}

/**
 * A text model (LLM) on Auto writes, unless a language to translate into is set. (The catalog
 * lists translate first, so leaving it to inferOperation would translate a "Write a slogan…" prompt.)
 */
function textOp(model: ModelDef, params: GenParams | undefined): Operation | undefined {
  if (model.kind !== "text") return undefined;
  if (params?.targetLanguage && supportsOp(model, "translate")) return "translate";
  return supportsOp(model, "write") ? "write" : undefined;
}

/** What a generator node's own text box asks for, by the op it runs. */
export function promptPlaceholder(op: Operation | undefined): string {
  switch (op) {
    case "write":
      return "What should it write? Connected text joins in, or use {text}";
    case "translate":
      return "Text to translate, or connect a text";
    case "tts":
      return "Text to speak, or connect a text";
    case "sfx":
      return "Describe the sound, or connect a text";
    case "music":
      return "Describe the music: style, mood, instruments";
    default:
      return "Describe it — connected text joins in, or use {text}";
  }
}

/** The operation a node runs: its own choice, the utility's op, or inferred from what's connected. */
export function effectiveOp(graph: CanvasGraph, n: CanvasNode): Operation | undefined {
  const model = n.data.modelId ? getModel(n.data.modelId) : undefined;
  const ops = nodeOps(n, model);
  if (n.data.op && ops.includes(n.data.op)) return n.data.op;
  if (n.type !== "model") return ops[0];
  if (!model) return undefined;
  const text = textOp(model, n.data.params);
  if (text) return text;
  const built = buildRequest(graph, n, model);
  if ("error" in built) return undefined;
  let op = inferOperation(model, withPlaceholders(built.request));
  // Connected elements bring reference images (applyMentions on the server): text-only ops become edits / references.
  if (graph.edges.some((e) => e.target === n.id && e.targetHandle === "elements")) {
    if (op === "t2i" && supportsOp(model, "edit")) op = "edit";
    else if (op === "t2v" && supportsOp(model, "ref2v")) op = "ref2v";
  }
  return ops.includes(op) ? op : ops[0];
}

/** "With @Maya and @Paris." — how connected elements join the prompt. */
function mentionLine(handles: string[]): string {
  if (!handles.length) return "";
  const list = handles.map((h) => `@${h}`);
  return `With ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]}.`;
}

/** Handles already @mentioned in a text, lowercased (the same pattern as elements.ts: letters, digits, _ and -). */
function mentionedIn(text: string): Set<string> {
  return new Set([...text.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()));
}

function buildRequest(graph: CanvasGraph, n: CanvasNode, model: ModelDef): NodeRequest | { error: string } {
  const nodes = nodeMap(graph);
  const ports = inputPorts(n);
  const ops = nodeOps(n, model);
  const op = n.data.op && ops.includes(n.data.op) ? n.data.op : n.type !== "model" ? ops[0] : textOp(model, n.data.params);
  if (n.type !== "model" && op && !supportsOp(model, op)) return { error: `${model.name} can't do ${OPERATION_LABELS[op].toLowerCase()} — pick another model` };
  if (op === "translate" && !n.data.params?.targetLanguage) return { error: "Pick a language to translate into" };

  const inputs: NonNullable<GenerationRequest["inputs"]> = {};
  const chain: ChainSlot[] = [];
  const deps: string[] = [];
  const texts: string[] = [];
  const handles: string[] = [];
  let generatedText = 0;

  for (const port of ports) {
    const edges = incoming(graph, n.id)
      .filter((e) => e.targetHandle === port.id && nodes.has(e.source))
      .sort((a, b) => byPosition(nodes.get(a.source)!, nodes.get(b.source)!));
    if (!port.multiple && edges.length > 1) return { error: `${port.label} takes one input — remove a connection` };
    const list: Source[] = [];
    for (const e of edges) {
      const s = nodes.get(e.source)!;
      const type = outputType(graph, s);
      if (!type || !acceptsType(port, type)) return { error: `${nodeLabel(s)} can't go into ${port.label}` };
      const src = sourceOf(s);
      if ("error" in src) return src;
      list.push(src);
    }
    if (port.id === "prompt") {
      for (const src of list) {
        if (src.kind === "text" && src.text) texts.push(src.text);
        if (src.kind === "node") {
          generatedText++;
          chain.push({ slot: "prompt" });
          deps.push(src.nodeId);
        }
      }
      continue;
    }
    if (port.id === "elements") {
      for (const src of list) if (src.kind === "element" && !handles.includes(src.handle)) handles.push(src.handle);
      continue;
    }
    if (port.id === "images" || port.id === "videos") {
      // Keep the board's top-to-bottom order: leading generated items go first, the rest after the files.
      let seenLiteral = false;
      const own: string[] = [];
      for (const src of list) {
        if (src.kind === "media") {
          own.push(src.url);
          seenLiteral = true;
        } else if (src.kind === "node") {
          chain.push({ slot: port.id, position: seenLiteral ? "last" : "first" });
          deps.push(src.nodeId);
        }
      }
      if (own.length) inputs[port.id] = own;
      continue;
    }
    const field = SINGLE_FIELD[port.id];
    const src = list[0];
    if (!field || !src) continue;
    if (src.kind === "media") inputs[field] = src.url;
    else if (src.kind === "node") {
      chain.push({ slot: SLOT[port.id]! });
      deps.push(src.nodeId);
    }
  }
  if (generatedText > 1) return { error: "Connect one generated text at a time — join the others into one text model" };

  // Prompt: the node's own words, then connected texts, then the elements, then generated text.
  // "{text}" in the node's prompt marks where connected text goes (a generated text fills it on the server).
  const own = (n.data.prompt ?? "").trim();
  const slot = own.includes("{text}");
  const parts = generatedText || !slot ? [own, ...texts].filter(Boolean) : [own.replaceAll("{text}", texts.join("\n\n")).trim()].filter(Boolean);
  const already = mentionedIn(parts.join(" "));
  const mentions = mentionLine(handles.filter((h) => !already.has(h.toLowerCase())));
  if (mentions) parts.push(mentions);
  if (generatedText && !slot) parts.push("{text}");
  const prompt = parts.join("\n\n");

  const params: GenParams = { ...n.data.params };
  for (const k of Object.keys(params) as (keyof GenParams)[]) if (params[k] === undefined || params[k] === "") delete params[k];
  const request: GenerationRequest = {
    feature: "canvas",
    modelId: model.id,
    ...(op && { op }),
    ...(prompt && { prompt }),
    ...(Object.keys(inputs).length && { inputs }),
    ...(Object.keys(params).length && { params }),
    ...(chain.length && { chain }),
  };
  return { request, deps };
}

export interface DescribeContext {
  engineMode?: "both" | "open" | "cloud";
}

/** Everything the editor and the planner need about one generator node. */
export function describeNode(graph: CanvasGraph, n: CanvasNode, ctx: DescribeContext = {}): NodeDescription {
  if (!isGenerator(n)) return { costUsd: null, error: "Not a generator" };
  const model = n.data.modelId ? getModel(n.data.modelId) : undefined;
  if (!model) return { costUsd: null, error: n.data.modelId ? "That model is no longer in the catalog — pick another" : "Pick a model" };
  const mode = ctx.engineMode ?? "both";
  if (mode !== "both" && model.engine !== mode) {
    return {
      model,
      costUsd: null,
      error:
        mode === "open"
          ? `${model.name} is a paid cloud model, but this install is open source only — pick an open model`
          : `${model.name} is an open-source model, but this install uses cloud models only — pick a cloud model`,
    };
  }
  const built = buildRequest(graph, n, model);
  if ("error" in built) return { model, costUsd: null, error: built.error };
  try {
    const plan = planGeneration(withPlaceholders(built.request), getModel, getPreset);
    return { ...built, model, plan, costUsd: estimateCost(plan.model, plan.params, plan.jobs) };
  } catch (e) {
    return { ...built, model, costUsd: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Signatures: a node is fresh when it last ran with exactly these inputs and settings.

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 53-bit string hash (cyrb53), as hex. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** The node's identity for "is this result still fresh": its request (minus labels) and the generations it builds on. */
export function nodeSignature(req: GenerationRequest, depIds: string[]): string {
  const rest: Partial<GenerationRequest> = { ...req };
  delete rest.step;
  delete rest.frame;
  delete rest.feature;
  return hash(stable({ ...rest, deps: depIds }));
}

// ---------------------------------------------------------------------------
// Planning a run

export type RunReason = "new" | "changed" | "failed" | "forced" | "upstream";

export interface PlannedStep extends NodeRequest {
  nodeId: string;
  label: string;
  reason: RunReason;
  costUsd: number | null;
}

export interface CanvasPlan {
  /** Generator nodes in scope, in run order. */
  order: string[];
  /** Nodes that will make new generations, in order. */
  steps: PlannedStep[];
  /** Nodes whose current result is used as is. */
  reused: { nodeId: string; reason: "fresh" | "pinned"; generationId: string }[];
  errors: { nodeId: string; message: string }[];
  /** Sum of the known per-step estimates. */
  costUsd: number;
  /** Some step's price is unknown. */
  costUnknown: boolean;
}

export interface PlanOptions extends DescribeContext {
  /** Nodes to run (with everything upstream). Omit to run every generator node. */
  targets?: string[];
  /** Run the targets again even when their result is fresh. */
  force?: boolean;
  runs?: CanvasRuns;
  /** Status of a generation this canvas made (undefined = gone). */
  status?: (generationId: string) => GenerationStatus | undefined;
  /** describeNode, when the caller keeps its own cache of it (the editor re-plans on every keystroke). */
  describe?: (n: CanvasNode) => NodeDescription;
}

const LIVE = new Set<GenerationStatus | undefined>(["queued", "running", "succeeded"]);

export function planCanvas(graph: CanvasGraph, opts: PlanOptions = {}): CanvasPlan {
  const nodes = nodeMap(graph);
  const runs = opts.runs ?? {};
  const status = opts.status ?? (() => undefined);
  const { order, cyclic } = topoOrder(graph);
  const errors: CanvasPlan["errors"] = [];
  const loop = new Set(cyclic);
  for (const id of cyclic) {
    const inLoop = ancestors(graph, [id]).has(id);
    errors.push({ nodeId: id, message: inLoop ? "This node is part of a loop — remove one of its connections" : "This node comes after a loop — remove one of the loop's connections" });
  }

  // Targets: generator nodes as given; other nodes (an Output, an input) stand for the generators feeding them.
  const all = graph.nodes.filter(isGenerator).map((n) => n.id);
  const requested = opts.targets ? opts.targets.filter((id) => nodes.has(id)) : all;
  const targets = new Set<string>();
  for (const id of requested) {
    if (isGenerator(nodes.get(id)!)) targets.add(id);
    else for (const a of ancestors(graph, [id])) if (isGenerator(nodes.get(a)!)) targets.add(a);
  }
  const scope = new Set([...targets, ...[...ancestors(graph, [...targets])].filter((id) => isGenerator(nodes.get(id)!))]);
  const inScope = [...order, ...cyclic].filter((id) => scope.has(id));

  const state = new Map<string, { kind: "run" } | { kind: "reuse"; id: string } | { kind: "blocked" }>();
  const steps: PlannedStep[] = [];
  const reused: CanvasPlan["reused"] = [];
  let costUsd = 0;
  let costUnknown = false;

  for (const id of inScope) {
    const n = nodes.get(id)!;
    const label = nodeLabel(n);
    if (loop.has(id)) {
      state.set(id, { kind: "blocked" });
      continue;
    }
    const prev = runs[id];
    const prevStatus = prev ? status(prev.ids[0]) : undefined;
    if (n.data.pinned) {
      if (prev && LIVE.has(prevStatus)) {
        state.set(id, { kind: "reuse", id: prev.ids[0] });
        reused.push({ nodeId: id, reason: "pinned", generationId: prev.ids[0] });
      } else {
        state.set(id, { kind: "blocked" });
        errors.push({ nodeId: id, message: "Pinned, but there's no result to use yet — unpin it to run it" });
      }
      continue;
    }
    const d = opts.describe?.(n) ?? describeNode(graph, n, opts);
    if (d.error || !d.request || !d.deps) {
      state.set(id, { kind: "blocked" });
      errors.push({ nodeId: id, message: d.error ?? "Can't run this node" });
      continue;
    }
    const upstream = d.deps.map((dep) => ({ dep, s: state.get(dep) }));
    const blockedBy = upstream.find((u) => !u.s || u.s.kind === "blocked");
    if (blockedBy) {
      state.set(id, { kind: "blocked" });
      errors.push({ nodeId: id, message: `Waiting on “${nodeLabel(nodes.get(blockedBy.dep)!)}” — fix it first` });
      continue;
    }
    let reason: RunReason | null;
    if (upstream.some((u) => u.s!.kind === "run")) reason = prev ? "upstream" : "new";
    else {
      const sig = nodeSignature(d.request, upstream.map((u) => (u.s as { id: string }).id));
      const fresh = !!prev && prev.sig === sig && LIVE.has(prevStatus);
      reason = opts.force && targets.has(id) ? "forced" : fresh ? null : !prev || prevStatus === undefined ? "new" : prev.sig !== sig ? "changed" : "failed";
    }
    if (!reason) {
      state.set(id, { kind: "reuse", id: prev!.ids[0] });
      reused.push({ nodeId: id, reason: "fresh", generationId: prev!.ids[0] });
      continue;
    }
    state.set(id, { kind: "run" });
    steps.push({ nodeId: id, label, request: d.request, deps: d.deps, reason, costUsd: d.costUsd });
    if (d.costUsd === null) costUnknown = true;
    else costUsd += d.costUsd;
  }
  return { order: inScope, steps, reused, errors, costUsd: Math.round(costUsd * 1000) / 1000, costUnknown };
}

// ---------------------------------------------------------------------------
// Engines: switch a whole board to open-source (or cloud) models

/** The equivalent model on the other engine for a node, if there is one. */
export function counterpart(graph: CanvasGraph, n: CanvasNode, engine: Engine): ModelDef | undefined {
  const current = n.data.modelId ? getModel(n.data.modelId) : undefined;
  if (current?.engine === engine) return current;
  if (n.type !== "model") return defaultModelForNode(n, engine);
  const op = n.data.op ?? effectiveOp(graph, n) ?? (current ? current.routes[0].op : KIND_OP[n.data.mediaKind ?? "image"]);
  const kind = current?.kind ?? n.data.mediaKind;
  return defaultModelFor(op, engine) ?? MODELS.find((m) => m.engine === engine && !m.hidden && (!kind || m.kind === kind) && supportsOp(m, op));
}

/** The board with every generator node on `engine`; `missing` lists nodes with no model there. */
export function convertEngine(graph: CanvasGraph, engine: Engine): { graph: CanvasGraph; changed: number; missing: string[] } {
  let changed = 0;
  const missing: string[] = [];
  const nodes = graph.nodes.map((n) => {
    if (!isGenerator(n)) return n;
    const current = n.data.modelId ? getModel(n.data.modelId) : undefined;
    if (current?.engine === engine) return n;
    const m = counterpart(graph, n, engine);
    if (!m) {
      missing.push(n.id);
      return n;
    }
    changed++;
    const keepOp = n.data.op && supportsOp(m, n.data.op) ? n.data.op : undefined;
    return { ...n, data: { ...n.data, modelId: m.id, op: keepOp, params: sanitizeParams(m, n.data.params) } };
  });
  return { graph: { ...graph, nodes }, changed, missing };
}

/** Keep only the settings the new model offers (ratio, duration, resolution…). */
export function sanitizeParams(m: ModelDef, params: GenParams | undefined): GenParams | undefined {
  if (!params) return params;
  const p: GenParams = { ...params };
  if (p.aspectRatio && !m.options.aspectRatios?.includes(p.aspectRatio)) delete p.aspectRatio;
  if (p.resolution && !m.options.resolutions?.includes(p.resolution)) delete p.resolution;
  if (p.duration && m.options.durations && !m.options.durations.includes(p.duration)) delete p.duration;
  if (p.numOutputs && p.numOutputs > (m.options.maxOutputs ?? 4)) p.numOutputs = m.options.maxOutputs ?? 1;
  if (p.voice && !m.options.voices?.some((v) => v.id === p.voice)) delete p.voice;
  if (p.generateAudio !== undefined && !m.options.audio) delete p.generateAudio;
  if (p.extra) delete p.extra;
  return Object.keys(p).length ? p : undefined;
}

/** The engine most generator nodes use (for the header switch); null for a board without models. */
export function graphEngine(graph: CanvasGraph): Engine | null {
  let cloud = 0;
  let open = 0;
  for (const n of graph.nodes) {
    const m = isGenerator(n) && n.data.modelId ? getModel(n.data.modelId) : undefined;
    if (m?.engine === "cloud") cloud++;
    if (m?.engine === "open") open++;
  }
  return cloud + open === 0 ? null : open > cloud ? "open" : "cloud";
}

/** What an element node shows and mentions, from the Elements list. */
export type ElementInfo = { id: string; handle: string; name: string; references: string[] };

/**
 * Element nodes copy the element's name, @handle and first photo when it's picked. Renaming an
 * element gives it a new handle too, so a node is brought up to date by its element's id: the patch
 * for each element node whose element changed (keyed by node id). Elements that are gone, and
 * nodes without one, are left as they are.
 */
export function elementUpdates(graph: CanvasGraph, elements: readonly ElementInfo[]): Map<string, Partial<CanvasNodeData>> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, Partial<CanvasNodeData>>();
  for (const n of graph.nodes) {
    const e = n.type === "element" && n.data.elementId ? byId.get(n.data.elementId) : undefined;
    if (!e) continue;
    const patch: Partial<CanvasNodeData> = {};
    if (n.data.handle !== e.handle) patch.handle = e.handle;
    if (n.data.name !== e.name) patch.name = e.name;
    if ((n.data.preview ?? undefined) !== (e.references[0] ?? undefined)) patch.preview = e.references[0];
    if (Object.keys(patch).length) out.set(n.id, patch);
  }
  return out;
}

/** The graph with every element node up to date (the same graph when nothing changed). */
export function withCurrentElements(graph: CanvasGraph, elements: readonly ElementInfo[]): CanvasGraph {
  const updates = elementUpdates(graph, elements);
  if (!updates.size) return graph;
  return { ...graph, nodes: graph.nodes.map((n) => (updates.has(n.id) ? { ...n, data: { ...n.data, ...updates.get(n.id) } } : n)) };
}

// ---------------------------------------------------------------------------
// Graph hygiene

const NODE_TYPES = new Set(Object.keys(NODE_SPECS));

/** Drop unknown node types, dangling edges and edges into handles that don't exist (after a model or op change). */
export function cleanGraph(graph: CanvasGraph): CanvasGraph {
  const nodes = graph.nodes.filter((n) => NODE_TYPES.has(n.type));
  const g: CanvasGraph = { ...graph, nodes, edges: [] };
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const key = `${e.source}|${e.sourceHandle ?? ""}|${e.target}|${e.targetHandle ?? ""}`;
    if (seen.has(key)) continue;
    const without = { ...g, edges: g.edges };
    if (connectionError(without, e)) continue;
    seen.add(key);
    g.edges.push(e);
  }
  return g;
}

export function outline(graph: CanvasGraph): Outline {
  const nodes = graph.nodes.filter((n) => n.type !== "note").slice(0, 40);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  return {
    boxes: nodes.map((n) => ({ x: Math.round(n.position.x), y: Math.round(n.position.y), type: n.type })),
    links: graph.edges.flatMap((e) => (index.has(e.source) && index.has(e.target) ? [[index.get(e.source)!, index.get(e.target)!] as [number, number]] : [])),
  };
}

let seq = 0;
/** A node or edge id that's unique within a canvas. */
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${seq.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Templates: each in a cloud and an all-open-source variant

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  /** lucide icon name. */
  icon: string;
  hue: number;
  build: (engine: Engine) => CanvasGraph;
}

type ModelPair = { cloud: string; open: string };

interface TplNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  data?: CanvasNodeData;
  models?: ModelPair;
  width?: number;
}

function tpl(nodes: TplNode[], edges: [string, string, string?][]): (engine: Engine) => CanvasGraph {
  return (engine) => {
    const graph: CanvasGraph = {
      nodes: nodes.map((t) => ({
        id: t.id,
        type: t.type,
        position: { x: t.x, y: t.y },
        data: { ...t.data, ...(t.models && { modelId: t.models[engine] }) },
        ...(t.width && { width: t.width }),
      })),
      edges: [],
    };
    graph.edges = edges.map(([source, target, handle], i) => ({
      id: `e${i + 1}`,
      source,
      sourceHandle: OUT,
      target,
      targetHandle: handle ?? PREVIEW_IN,
    }));
    return graph;
  };
}

/** Column and row spacing: a generator node with a result is about 300 × 460 px. */
const COL = 380;
const ROW = 500;
/** A video node with its clip is taller (four inputs, prompt, settings, result). */
const FILM_ROW = 620;

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "image-animate",
    name: "Image → Animate",
    description: "Write a prompt, make a still, bring it to life",
    icon: "Clapperboard",
    hue: 282,
    build: tpl(
      [
        { id: "prompt", type: "prompt", x: 0, y: 80, data: { label: "Prompt", text: "A lighthouse on a sea cliff at golden hour, waves crashing below, cinematic wide shot" } },
        { id: "still", type: "model", x: COL, y: 40, data: { mediaKind: "image", label: "Still", params: { aspectRatio: "16:9" } }, models: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" } },
        { id: "animate", type: "model", x: COL * 2, y: 40, data: { mediaKind: "video", label: "Animate", op: "i2v", prompt: "Slow push-in as the waves roll and the beam sweeps across the sea", params: { aspectRatio: "16:9", duration: 5 } }, models: { cloud: "kling-2-5-turbo", open: "oss-wan22-14b-fast" } },
        { id: "out", type: "output", x: COL * 3, y: 60, data: { label: "Film" } },
      ],
      [
        ["prompt", "still", "prompt"],
        ["still", "animate", "images"],
        ["animate", "out"],
      ],
    ),
  },
  {
    id: "product-angles",
    name: "Product shot → 3 angles → video",
    description: "One product photo, three studio angles, one ad clip",
    icon: "Package",
    hue: 30,
    build: tpl(
      [
        { id: "product", type: "image-input", x: 0, y: ROW, data: { label: "Product photo" } },
        { id: "front", type: "model", x: COL, y: 0, data: { mediaKind: "image", label: "Front ¾ angle", op: "edit", prompt: "The same product from a three-quarter front angle on a seamless studio background, soft key light, sharp details" }, models: { cloud: "nano-banana-pro", open: "oss-qwen-edit" } },
        { id: "side", type: "model", x: COL, y: ROW, data: { mediaKind: "image", label: "Side profile", op: "edit", prompt: "The same product in a clean side profile on a seamless studio background, rim light, sharp details" }, models: { cloud: "nano-banana-pro", open: "oss-qwen-edit" } },
        { id: "top", type: "model", x: COL, y: ROW * 2, data: { mediaKind: "image", label: "Top-down", op: "edit", prompt: "The same product shot top-down as a flat lay on a seamless studio background, even light" }, models: { cloud: "nano-banana-pro", open: "oss-qwen-edit" } },
        { id: "video", type: "model", x: COL * 2, y: ROW - 40, data: { mediaKind: "video", label: "Ad clip", op: "ref2v", prompt: "A premium product commercial: the camera orbits the product from the reference angles, studio lighting, slow and smooth", params: { aspectRatio: "16:9", duration: 5 } }, models: { cloud: "seedance-2-5", open: "oss-wan-vace" } },
        { id: "out", type: "output", x: COL * 3, y: ROW, data: { label: "Ad" } },
      ],
      [
        ["product", "front", "images"],
        ["product", "side", "images"],
        ["product", "top", "images"],
        ["front", "video", "images"],
        ["side", "video", "images"],
        ["top", "video", "images"],
        ["video", "out"],
      ],
    ),
  },
  {
    id: "script-film",
    name: "Script → storyboard → film",
    description: "A text model breaks a short script into three shots: three frames, three clips, one film",
    icon: "GalleryHorizontal",
    hue: 200,
    build: tpl(
      [
        { id: "script", type: "prompt", x: 0, y: FILM_ROW, data: { label: "Script", text: "A paper boat sails down a rain-soaked city gutter, rides a little waterfall into a storm drain and comes out on a sunny canal." } },
        // The script reaches every shot through a text model: edit the script and all three shots follow.
        ...[0, 1, 2].map((i) => ({
          id: `beat${i + 1}`,
          type: "model" as const,
          x: COL,
          y: i * FILM_ROW,
          data: {
            mediaKind: "text" as const,
            label: `Shot ${i + 1} text`,
            op: "write" as const,
            prompt: `Describe shot ${i + 1} of 3 of this script (${["the opening moment", "the turning point", "the ending"][i]}) as one cinematic sentence. Reply with the sentence only.\n\n{text}`,
          },
          models: { cloud: "text-llm", open: "oss-text-llm" },
        })),
        ...[0, 1, 2].map((i) => ({
          id: `frame${i + 1}`,
          type: "model" as const,
          x: COL * 2,
          y: i * FILM_ROW,
          data: { mediaKind: "image" as const, label: `Frame ${i + 1}`, prompt: "Cinematic storyboard still, one consistent look across the film: {text}", params: { aspectRatio: "16:9" } },
          models: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" },
        })),
        ...[0, 1, 2].map((i) => ({
          id: `shot${i + 1}`,
          type: "model" as const,
          x: COL * 3,
          y: i * FILM_ROW,
          data: { mediaKind: "video" as const, label: `Shot ${i + 1}`, op: "i2v" as const, prompt: "Animate this moment, smooth cinematic camera move: {text}", params: { aspectRatio: "16:9", duration: 5 } },
          models: { cloud: "kling-2-5-turbo", open: "oss-wan22-14b-fast" },
        })),
        { id: "film", type: "join", x: COL * 4, y: FILM_ROW / 2, data: { label: "Film" }, models: { cloud: "join-clips", open: "oss-join-clips" } },
        { id: "out", type: "output", x: COL * 4, y: FILM_ROW * 1.5, data: { label: "Film" } },
      ],
      [
        ["script", "beat1", "prompt"],
        ["script", "beat2", "prompt"],
        ["script", "beat3", "prompt"],
        ["beat1", "frame1", "prompt"],
        ["beat2", "frame2", "prompt"],
        ["beat3", "frame3", "prompt"],
        ["beat1", "shot1", "prompt"],
        ["beat2", "shot2", "prompt"],
        ["beat3", "shot3", "prompt"],
        ["frame1", "shot1", "images"],
        ["frame2", "shot2", "images"],
        ["frame3", "shot3", "images"],
        ["shot1", "film", "videos"],
        ["shot2", "film", "videos"],
        ["shot3", "film", "videos"],
        ["film", "out"],
      ],
    ),
  },
  {
    id: "compare-image",
    name: "Compare 3 image models",
    description: "One prompt, three models, side by side",
    icon: "Columns3",
    hue: 150,
    build: (engine) => {
      const models = engine === "open" ? ["oss-z-image-turbo", "oss-qwen-image", "oss-flux1-krea"] : ["nano-banana-pro", "seedream-5-pro", "flux-2-pro"];
      return tpl(
        [
          { id: "prompt", type: "prompt", x: 0, y: ROW - 60, data: { label: "Prompt", text: "Portrait of an elderly fisherman mending a net at dawn, soft window light, film grain" } },
          ...models.map((m, i) => ({ id: `m${i + 1}`, type: "model" as const, x: COL, y: i * (ROW - 60), data: { mediaKind: "image" as const, modelId: m, params: { aspectRatio: "3:4" } } })),
          { id: "out", type: "output", x: COL * 2, y: ROW - 120, data: { label: "Compare" }, width: 560 },
        ],
        [["prompt", "m1", "prompt"], ["prompt", "m2", "prompt"], ["prompt", "m3", "prompt"], ["m1", "out"], ["m2", "out"], ["m3", "out"]],
      )(engine);
    },
  },
  {
    id: "talking-avatar",
    name: "Portrait → talking avatar with a cloned voice",
    description: "A photo, a short voice sample and a script make a talking clip",
    icon: "Mic2",
    hue: 340,
    build: tpl(
      [
        { id: "portrait", type: "image-input", x: 0, y: 0, data: { label: "Portrait" } },
        { id: "sample", type: "audio-input", x: 0, y: 340, data: { label: "Voice sample (10–30 s)" } },
        { id: "script", type: "prompt", x: 0, y: 540, data: { label: "Script", text: "Hi! This whole clip was made on a Fuobe canvas from one photo and a few seconds of my voice." } },
        { id: "voice", type: "tts", x: COL, y: 400, data: { label: "Cloned voice" }, models: { cloud: "chatterbox-cloud", open: "oss-chatterbox" } },
        { id: "avatar", type: "model", x: COL * 2, y: 80, data: { mediaKind: "video", label: "Talking avatar", op: "avatar", prompt: "A friendly presenter talking to the camera, natural head movement" }, models: { cloud: "kling-avatar-2", open: "oss-infinitetalk" } },
        { id: "out", type: "output", x: COL * 3, y: 100, data: { label: "Clip" } },
      ],
      [
        ["sample", "voice", "voice"],
        ["script", "voice", "prompt"],
        ["portrait", "avatar", "images"],
        ["voice", "avatar", "audio"],
        ["avatar", "out"],
      ],
    ),
  },
];

export function getTemplate(id: string): CanvasTemplate | undefined {
  return CANVAS_TEMPLATES.find((t) => t.id === id);
}
