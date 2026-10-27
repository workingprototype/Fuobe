import "server-only";
import { MODELS } from "@/lib/catalog";
import { onEngine, providerEngine } from "@/lib/catalog/engines";
import { libraryEntry, loraName } from "@/lib/catalog/loras";
import type { Engine, LoraRef, ModelDef, ModelRoute } from "@/lib/catalog/types";
import type { ManifestWorkflow } from "@/lib/comfy";
import {
  BROWSER_LICENCE,
  llmLicence,
  licenceInfo,
  loraLicenceInfo,
  mergeLicences,
  paidApiLicence,
  workflowLicence,
  type LicenceInfo,
} from "@/lib/licences";
import {
  accessSummary as summarize,
  ACCESS_PLACE,
  applyChange,
  gateModel,
  offMessage,
  offSwitches,
  parseAccess,
  routeOff,
  type AccessChange,
  type AccessSummary,
  type FactsOf,
  type ModelAccess,
} from "@/lib/model-access";
import { db } from "./db";
import { loadManifest } from "./providers/comfyui";
import { getSetting } from "./settings";

/**
 * Settings → Models & licences on the server: the switches (one settings row, JSON), each route's licence and
 * node packs (the ComfyUI manifest for open routes, the provider's terms for paid ones), and the checks every
 * run, listing and automatic pick goes through. Licences are information; only the admin's switches turn
 * anything off, and everything is on by default.
 */

const KEY = "models.access";

let cached: { raw: string | null; access: ModelAccess } | null = null;

/** The switches in effect (the same object while they don't change, so gated model views stay cached). */
export function readAccess(): ModelAccess {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const raw = row?.value ?? null;
  if (!cached || cached.raw !== raw) cached = { raw, access: parseAccess(raw) };
  return cached.access;
}

export function saveAccess(next: ModelAccess): ModelAccess {
  const raw = JSON.stringify(next);
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, raw);
  return readAccess();
}

/** Flip switches in one write (read, change, write inside one transaction). */
export function changeAccess(changes: AccessChange[]): ModelAccess {
  return db().transaction(() => saveAccess(changes.reduce(applyChange, readAccess())))();
}

// ---------------------------------------------------------------------------
// Licences and node packs per route

/** Workflow ids a ComfyUI endpoint names: one id, or a family (`video-concat-{n}`). */
function workflowsOf(endpoint: string, all: ManifestWorkflow[]): ManifestWorkflow[] {
  if (!endpoint.includes("{")) return all.filter((w) => w.id === endpoint);
  const re = new RegExp(`^${endpoint.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "\\d+")}$`);
  return all.filter((w) => re.test(w.id));
}

let factsCache: { manifest: object; byEndpoint: Map<string, { licence: LicenceInfo; packs: string[]; workflows: string[] }> } | null = null;

/** An open route's licence (its workflows' weights, the strictest one naming it), node packs and workflow ids. */
function comfyFacts(endpoint: string): { licence: LicenceInfo; packs: string[]; workflows: string[] } {
  const manifest = loadManifest();
  if (factsCache?.manifest !== manifest) factsCache = { manifest, byEndpoint: new Map() };
  const hit = factsCache.byEndpoint.get(endpoint);
  if (hit) return hit;
  const wfs = workflowsOf(endpoint, manifest.workflows);
  const largestFirst = (w: ManifestWorkflow) => [...w.models].sort((a, b) => (b.sizeGb ?? 0) - (a.sizeGb ?? 0)).flatMap((m) => (m.url ? [m.url] : []));
  const facts = {
    licence: wfs.length ? mergeLicences(wfs.map((w) => licenceInfo(workflowLicence(w), largestFirst(w)))) : licenceInfo(workflowLicence({ id: endpoint })),
    packs: [...new Set(wfs.flatMap((w) => w.customNodes.map((n) => n.name)))],
    workflows: wfs.map((w) => w.id),
  };
  factsCache.byEndpoint.set(endpoint, facts);
  return facts;
}

/** A route's licence: the weights' for ComfyUI, the provider's terms for a paid API, Fuobe's own code in the browser. */
export function routeLicence(route: ModelRoute, model: Pick<ModelDef, "vendor">): LicenceInfo {
  if (route.provider === "comfyui") return comfyFacts(route.endpoint).licence;
  if (route.provider === "local") return BROWSER_LICENCE;
  if (route.provider === "llm") return llmLicence(route.endpoint, getSetting("ollamaModel"));
  return paidApiLicence(model.vendor, [route]);
}

export const factsOf: FactsOf = (route, model) => ({
  class: routeLicence(route, model).class,
  packs: route.provider === "comfyui" ? comfyFacts(route.endpoint).packs : [],
});

// ---------------------------------------------------------------------------
// The checks

/** The model as this install offers it (only its routes that are on), or undefined when it is off. */
export function offeredModel(m: ModelDef): ModelDef | undefined {
  return gateModel(m, readAccess(), factsOf);
}

/** Listings (the API, Assist, MCP, the CLI): only what is on, each model with the routes that are on. */
export function offeredModels(list: ModelDef[]): ModelDef[] {
  return list.flatMap((m) => offeredModel(m) ?? []);
}

