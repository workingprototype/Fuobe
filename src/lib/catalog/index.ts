import { APPS } from "./apps";
import { EFFECTS, MOTIONS } from "./motions";
import { MODELS } from "./models";
import type { Engine, MediaKind, ModelDef, Operation, Preset } from "./types";

export { MODELS, APPS, MOTIONS, EFFECTS };

const modelIndex = new Map(MODELS.map((m) => [m.id, m]));
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
