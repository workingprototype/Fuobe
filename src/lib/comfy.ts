/**
 * Pure helpers for ComfyUI API-format workflows: manifest types, binding application,
 * LoRA injection and size/frame math. No I/O here so it is easy to unit test.
 */
import type { LoraRef, MediaKind } from "./catalog/types";

export type ComfyNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ComfyWorkflow = Record<string, ComfyNode>;

export interface BindingTarget {
  node: string;
  input: string;
}

export type BindingKey =
  | "prompt"
  | "negativePrompt"
  | "image"
  | "image2"
  | "image3"
  | "image4"
  | "mask"
  | "endImage"
  | "video"
  | "audio"
  | "width"
  | "height"
  | "frames"
  | "fps"
  | "seed"
  | "steps"
  | "cfg"
  | "guidance"
  | "denoise"
  | "shift"
  | "loraHigh"
  | "loraLow"
  | "lora"
  | "loraStrength"
  | "upscaleModel"
  | "scale"
  | "duration"
  | "lyrics"
  | "tags"
  | (string & {});

export interface ManifestModel {
  file: string;
  folder: string;
  url?: string;
  sizeGb?: number;
}

export interface ManifestWorkflow {
  id: string;
  title: string;
  capability: string;
  file: string;
  source: string;
  bindings: Partial<Record<BindingKey, BindingTarget[]>>;
  outputs: { node: string; kind: MediaKind }[];
  defaults: Record<string, number | string>;
  limits?: Record<string, number>;
  models: ManifestModel[];
  customNodes: { name: string; repo: string }[];
  vramGb?: number | string;
  validated: boolean;
  notes?: string;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  comfyuiCommit?: string;
  workflows: ManifestWorkflow[];
}

export function cloneWorkflow(wf: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(wf)) as ComfyWorkflow;
}

/** Write values into the workflow. Unknown nodes are reported, not silently ignored. */
export function applyBindings(
  wf: ComfyWorkflow,
  bindings: ManifestWorkflow["bindings"],
  values: Partial<Record<BindingKey, unknown>>,
): { workflow: ComfyWorkflow; missing: string[] } {
  const out = cloneWorkflow(wf);
  const missing: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const targets = bindings[key as BindingKey];
    if (!targets) continue;
    for (const t of targets) {
      const node = out[t.node];
      if (!node) {
        missing.push(`${key} → node ${t.node}`);
        continue;
      }
      node.inputs[t.input] = value;
    }
  }
  return { workflow: out, missing };
}

const MODEL_LOADERS = new Set(["UNETLoader", "CheckpointLoaderSimple", "UnetLoaderGGUF", "ImageOnlyCheckpointLoader"]);

/**
 * Insert LoraLoaderModelOnly nodes after every diffusion model loader (or only the
 * high/low-noise expert for Wan 2.2 MoE when a LoRA targets one of them) and rewire
 * all consumers of the loader's MODEL output.
 */
export function injectLoras(
  wf: ComfyWorkflow,
  loras: (LoraRef & { target?: "high" | "low" | "both" })[],
): ComfyWorkflow {
  if (!loras.length) return wf;
  const out = cloneWorkflow(wf);
  const loaders = Object.entries(out).filter(([, n]) => MODEL_LOADERS.has(n.class_type));
  let nextId = Math.max(1000, ...Object.keys(out).map((k) => Number(k.split(":").pop()) || 0)) + 1;
  for (const [loaderId, loader] of loaders) {
    const fileName = String(loader.inputs.unet_name ?? loader.inputs.ckpt_name ?? "");
    const expert = /high[_-]?noise/i.test(fileName) ? "high" : /low[_-]?noise/i.test(fileName) ? "low" : "both";
    const applicable = loras.filter((l) => !l.target || l.target === "both" || expert === "both" || l.target === expert);
    if (!applicable.length) continue;
    let upstream: [string, number] = [loaderId, 0];
    const chainIds: string[] = [];
    for (const lora of applicable) {
      const id = String(nextId++);
      out[id] = {
        class_type: "LoraLoaderModelOnly",
        inputs: { model: upstream, lora_name: lora.file, strength_model: lora.strength ?? 1 },
        _meta: { title: `LoRA ${lora.file}` },
      };
      chainIds.push(id);
      upstream = [id, 0];
    }
    for (const [id, node] of Object.entries(out)) {
      if (chainIds.includes(id)) continue;
      for (const [k, v] of Object.entries(node.inputs)) {
        if (Array.isArray(v) && v[0] === loaderId && v[1] === 0) node.inputs[k] = upstream;
      }
    }
  }
  return out;
}

