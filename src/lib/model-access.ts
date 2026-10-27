/**
 * Settings → Models & licences: which models, licence classes, providers, node packs and LoRAs this install
 * offers. Licences are information (src/lib/licences.ts); these switches are the admin's decision, and
 * everything is on until someone turns it off. Pure logic, no I/O and no catalog import: the server reads
 * the switches (src/server/model-access.ts) and the browser filters its pickers with the summary
 * /api/status sends.
 *
 * A route is off when its model, its provider, one of its node packs or its licence class is switched off.
 * A model is off when none of its routes is on; a Fuobe Original with one engine's routes off runs on the
 * other one only.
 */
import { CLASS_LABEL, LICENCE_CLASSES, PROVIDER_NAME, type LicenceClass } from "./licences";
import { enginesOf, providerEngine } from "./catalog/engines";
import type { Engine, ModelDef, ModelRoute } from "./catalog/types";

/** What is switched off; anything not listed is on. */
export interface ModelAccess {
  /** Model ids. */
  models: string[];
  classes: LicenceClass[];
  /** Provider ids (fal, replicate, higgsfield, comfyui, llm, local). */
  providers: string[];
  /** ComfyUI node packs by name (src/lib/licences.ts NODE_PACKS). */
  packs: string[];
  /** LoRA files. */
  loras: string[];
  /**
   * LoRAs whose licence allows your GPU only (civitai without "Rent") stay off fal and Replicate. Off by
   * default: they are sent like any other LoRA, and the run's notes say what the licence says.
   */
  keepGpuOnlyLoras: boolean;
}

export const ALL_ON: ModelAccess = { models: [], classes: [], providers: [], packs: [], loras: [], keepGpuOnlyLoras: false };

/** Where the switches live, as every message names it. */
export const ACCESS_PLACE = "Settings → Models & licences";
export const ACCESS_HREF = "/settings/models";

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : []);

/** The stored switches, tolerant of a missing or hand-edited value (anything unreadable is on). */
export function parseAccess(raw: string | null | undefined): ModelAccess {
  if (!raw) return ALL_ON;
  let v: Partial<Record<keyof ModelAccess, unknown>>;
  try {
    v = JSON.parse(raw) as typeof v;
  } catch {
    return ALL_ON;
  }
  if (!v || typeof v !== "object") return ALL_ON;
  return {
    models: strings(v.models),
    classes: strings(v.classes).filter((c): c is LicenceClass => (LICENCE_CLASSES as string[]).includes(c)),
    providers: strings(v.providers),
    packs: strings(v.packs),
    loras: strings(v.loras),
    keepGpuOnlyLoras: v.keepGpuOnlyLoras === true,
  };
}

export const allOn = (a: ModelAccess): boolean =>
  !a.models.length && !a.classes.length && !a.providers.length && !a.packs.length && !a.loras.length && !a.keepGpuOnlyLoras;

/** One switch flipped (the settings API's change). */
export type AccessChange =
  | { kind: "model" | "class" | "provider" | "pack" | "lora"; id: string; on: boolean }
  | { kind: "keepGpuOnlyLoras"; on: boolean }
  | { kind: "reset" };

const LIST: Record<"model" | "class" | "provider" | "pack" | "lora", "models" | "classes" | "providers" | "packs" | "loras"> = {
  model: "models",
  class: "classes",
  provider: "providers",
  pack: "packs",
  lora: "loras",
};

export function applyChange(a: ModelAccess, c: AccessChange): ModelAccess {
  if (c.kind === "reset") return ALL_ON;
  if (c.kind === "keepGpuOnlyLoras") return { ...a, keepGpuOnlyLoras: c.on };
  if (c.kind === "class" && !(LICENCE_CLASSES as string[]).includes(c.id)) throw new Error(`Unknown licence class ${c.id}`);
  const key = LIST[c.kind];
  const list = (a[key] as string[]).filter((x) => x !== c.id);
  return { ...a, [key]: c.on ? list : [...list, c.id] };
}

/** What a route needs for the class and pack switches: its licence class and the node packs its workflow loads. */
export interface RouteFacts {
  class: LicenceClass;
  packs: string[];
}

export type FactsOf = (route: ModelRoute, model: ModelDef) => RouteFacts;

export type AccessSwitch =
  | { kind: "model"; id: string }
  | { kind: "provider"; id: string }
  | { kind: "pack"; id: string }
  | { kind: "class"; id: LicenceClass }
  | { kind: "lora"; id: string };

