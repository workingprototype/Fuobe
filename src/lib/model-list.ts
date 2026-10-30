/**
 * The model list scripts and the `fuobe` CLI read (`GET /api/models`): the Models page's row plus
 * what a request needs (operation ids, the sizes and lengths a model takes), filtered the way the
 * CLI asks (kind, engine, operation, search words).
 */
import { modelSearchText, toModelRow, type ModelRow } from "./model-rows";
import { onEngine, runsOn } from "./catalog/engines";
import type { Engine, MediaKind, ModelDef, Operation } from "./catalog/types";

export const MODEL_KINDS: MediaKind[] = ["image", "video", "audio", "text", "model3d"];

export interface ModelInfo extends ModelRow {
  /** Operation ids it runs (t2i, i2v, tts…): what a request's `op` can be. */
  opIds: Operation[];
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[];
  /** Reference / input images it takes at most. */
  maxImages?: number;
  /** Outputs one run can make. */
  maxOutputs?: number;
  /** Native sound: true = can be switched on, "always" = always on. */
  audio?: boolean | "always";
  endFrame?: boolean;
  /** Premade voice ids (text to speech, voice change). */
  voices?: string[];
  /** Takes a voice sample (`inputs.voiceAudio`) and speaks or changes into that voice. */
  voiceClone?: true;
  /** Not offered by any studio picker (chain helpers); runs when asked for by id. */
  hidden?: true;
}

export function toModelInfo(m: ModelDef): ModelInfo {
  const o = m.options;
  return {
    ...toModelRow(m),
    opIds: [...new Set(m.routes.map((r) => r.op))],
    ...(o.aspectRatios?.length && { aspectRatios: o.aspectRatios }),
    ...(o.resolutions?.length && { resolutions: o.resolutions }),
    ...(o.durations?.length && { durations: o.durations }),
    ...(o.maxImages && { maxImages: o.maxImages }),
    ...(o.maxOutputs && { maxOutputs: o.maxOutputs }),
    ...(o.audio && { audio: o.audio }),
    ...(o.endFrame && { endFrame: true }),
    ...(o.voices?.length && { voices: o.voices.map((v) => v.id) }),
    ...(o.voiceClone && { voiceClone: true as const }),
    ...(m.hidden && { hidden: true as const }),
  };
}

export interface ModelQuery {
  kind?: MediaKind;
  engine?: Engine;
  op?: Operation;
  /** Words that must all appear in the name, vendor, description, operations or id. */
  q?: string;
  /** Include hidden helper models. */
  hidden?: boolean;
}

/** The models matching a query, in catalog order. */
export function findModels(models: ModelDef[], query: ModelQuery): ModelDef[] {
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    // A Fuobe Original runs on both engines, so either engine's list has it.
    if ((m.hidden && !query.hidden) || (query.kind && m.kind !== query.kind) || (query.engine && !runsOn(m, query.engine))) return false;
    // An Original does on an engine what that engine's routes do (Fuobe DoP films keyframes on the GPU only).
    if (query.op && !(query.engine ? onEngine(m, query.engine) : m).routes.some((r) => r.op === query.op)) return false;
    if (!words.length) return true;
    const text = `${modelSearchText(toModelRow(m))} ${m.family} ${m.routes.map((r) => r.op).join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