const RES_SHORT_SIDE: Record<string, number> = {
  "360p": 360,
  "480p": 480,
  "540p": 544,
  "580p": 576,
  "720p": 720,
  "768p": 768,
  "1080p": 1088,
};

const RES_AREA: Record<string, number> = {
  "0.5K": 512 * 512,
  "1K": 1024 * 1024,
  "1MP": 1024 * 1024,
  "1.5K": 1536 * 1536,
  "2K": 2048 * 2048,
  "4K": 4096 * 4096,
};

function parseRatio(ar: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

const roundTo = (v: number, m: number) => Math.max(m, Math.round(v / m) * m);

/** Width/height for an aspect ratio, keeping the workflow's default pixel budget unless a resolution tier is given. */
export function computeDimensions(
  aspectRatio: string | undefined,
  resolution: string | undefined,
  defaults: { width?: number; height?: number },
  multiple = 16,
): { width: number; height: number } {
  const dw = Number(defaults.width ?? 1024);
  const dh = Number(defaults.height ?? 1024);
  const ratio = (aspectRatio && parseRatio(aspectRatio)) || dw / dh;
  if (resolution && RES_SHORT_SIDE[resolution]) {
    const short = RES_SHORT_SIDE[resolution];
    return ratio >= 1
      ? { width: roundTo(short * ratio, multiple), height: roundTo(short, multiple) }
      : { width: roundTo(short, multiple), height: roundTo(short / ratio, multiple) };
  }
  const area = (resolution && RES_AREA[resolution]) || dw * dh;
  const height = Math.sqrt(area / ratio);
  return { width: roundTo(height * ratio, multiple), height: roundTo(height, multiple) };
}

/** Frame count for a duration. Wan/Hunyuan want 4n+1, LTX wants 8n+1. */
export function computeFrames(durationSec: number, fps: number, step = 4, maxFrames?: number): number {
  let frames = Math.round((durationSec * fps) / step) * step + 1;
  if (maxFrames) while (frames > maxFrames) frames -= step;
  return Math.max(step + 1, frames);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48);
}

/** Collect every model filename referenced by loader nodes in a workflow. */
export function referencedModels(wf: ComfyWorkflow): string[] {
  const keys = ["unet_name", "ckpt_name", "clip_name", "clip_name1", "clip_name2", "clip_name3", "vae_name", "lora_name", "model_name", "audio_encoder_name", "clip_vision_name"];
  const files = new Set<string>();
  for (const n of Object.values(wf)) {
    for (const k of keys) {
      const v = n.inputs[k];
      if (typeof v === "string" && /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(v)) files.add(v);
    }
  }
  return [...files];
}

/** Turn a ComfyUI validation error into a human sentence with a fix. */
export function explainComfyError(nodeErrors: unknown, manifest?: ManifestWorkflow): string {
  const parts: string[] = [];
  const errs = (nodeErrors ?? {}) as Record<string, { errors?: { message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }[]; class_type?: string }>;
  for (const [nodeId, ne] of Object.entries(errs)) {
    for (const e of ne.errors ?? []) {
      const received = e.extra_info?.received_value;
      if (e.message?.includes("not in list") && typeof received === "string") {
        const m = manifest?.models.find((mm) => mm.file === received);
        parts.push(
          m
            ? `Missing model "${received}" — put it in ComfyUI/models/${m.folder}${m.url ? ` (download: ${m.url})` : ""}`
            : `ComfyUI can't find "${received}" (${ne.class_type ?? nodeId}.${e.extra_info?.input_name ?? "input"})`,
        );
      } else {
        parts.push(`${ne.class_type ?? `node ${nodeId}`}: ${e.message ?? "error"}${e.details ? ` — ${e.details}` : ""}`);
      }
    }
  }
  return [...new Set(parts)].join("\n") || "ComfyUI rejected the workflow";
}
