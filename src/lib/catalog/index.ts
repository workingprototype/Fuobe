import { APPS as RAW_APPS } from "./apps";
import { EFFECTS as RAW_EFFECTS, MOTIONS as RAW_MOTIONS } from "./motions";
import { MODELS } from "./models";
import { OSS_LORAS } from "./oss-loras.generated";
import type { Engine, MediaKind, ModelDef, Operation, Preset } from "./types";

export { MODELS };

const modelIndex = new Map(MODELS.map((m) => [m.id, m]));
/**
 * Attach researched Wan LoRAs (and their trigger words) to the open-source route of
 * motions/effects whose name matches a Higgsfield preset. See scripts/gen-oss-loras.py.
 */
function withOssLoras(p: Preset): Preset {
  if (!p.open || p.open.loras?.length || p.open.modelId !== "oss-wan22-14b") return p;
  const loras = OSS_LORAS[p.id.replace(/^(motion|effect|app)-/, "")];
  if (!loras?.length) return p;
  const trigger = loras.find((l) => l.trigger)?.trigger;
  return {
    ...p,
    open: {
      ...p.open,
      loras: loras.map(({ file, url, strength, trigger: t, target }) => ({ file, url, strength, trigger: t, target })),
      promptTemplate: trigger ? `${trigger}. ${p.open.promptTemplate ?? p.promptTemplate}` : p.open.promptTemplate,
    },
    parity: `Open version adds ${loras.map((l) => l.file).join(" + ")}${loras.some((l) => l.base.startsWith("wan2.1")) ? " (Wan 2.1 LoRA on Wan 2.2 — validate per GPU run)" : ""}`,
  };
}

/**
 * Camera moves Wan 2.2 Fun Camera supports natively. Motions without a dedicated LoRA run
 * on that workflow with an explicit camera pose instead of prompt-only camera language.
 */
const FUN_CAMERA_POSE: Record<string, string> = {
  "motion-pan-left": "Pan Left",
  "motion-pan-right": "Pan Right",
  "motion-tilt-up": "Pan Up",
  "motion-tilt-down": "Pan Down",
  "motion-zoom-in": "Zoom In",
  "motion-zoom-out": "Zoom Out",
  "motion-rapid-zoom-in": "Zoom In",
  "motion-rapid-zoom-out": "Zoom Out",
  "motion-dolly-out": "Zoom Out",
  "motion-static": "Static",
  "motion-dutch-angle": "ClockWise (CW)",
  "motion-roll-left": "Anti Clockwise (ACW)",
  "motion-roll-right": "ClockWise (CW)",
};

function withFunCamera(p: Preset): Preset {
  const pose = FUN_CAMERA_POSE[p.id];
  if (!pose || !p.open || p.open.loras?.length) return p;
  return {
    ...p,
    open: { ...p.open, modelId: "oss-wan22-fun-camera", op: "i2v", params: { ...p.open.params, extra: { cameraMotion: pose } } },
    parity: `Open version uses Wan 2.2 Fun Camera with the "${pose}" camera pose`,
  };
}

/** Open-source routes that need a dedicated workflow rather than an edit prompt. */
const APP_OPEN_OVERRIDES: Record<string, Preset["open"]> = {
  "app-face-swap": { modelId: "oss-reactor", op: "face-swap" },
  // Qwen-Image-Edit with the Relight LoRA beats a plain edit prompt for lighting changes.
  "app-relight": { modelId: "oss-qwen-relight", op: "edit" },
};

export const APPS: Preset[] = RAW_APPS.map((a) => (APP_OPEN_OVERRIDES[a.id] ? { ...a, open: APP_OPEN_OVERRIDES[a.id] } : a)).map(withOssLoras);
export const MOTIONS: Preset[] = RAW_MOTIONS.map(withOssLoras).map(withFunCamera);
export const EFFECTS: Preset[] = RAW_EFFECTS.map(withOssLoras);
export const PRESETS: Preset[] = [...APPS, ...MOTIONS, ...EFFECTS];
const presetIndex = new Map(PRESETS.map((p) => [p.id, p]));

export function getModel(id: string): ModelDef | undefined {
  return modelIndex.get(id);
}

export function getPreset(id: string): Preset | undefined {
  return presetIndex.get(id);
}

export function modelsFor(opts: { kind?: MediaKind; ops?: Operation[]; engine?: Engine | "all" }): ModelDef[] {
  return MODELS.filter(
    (m) =>
      !m.hidden &&
      (!opts.kind || m.kind === opts.kind) &&
      (!opts.engine || opts.engine === "all" || m.engine === opts.engine) &&
      (!opts.ops || m.routes.some((r) => opts.ops!.includes(r.op))),
  );
}

export function supportsOp(model: ModelDef, op: Operation): boolean {
  return model.routes.some((r) => r.op === op);
}
