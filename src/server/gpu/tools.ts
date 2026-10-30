import "server-only";
import { SPLIT_MODEL } from "@/lib/av/split";
import { getModel, getPreset, MODELS, modelsFor, PRESETS } from "@/lib/catalog";
import { graphLoras } from "@/lib/catalog/character-swap";
import { PATH_MODELS } from "@/lib/catalog/cinema";
import { dualEngine, onEngine, runsOn } from "@/lib/catalog/engines";
import { FRAMES_MODELS } from "@/lib/catalog/keyframes";
import { libraryEntry, needsToken } from "@/lib/catalog/loras";
import { ANGLES_2511_LORA } from "@/lib/catalog/open-tools";
import { STUDIO_WORKFLOWS } from "@/lib/catalog/swap-studio-plan";
import { FILL_MODELS } from "@/lib/catalog/turnaround";

/** The open engine's Join clips (a turnaround's quarter turns become one film). */
const JOIN_CLIPS_MODEL = "oss-join-clips";
import type { LoraRef, ModelDef, Operation } from "@/lib/catalog/types";
import type { LoraNeed } from "@/lib/gpu/readiness";
import { basename } from "@/lib/gpu/requirements";
import type { StudioGroup, ToolRef } from "@/lib/gpu/types";
import * as S from "@/lib/studios";
import type { StudioConfig } from "@/components/studio/studio-context";
import { loadIndex } from "./index-file";

/**
 * From the tools people pick (a model's operation, a preset, a studio's open default) to the workflows and
 * LoRAs they run (SPEC §4.4). Variants (a camera pose, EXR frames…) count only when a request asks for them:
 * the gate resolves those per request (src/lib/comfy-variants.ts). Nothing here reads a key or a token: LoRA
 * downloads are described by their public URL and page only (review item 5).
 */

export interface Tool {
  ref: ToolRef;
  name: string;
  kind?: string;
  workflows: string[];
  loras: LoraNeed[];
  /** The same tool on the cloud engine (an Original that runs on both). */
  cloud?: { modelId: string };
  /** Runs in the browser (no ComfyUI): always ready. */
  local?: boolean;
}

/** A LoRA as the plan describes it: its file, public URL, page, size and how it downloads. */
export function loraNeed(l: Pick<LoraRef, "file" | "url">): LoraNeed {
  const e = libraryEntry(l);
  const url = e?.url ?? l.url;
  return {
    file: basename(l.file),
    ...(url && { url }),
    ...(e?.sizeBytes && { sizeBytes: e.sizeBytes }),
    ...(e?.sha256 && { sha256: e.sha256 }),
    download: e?.download ?? (needsToken(url) ? "civitai-token" : "direct"),
    ...(e?.page && { page: e.page }),
  };
}

/** A route endpoint's workflows: "video-concat-{n}" is one per clip count. */
function expand(endpoint: string): string[] {
  const ids = Object.keys(loadIndex().workflows);
  if (!endpoint.includes("{")) return ids.includes(endpoint) ? [endpoint] : [];
  const re = new RegExp(`^${endpoint.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "\\d+")}$`);
  return ids.filter((id) => re.test(id));
}

/** The model as it runs on the open engine (an Original's GPU routes), or undefined when it has none. */
function openModel(m: ModelDef | undefined): ModelDef | undefined {
  if (!m) return undefined;
  if (dualEngine(m)) return runsOn(m, "open") ? onEngine(m, "open") : undefined;
  return m.engine === "open" ? m : undefined;
}

function modelOps(m: ModelDef): Operation[] {
  return [...new Set(m.routes.filter((r) => r.provider === "comfyui" || r.provider === "local").map((r) => r.op))];
}

/** A model's operation on the open engine. */
export function modelTool(modelId: string, op: string): Tool | null {
  const full = getModel(modelId);
  const m = openModel(full);
  if (!m) return null;
  const routes = m.routes.filter((r) => r.op === op && (r.provider === "comfyui" || r.provider === "local"));
  if (!routes.length) return null;
  const workflows = [...new Set(routes.filter((r) => r.provider === "comfyui").flatMap((r) => expand(r.endpoint)))];
  const loras = (m.options.loras ?? []).map(loraNeed);
  return {
    ref: `model:${modelId}#${op}`,
    name: m.name,
    kind: m.kind,
    workflows,
    loras,
    ...(full && dualEngine(full) && runsOn(full, "cloud") && { cloud: { modelId } }),
    ...(!workflows.length && { local: true }),
  };
}