/** The switch that turns this route off (the most specific one), or undefined when it is on. */
export function routeOff(model: ModelDef, route: ModelRoute, access: ModelAccess, facts: FactsOf): AccessSwitch | undefined {
  if (access.models.includes(model.id)) return { kind: "model", id: model.id };
  if (access.providers.includes(route.provider)) return { kind: "provider", id: route.provider };
  if (!access.packs.length && !access.classes.length) return undefined;
  const f = facts(route, model);
  const pack = f.packs.find((p) => access.packs.includes(p));
  if (pack) return { kind: "pack", id: pack };
  if (access.classes.includes(f.class)) return { kind: "class", id: f.class };
  return undefined;
}

/** A switch in words, as the messages and the settings page say it. */
export function switchLabel(s: AccessSwitch): string {
  switch (s.kind) {
    case "model":
      return "the model is switched off";
    case "provider":
      return `${PROVIDER_NAME[s.id] ?? s.id} is switched off`;
    case "pack":
      return `the ${s.id} node pack is switched off`;
    case "class":
      return `${CLASS_LABEL[s.id]} is switched off`;
    case "lora":
      return "the LoRA is switched off";
  }
}

const sameSwitch = (a: AccessSwitch, b: AccessSwitch) => a.kind === b.kind && a.id === b.id;

/** The switches behind a model being off (one per reason, in route order). */
export function offSwitches(model: ModelDef, access: ModelAccess, facts: FactsOf, routes = model.routes): AccessSwitch[] {
  const out: AccessSwitch[] = [];
  for (const r of routes) {
    const s = routeOff(model, r, access, facts);
    if (s && !out.some((x) => sameSwitch(x, s))) out.push(s);
  }
  return out;
}

const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The refusal a studio, the API, Assist and the CLI give for a model that is off, naming the switch. */
export function offMessage(name: string, switches: AccessSwitch[]): string {
  const why = switches.length ? ` (${and(switches.map(switchLabel))})` : "";
  return `${name} is turned off in ${ACCESS_PLACE}${why}. Turn it back on there, or pick another model`;
}

const views = new WeakMap<ModelAccess, WeakMap<ModelDef, ModelDef | null>>();

/**
 * The model as this install offers it: only the routes that are on (an Original keeps the engines that still
 * have one), the same object every time for the same switches; undefined when no route is on.
 */
export function gateModel(model: ModelDef, access: ModelAccess, facts: FactsOf): ModelDef | undefined {
  if (allOn(access)) return model;
  let cached = views.get(access);
  if (!cached) views.set(access, (cached = new WeakMap()));
  const hit = cached.get(model);
  if (hit !== undefined) return hit ?? undefined;
  const routes = model.routes.filter((r) => !routeOff(model, r, access, facts));
  let view: ModelDef | null = null;
  if (routes.length === model.routes.length) view = model;
  else if (routes.length) {
    const engines = enginesOf(model).filter((e) => routes.some((r) => providerEngine(r.provider) === e));
    const engine = engines.includes(model.engine) ? model.engine : engines[0];
    view = { ...model, routes, engine, ...(model.engines && { engines }) };
  }
  cached.set(model, view);
  return view ?? undefined;
}

/**
 * What the browser needs to filter its pickers (sent with /api/status only when something is off): the
 * models with no route on, and the Originals with one engine off (the engines still on).
 */
export interface AccessSummary {
  off: string[];
  engines?: Record<string, Engine[]>;
}

export function accessSummary(models: ModelDef[], access: ModelAccess, facts: FactsOf): AccessSummary | undefined {
  if (allOn(access)) return undefined;
  const off: string[] = [];
  const engines: Record<string, Engine[]> = {};
  for (const m of models) {
    const view = gateModel(m, access, facts);
    if (!view) off.push(m.id);
    else if (view !== m && enginesOf(view).length < enginesOf(m).length) engines[m.id] = enginesOf(view);
  }
  return { off, ...(Object.keys(engines).length && { engines }) };
}

/** Whether the model (on this engine, when given) is offered: everything is, without a summary. */
export function offered(summary: AccessSummary | undefined, id: string | undefined, engine?: Engine): boolean {
  if (!id) return false;
  if (!summary) return true;
  if (summary.off.includes(id)) return false;
  const on = summary.engines?.[id];
  return !engine || !on || on.includes(engine);
}

/** The first of these that is offered: a default that is off falls back to the next one in line. */
export function firstOffered(summary: AccessSummary | undefined, ids: (string | undefined)[], engine?: Engine): string | undefined {
  return ids.find((id) => offered(summary, id, engine));
}