/** Why a model is off, as the refusal names it ("…turned off in Settings → Models & licences (fal.ai is switched off)"). */
export function offReason(m: ModelDef, routes?: ModelRoute[]): string {
  return offMessage(m.name, offSwitches(m, readAccess(), factsOf, routes));
}

/**
 * The model a run may use, refusing one that is off with a message naming the switch. `engine` (an Original's
 * engine asked for) refuses that engine when only its routes are off.
 */
export function requireOffered(m: ModelDef, engine?: Engine): ModelDef {
  const view = offeredModel(m);
  if (!view) throw new Error(offReason(m));
  if (engine && m.engines?.includes(engine) && !view.engines?.includes(engine) && view.engine !== engine) {
    throw new Error(offReason(m, onEngine(m, engine).routes).replace(m.name, `${m.name} ${engine === "open" ? "on your GPU" : "in the cloud"}`));
  }
  return view;
}

/** The routes of these that are on (a run's candidates); throws naming the switches when none is. */
export function offeredRoutes(m: ModelDef, routes: ModelRoute[]): ModelRoute[] {
  const access = readAccess();
  const on = routes.filter((r) => !routeOff(m, r, access, factsOf));
  if (routes.length && !on.length) throw new Error(offReason(m, routes));
  return on;
}

/** Whether a model id is offered (an unknown id is not). */
export function isOffered(id: string | undefined, engine?: Engine): boolean {
  const m = id ? MODELS.find((x) => x.id === id) : undefined;
  const view = m && offeredModel(m);
  return !!view && (!engine || !m!.engines || (view.engines ?? [view.engine]).includes(engine));
}

/**
 * An automatic pick: the first of these that is on. When none is, the error says what to turn on (the first
 * one's switch), so a studio never silently runs something else.
 */
export function pickOffered(ids: (string | undefined)[], engine?: Engine): string {
  const id = ids.find((x) => isOffered(x, engine));
  if (id) return id;
  const first = ids.map((x) => (x ? MODELS.find((m) => m.id === x) : undefined)).find(Boolean);
  throw new Error(first ? offReason(first) : `No model for this is turned on in ${ACCESS_PLACE}`);
}

/**
 * A default that is on, else the next model that is on and does the same job on this engine (same kind, an
 * operation in common, not a hidden helper), else the default itself: a run of it then refuses, naming the switch
 * to turn back on. Assist's own picks and the studios' defaults in /api/models go through it.
 */
export function offeredDefault(id: string | undefined, engine: Engine): string | undefined {
  if (!id || isOffered(id, engine)) return id;
  const own = MODELS.find((m) => m.id === id);
  if (!own) return id;
  const ops = new Set(onEngine(own, engine).routes.map((r) => r.op));
  const next = MODELS.find((m) => !m.hidden && m.id !== id && m.kind === own.kind && isOffered(m.id, engine) && onEngine(offeredModel(m)!, engine).routes.some((r) => ops.has(r.op) && providerEngine(r.provider) === engine));
  return next?.id ?? id;
}

/** The summary the browser filters its pickers with (undefined while everything is on). */
export function offeredSummary(): AccessSummary | undefined {
  return summarize(MODELS, readAccess(), factsOf);
}

// ---------------------------------------------------------------------------
// LoRAs

/** A LoRA's licence: the ref's snapshot, else the library's; a LoRA with neither is the user's own. */
export function loraLicence(l: Pick<LoraRef, "file" | "url" | "licence">): LicenceInfo {
  const e = libraryEntry(l);
  return loraLicenceInfo(l.licence ?? e?.licence, e?.page);
}

/**
 * The LoRAs a run may load: one switched off, or whose licence class is, is left out (the plan's notes say
 * which switch). With "keep GPU-only LoRAs on your GPU" on, each LoRA is marked so a cloud route leaves the ones
 * licensed for the user's GPU only out (src/lib/catalog/loras.ts localOnly).
 */
export function offeredLoras(loras: LoraRef[]): { loras: LoraRef[]; notes: string[]; dropped: { file: string; reason: string }[] } {
  const access = readAccess();
  const dropped: { file: string; reason: string }[] = [];
  const kept: LoraRef[] = [];
  for (const l of loras) {
    // The user's own LoRAs (a trained @character, no licence recorded) aren't anyone's licensed work: only their own switch counts.
    const own = !l.licence && !libraryEntry(l);
    const reason = access.loras.includes(l.file) ? "it is switched off" : !own && access.classes.includes(loraLicence(l).class) ? "its licence class is switched off" : undefined;
    if (reason) dropped.push({ file: l.file, reason: `${reason} in ${ACCESS_PLACE}` });
    else kept.push(access.keepGpuOnlyLoras ? { ...l, keepOnGpu: true } : l);
  }
  const notes = dropped.length ? [`${dropped.map((d) => loraName({ file: d.file })).join(", ")} ${dropped.length > 1 ? "are" : "is"} left out: turned off in ${ACCESS_PLACE}`] : [];
  return { loras: kept, notes, dropped };
}