/** A preset: its open route, its prestep's, and their LoRAs. */
export function presetTool(presetId: string): Tool | null {
  const p = getPreset(presetId);
  if (!p?.open) return null;
  const main = modelTool(p.open.modelId, p.open.op);
  if (!main) return null;
  const pre = p.prestep?.open ? modelTool(p.prestep.open.modelId, p.prestep.open.op) : null;
  const loras = new Map<string, LoraNeed>();
  for (const l of [...(p.open.loras ?? []), ...(p.prestep?.open.loras ?? [])]) loras.set(basename(l.file), loraNeed(l));
  for (const l of [...main.loras, ...(pre?.loras ?? [])]) loras.set(l.file, l);
  return {
    ref: `preset:${p.id}`,
    name: p.name,
    kind: main.kind,
    workflows: [...new Set([...main.workflows, ...(pre?.workflows ?? [])])],
    loras: [...loras.values()],
    ...(p.cloud && main.cloud && { cloud: { modelId: p.cloud.modelId } }),
    ...(main.local && !pre && { local: true }),
  };
}

export interface StudioRowDef {
  href: string;
  label: string;
  group: StudioGroup;
  config?: StudioConfig;
  /** A studio with graphs of its own (Character swap). */
  workflows?: string[];
  /**
   * A tool that runs open models' operations in steps (Split soundtrack, Cinema's fly path, the turnaround): their graphs
   * and LoRAs together, with the LoRAs a step adds itself (the turnaround's Angles LoRA). The first names the tool.
   */
  steps?: { modelId: string; op: Operation; loras?: LoraRef[] }[];
}

/** The board's rows (src/lib/hubs.ts names the hub modes): each studio's open default. */
export const STUDIO_ROWS: StudioRowDef[] = [
  { href: "/image", label: "Image", group: "Images", config: S.IMAGE_STUDIO },
  { href: "/edit", label: "Edit", group: "Images", config: S.EDIT_STUDIO },
  { href: "/inpaint", label: "Inpaint", group: "Images", config: S.INPAINT_STUDIO },
  { href: "/upscale", label: "Upscale", group: "Images", config: S.UPSCALE_STUDIO },
  { href: "/video", label: "Video", group: "Video", config: S.VIDEO_STUDIO },
  { href: "/motion-control", label: "Motion control", group: "Video", config: S.MOTION_CONTROL_STUDIO },
  { href: "/video-edit", label: "Edit video", group: "Video", config: S.VIDEO_EDIT_STUDIO },
  { href: "/extend", label: "Extend", group: "Video", config: S.EXTEND_STUDIO },
  { href: "/reframe", label: "Reframe", group: "Video", config: S.REFRAME_STUDIO },
  { href: "/lipsync", label: "Lipsync", group: "Video", config: S.LIPSYNC_STUDIO },
  { href: "/character-swap", label: "Character swap", group: "Video", workflows: [STUDIO_WORKFLOWS.mask, STUDIO_WORKFLOWS.segment] },
  // Cinema's 3D scene films a still along a keyframed camera path (N7-5).
  { href: "/cinema", label: "Fly path", group: "Video", steps: [{ modelId: PATH_MODELS.open, op: "camera-path" }] },
  // The turnaround (N7-6): Frames mode's start/end-frame clips joined into one film, with the sides it has no picture of
  // drawn first by the Angles app (src/lib/catalog/turnaround.ts).
  {
    href: "/character-sheet",
    label: "Turnaround",
    group: "Video",
    steps: [
      { modelId: FRAMES_MODELS.open.id, op: "keyframes" },
      { modelId: JOIN_CLIPS_MODEL, op: "concat" },
      { modelId: FILL_MODELS.open, op: "edit", loras: [ANGLES_2511_LORA] },
    ],
  },
  { href: "/audio", label: "Voice", group: "Audio", config: S.AUDIO_STUDIO },
  { href: "/audio/dialogue", label: "Dialogue", group: "Audio", config: S.DIALOGUE_STUDIO },
  { href: "/audio/voice-change", label: "Voice change", group: "Audio", config: S.VOICE_CHANGE_STUDIO },
  { href: "/audio/transcribe", label: "Transcribe", group: "Audio", config: S.TRANSCRIBE_STUDIO },
  // DBS soundtrack separation (D1): dialogue, music and effects.
  { href: "/audio/split", label: "Split soundtrack", group: "Audio", steps: [{ modelId: SPLIT_MODEL, op: "separate-audio" }] },
  { href: "/audio/sfx", label: "Sound effects", group: "Audio", config: S.SFX_STUDIO },
  { href: "/audio/music", label: "Music", group: "Audio", config: S.MUSIC_STUDIO },
  { href: "/audio/video", label: "Sound for video", group: "Audio", config: S.FOLEY_STUDIO },
  { href: "/upscale/video", label: "Upscale video", group: "Video tools", config: S.VIDEO_UPSCALE_STUDIO },
  { href: "/upscale/fps", label: "FPS boost", group: "Video tools", config: S.FPS_BOOST_STUDIO },
  { href: "/upscale/hdr", label: "SDR to HDR", group: "Video tools", config: S.SDR_TO_HDR_STUDIO },
  { href: "/upscale/export", label: "Export", group: "Video tools", config: S.VIDEO_EXPORT_STUDIO },
  { href: "/video-tools", label: "Remove background", group: "Video tools", config: S.VIDEO_MATTE_STUDIO },
  { href: "/video-tools/relight", label: "Relight", group: "Video tools", config: S.VIDEO_RELIGHT_STUDIO },
  { href: "/video-tools/depth", label: "Depth map", group: "Video tools", config: S.VIDEO_DEPTH_STUDIO },
  { href: "/video-tools/join", label: "Join clips", group: "Video tools", config: S.JOIN_CLIPS_STUDIO },
  { href: "/video-tools/colors", label: "Match colors", group: "Video tools", config: S.VIDEO_COLOR_MATCH_STUDIO },
];

