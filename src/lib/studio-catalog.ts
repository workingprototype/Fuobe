/**
 * The slice of the model catalog one studio needs, computed on the server and passed to the
 * studio page as a prop, so the browser never downloads the whole catalog (every cloud, Higgsfield
 * and open model, 121 apps, 363 motions and effects). Only the composer's lookups are kept:
 * provider field maps stay on the server, which plans and builds the real request itself.
 */
import { getModel, modelsFor } from "./catalog";
import type { ModelDef } from "./catalog/types";
import type { StudioConfig } from "@/components/studio/studio-context";

export interface StudioCatalog {
  /** Models the composer can use or look up (picker list + defaults + the preset's own models). */
  models: ModelDef[];
}

/** A model without its provider field maps (server-only detail). */
export function slimModel(m: ModelDef): ModelDef {
  return {
    ...m,
    routes: m.routes.map((r) => {
      const copy = { ...r };
      delete copy.map;
      return copy;
    }),
  };
}

export function studioCatalog(config: Pick<StudioConfig, "kind" | "ops" | "pickerOps" | "defaultModels" | "preset" | "extraModels">): StudioCatalog {
  const list = modelsFor({ kind: config.kind, ops: config.pickerOps ?? config.ops });
  const ids = new Set(list.map((m) => m.id));
  const extra = [config.defaultModels.cloud, config.defaultModels.open, config.preset?.cloud?.modelId, config.preset?.open?.modelId, ...(config.extraModels ?? [])]
    .filter((id): id is string => !!id && !ids.has(id))
    .map((id) => getModel(id))
    .filter((m): m is ModelDef => !!m);
  return { models: [...list, ...new Map(extra.map((m) => [m.id, m])).values()].map(slimModel) };
}