/** A studio row's tool: its open default model on the studio's operations (or its own graphs, or its steps). */
export function studioTool(row: StudioRowDef): Tool | null {
  if (row.steps) {
    const parts = row.steps.flatMap((s) => {
      const t = modelTool(s.modelId, s.op);
      return t ? [{ ...t, loras: [...t.loras, ...(s.loras ?? []).map(loraNeed)] }] : [];
    });
    if (parts.length !== row.steps.length) return null;
    const loras = new Map(parts.flatMap((p) => p.loras).map((l) => [l.file, l]));
    return {
      ref: `studio:${row.href}`,
      name: parts[0].name,
      kind: parts[0].kind,
      workflows: [...new Set(parts.flatMap((p) => p.workflows))],
      loras: [...loras.values()],
      ...(parts.every((p) => p.local) && { local: true }),
    };
  }
  if (row.workflows) {
    const segment = row.workflows[row.workflows.length - 1];
    return { ref: `studio:${row.href}`, name: row.label, kind: "video", workflows: row.workflows.filter((w) => !!loadIndex().workflows[w]), loras: graphLoras(segment, {}).map(loraNeed) };
  }
  const c = row.config;
  const id = c?.defaultModels.open;
  if (!c || !id) return null;
  const m = openModel(getModel(id));
  if (!m) return null;
  const ops = modelOps(m).filter((op) => c.ops.includes(op));
  const parts = (ops.length ? ops : modelOps(m)).map((op) => modelTool(id, op)).filter((t): t is Tool => !!t);
  if (!parts.length) return null;
  return {
    ref: `studio:${row.href}`,
    name: m.name,
    kind: m.kind,
    workflows: [...new Set(parts.flatMap((p) => p.workflows))],
    loras: parts[0].loras,
    ...(parts[0].cloud && { cloud: parts[0].cloud }),
    ...(parts.every((p) => p.local) && { local: true }),
  };
}

/** A studio's other open models (for "2 other tools fit your GPU"). */
export function studioOthers(row: StudioRowDef): Tool[] {
  const c = row.config;
  if (!c) return [];
  const ops = c.pickerOps ?? c.ops;
  return modelsFor({ kind: c.kind, ops, engine: "open" })
    .filter((m) => m.id !== c.defaultModels.open)
    .flatMap((m) => {
      const op = modelOps(openModel(m) ?? m).find((o) => ops.includes(o));
      const t = op ? modelTool(m.id, op) : null;
      return t ? [t] : [];
    });
}

/** Every open model's operations (the model picker's and composer's chips). */
export function openModelTools(): Tool[] {
  const out: Tool[] = [];
  for (const m of MODELS) {
    const o = openModel(m);
    if (!o) continue;
    for (const op of modelOps(o)) {
      const t = modelTool(m.id, op);
      if (t) out.push(t);
    }
  }
  return out;
}

/** Every preset with an open route (the gallery's chips). */
export function presetTools(): Tool[] {
  return PRESETS.flatMap((p) => {
    const t = presetTool(p.id);
    return t ? [t] : [];
  });
}

let loraNamesCache: string[] | null = null;

/** Every LoRA a preset or a recipe names (what a full check looks for in models/loras). */
export function allLoraNames(): string[] {
  loraNamesCache ??= [...new Set([...presetTools(), ...openModelTools()].flatMap((t) => t.loras.map((l) => l.file)))].sort();
  return loraNamesCache;
}

/** A tool by reference (the plan route takes these from the client: only refs, never URLs or names, R2). */
export function toolFor(ref: string): Tool | null {
  const m = /^model:([^#]+)#(.+)$/.exec(ref);
  if (m) return modelTool(m[1], m[2]);
  const p = /^preset:(.+)$/.exec(ref);
  if (p) return presetTool(p[1]);
  const s = /^studio:(.+)$/.exec(ref);
  if (s) {
    const row = STUDIO_ROWS.find((r) => r.href === s[1]);
    return row ? studioTool(row) : null;
  }
  const w = /^workflow:(.+)$/.exec(ref);
  if (w && loadIndex().workflows[w[1]]) return { ref: `workflow:${w[1]}`, name: w[1], workflows: [w[1]], loras: [] };
  return null;
}
