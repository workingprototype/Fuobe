import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { planRunnable, totalCost, type PlannedJob } from "@/lib/assist";
import { getModel } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import { currentModelId, replacedBy } from "@/lib/catalog/replaced";
import type { Engine, Generation, GenerationRequest, MediaKind } from "@/lib/catalog/types";
import { probeMedia, type MediaInfo } from "@/lib/media-probe";
import {
  checkOutputs,
  checkValues,
  compile,
  exampleValues,
  isMediaRef,
  isMediaType,
  parseRecipe,
  parseRows,
  RECIPE_FILE,
  RECIPE_LIMITS,
  recipeProblems,
  RecipeSchema,
  SKILL_CHECK_FEATURE,
  today,
  verifiedLine,
  type Compiled,
  type FilledCheck,
  type Recipe,
  type RecipeValues,
  type VerifiedEngine,
} from "@/lib/recipe";
import type { Skill } from "@/lib/assist";
import { planSteps } from "./assist/studio-tools";
import { executeTool, getTool, planFor, validateInput } from "./assist/tools";
import type { JobPlace } from "./assist/define";
import { createPipeline } from "./chains";
import { llmText, llmTextBackend } from "./enhance";
import { cancelGeneration, createGenerations, currentRequest, getGeneration, previewChained } from "./generations";
import { trashGenerations } from "./library";
import { isOffered, modelLicence } from "./model-access";
import { GenerationRequestSchema } from "./request-schema";
import { engineMode } from "./settings";
import { getSkill, setSkillFile, skillFile, SkillError } from "./skills";
import { absolutePath, readRef, saveFile } from "./storage";

/**
 * Running a skill's recipe (src/lib/recipe.ts, package W1): price it, run it with new inputs (one createPipeline per
 * row, or one gated Assist tool call), and check it before it's trusted — the plan on each engine its steps allow, a
 * free dry run on the demo provider (GenerationRequest.demo, whatever Settings → Demo mode says), and an optional
 * real test whose outputs are checked by their structure (probeMedia), never by their pixels. What was checked is
 * written back into the recipe's `verified`; "needs a re-check" is computed when it's read.
 */

/** A recipe that can't be saved or run as it is, with every reason. */
export class RecipeError extends SkillError {
  constructor(
    readonly problems: string[],
    status = 422,
  ) {
    super(problems.length === 1 ? problems[0] : `Fix the recipe first: ${problems.join("; ")}`, status);
  }
}

const ENGINES: Engine[] = ["cloud", "open"];
const ENGINE_NAME: Record<Engine, string> = { cloud: "the cloud", open: "your GPU" };
const asList = (a: string | string[] | undefined): string[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);

// ---------------------------------------------------------------------------
// Reading and saving

/** A skill and its recipe; a skill without one (or with a broken one) is refused with the reason. */
export function getRecipe(name: string): { skill: Skill; recipe: Recipe } {
  const skill = getSkill(name);
  if (!skill) throw new SkillError("No such skill", 404);
  const text = skillFile(name, RECIPE_FILE);
  if (text === null) throw new SkillError(`/${name} has no recipe: it runs through Assist`, 404);
  const parsed = parseRecipe(text);
  if (!parsed.ok) throw new SkillError(parsed.error, 422);
  return { skill, recipe: parsed.recipe };
}

/** Tools a recipe may call: the gated ones that make something (not remember, which changes what Assist knows). */
const runnableTool = (name: string) => !!getTool(name)?.gated && name !== "remember";

/**
 * Problems only the server can see: a model the catalog doesn't have (after REPLACED_BY), a tool a recipe can't call,
 * and a step whose request, filled with the examples, the API itself would refuse (shape and limits).
 */
function serverProblems(recipe: Recipe): string[] {
  const out: string[] = [];
  for (const s of recipe.steps) {
    if (s.kind === "tool") {
      if (!runnableTool(s.tool)) out.push(`Step “${s.key}”: “${s.tool}” isn't a tool a recipe can run`);
    } else if (!getModel(currentModelId(s.request.modelId))) out.push(`Step “${s.key}”: Fuobe has no model “${s.request.modelId}”`);
  }
  if (out.length) return out;
  try {
    compileRun({ name: "check", title: "Check" }, recipe, valuesForCheck(recipe), "cloud", { run: "check" });
  } catch (e) {
    out.push((e as Error).message);
  }
  return out;
}

/** Everything that keeps a recipe from being saved: its shape (recipeProblems), then the catalog and the API's limits. */
export function allProblems(recipe: Recipe): string[] {
  const own = recipeProblems(recipe);
  return own.length ? own : serverProblems(recipe);
}

/**
 * Save a skill's recipe.json (user skills only: "Duplicate it first" for a built-in), refusing one with problems.
 * `verified` is the server's to write: a recipe saved from outside (an edit, an upload) starts unchecked.
 */
export function saveRecipe(name: string, input: unknown, o: { keepVerified?: boolean } = {}): Recipe {
  const skill = getSkill(name);
  if (!skill) throw new SkillError("No such skill", 404);
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then change your copy", 403);
  const parsed = RecipeSchema.safeParse(input);
  if (!parsed.success) throw new RecipeError(parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)));
  const recipe: Recipe = { ...parsed.data };
  if (!o.keepVerified) delete recipe.verified;
  const problems = allProblems(recipe);
  if (problems.length) throw new RecipeError(problems);
  setSkillFile(name, RECIPE_FILE, `${JSON.stringify(recipe, null, 2)}\n`);
  return recipe;
}

// ---------------------------------------------------------------------------
// Engines

/** The engines one step can run on: an Original on both (unless the step names one), any other model on its own. */
function stepEngines(s: Recipe["steps"][number]): Engine[] {
  if (s.kind === "tool") return ENGINES;
  const m = getModel(currentModelId(s.request.modelId));
  if (!m) return [];
  if (dualEngine(m)) return s.request.engine ? [s.request.engine] : (m.engines ?? ENGINES);
  return [m.engine];
}

/** The engines every step allows on this install (Settings → Engine mode applied). Fuobe never swaps a model across engines. */
export function recipeEngines(recipe: Recipe): Engine[] {
  const mode = engineMode();
  return ENGINES.filter((e) => recipe.steps.every((s) => stepEngines(s).includes(e)) && (mode === "both" || mode === e));
}

/** Why no engine is left, in words. */
function noEngine(recipe: Recipe): string {
  const sides = ENGINES.filter((e) => recipe.steps.every((s) => stepEngines(s).includes(e)));
  if (!sides.length) return "Its steps need both engines at once (a cloud model and a model on your GPU): run them as two skills";
  return sides[0] === "open"
    ? "It runs on your GPU (open source), but this install is set to paid cloud APIs only (Settings → Engine mode)"
    : "It runs on paid cloud APIs, but this install is set to open source only (Settings → Engine mode)";
}

// ---------------------------------------------------------------------------
// Compiling one run

/** Validate and compile one run: each filled request as the API takes it, an Original put on the run's engine. */
function compileRun(skill: { name: string; title: string }, recipe: Recipe, values: RecipeValues, engine: Engine, o: { run: string; demo?: boolean }): Compiled {
  const c = compile(recipe, values, { skill: skill.name, run: o.run, title: skill.title, demo: o.demo });
  if (c.kind === "tool") {
    const error = validateInput(c.tool, c.input);
    if (error) throw new SkillError(`Step “${c.key}”: ${error.replace(/^Invalid input: /, "")}`, 422);
    return c;
  }
  return {
    ...c,
    steps: c.steps.map((s) => {
      const { skill: stamp, demo, batchTitle, step, chain, ...asked } = s.request;
      const parsed = GenerationRequestSchema.safeParse(asked);
      if (!parsed.success) throw new SkillError(`Step “${s.key}”: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, 422);
      const req = parsed.data as GenerationRequest;
      const m = getModel(currentModelId(req.modelId));
      const slots = s.chain ?? chain;
      return {
        ...s,
        ...(slots && { chain: slots }),
        request: { ...req, ...(m && dualEngine(m) && !req.engine && { engine }), batchTitle, skill: stamp, ...(step && { step }), ...(demo && { demo }) },
      };
    }),
  };
}

interface RunPlan {
  jobs: PlannedJob[];
  total: number | null;
  errors: string[];
  place?: JobPlace;
}

/** Price one compiled run the way it would start (planSteps / planFor), with what stops it. */
function planRun(c: Compiled, engine: Engine): RunPlan {
  if (c.kind === "tool") {
    const p = planFor(c.tool, c.input, { engine });
    const errors = [...(p.error ? [p.error] : []), ...p.jobs.filter((j) => j.error).map((j) => `${j.note ?? j.modelName}: ${j.error}`)];
    return { jobs: p.jobs, total: p.total, errors, place: { ...(p.studio && { studio: p.studio }), ...(p.href && { href: p.href }), ...(p.fallback && { fallback: p.fallback }) } };
  }
  const jobs = planSteps("run_skill", c.steps);
  const errors = jobs.filter((j) => j.error).map((j) => `${j.note && j.note !== j.modelName ? `${j.note} (${j.modelName})` : j.modelName}: ${j.error}`);
  if (!errors.length && !planRunnable(jobs)) errors.push("Nothing to run");
  return { jobs, total: totalCost(jobs), errors };
}

/** The run with every request on the demo provider: valid and priced the same whether or not a provider is connected. */
function asDemo(c: Compiled): Compiled {
  return c.kind === "tool" ? c : { ...c, steps: c.steps.map((s) => ({ ...s, request: { ...s.request, demo: true } })) };
}

/**
 * The plan check: the run as it would start. When only this install stops it (no provider connected, with Settings →
 * Demo mode off), the recipe itself is fine: the same run on the demo provider passes it, and the reason is a note.
 */
function planCheck(c: Compiled, engine: Engine): RunPlan & { notes: string[] } {
  const plan = planRun(c, engine);
  if (!plan.errors.length || c.kind === "tool") return { ...plan, notes: [] };
  const demo = planRun(asDemo(c), engine);
  return demo.errors.length ? { ...plan, notes: [] } : { ...demo, notes: [...new Set(plan.errors.map((e) => e.replace(/^[^:]+: /, "")))] };
}

/**
 * sha256 of what a run uses: each step's model, operation, route (the first one on, as the demo provider would name it,
 * so connecting a key doesn't count as a change) and price table.
 */
function planHash(compiled: Compiled, engine: Engine): string {
  const c = asDemo(compiled);
  const parts =
    c.kind === "tool"
      ? planFor(c.tool, c.input, { engine }).jobs.map((j) => [j.modelId, j.op, getModel(j.modelId)?.pricing ?? null])
      : c.steps.map((s) => {
          const p = previewChained({ ...s.request, ...(s.chain && { chain: s.chain }) }, asList(s.after).length);
          return [p.model.id, p.op, p.route.provider, p.route.endpoint, p.model.pricing ?? null];
        });
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Stand-in files: a check's media input with no example (or one whose file is gone)

declare global {
  var __fuobeStandIns: Map<string, string> | undefined;
}

/** A small real file of a kind, saved once as a hidden (derived) asset: the dry run's providers read their inputs. */
function standIn(kind: "image" | "video" | "audio"): string {
  const cache = (globalThis.__fuobeStandIns ??= new Map());
  const known = cache.get(kind);
  if (known && fs.existsSync(absolutePath(decodeURIComponent(known.slice("/api/files/".length))))) return known;
  const samples = path.join(process.cwd(), "public", "samples");
  const file =
    kind === "image"
      ? { data: fs.readFileSync(path.join(samples, "grade-sample.jpg")), contentType: "image/jpeg" }
      : kind === "video"
        ? { data: fs.readFileSync(path.join(samples, "demo-landscape.mp4")), contentType: "video/mp4" }
        : { data: silentWav(2), contentType: "audio/wav" };
  const url = saveFile({ ...file, source: "derived", name: `skill-check-${kind}` }).url;
  cache.set(kind, url);
  return url;
}

function silentWav(seconds: number): Buffer {
  const rate = 16000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/** Whether a Fuobe file a recipe names still exists (a link elsewhere counts as there). */
const fileThere = (ref: string) => {
  if (!ref.startsWith("/api/files/")) return true;
  try {
    return fs.existsSync(absolutePath(decodeURIComponent(ref.slice("/api/files/".length).split("?")[0])));
  } catch {
    return false;
  }
};

/** A stand-in link to price with, as the CLI's estimate does: nothing reads it. */
const PRICE_STAND_IN = { image: "/api/files/uploads/estimate/stand-in.png", video: "/api/files/uploads/estimate/stand-in.mp4", audio: "/api/files/uploads/estimate/stand-in.wav" } as const;

/**
 * The values a check runs with: the examples, with a stand-in for a media input that has none or whose file is gone
 * (a link to price with; a real small file when the run will read it: `files`).
 */
function valuesForCheck(recipe: Recipe, files = false): RecipeValues {
  const fill = (kind: "image" | "video" | "audio") => (files ? standIn(kind) : PRICE_STAND_IN[kind]);
  const values = exampleValues(recipe, fill);
  for (const p of recipe.params) {
    const v = values[p.id];
    if (isMediaType(p.type) && (typeof v !== "string" || !isMediaRef(v) || (files && !fileThere(v)))) values[p.id] = fill(p.type);
  }
  const checked = checkValues(recipe, values);
  return checked.values ?? values;
}

// ---------------------------------------------------------------------------
// What a page shows

export interface RecipeView {
  name: string;
  title: string;
  builtin: boolean;
  recipe: Recipe;
  /** Engines its steps allow on this install. */
  engines: Engine[];
  /** Engines it may run on now: its plan check passed there. */
  ready: Engine[];
  /** Why it needs a re-check, per engine checked before. */
  recheck: Partial<Record<Engine, string[]>>;
  /** "Checked 29 Oct · Cloud ✓ · GPU not checked". */
  line: string;
  /** Why it runs nowhere on this install. */
  why?: string;
  /** Each step's model and its licence on each engine, as information. */
  models: { engine: Engine; name: string; licence: string }[];
}

export function recipeView(name: string): RecipeView {
  const { skill, recipe } = getRecipe(name);
  const engines = recipeEngines(recipe);
  const ready = engines.filter((e) => !!recipe.verified?.[e]?.plan);
  const models = engines.flatMap((e) =>
    recipe.steps.flatMap((s) => {
      if (s.kind === "tool") return [];
      const m = getModel(currentModelId(s.request.modelId));
      if (!m) return [];
      const l = modelLicence(m);
      return [{ engine: e, name: m.name, licence: (e === "cloud" && dualEngine(m) ? l.cloud : undefined)?.name ?? l.licence.name }];
    }),
  );
  return {
    name: skill.name,
    title: skill.title,
    builtin: skill.source === "builtin",
    recipe,
    engines,
    ready,
    recheck: needsRecheck(recipe, ready),
    line: verifiedLine(recipe, engines),
    ...(!engines.length && { why: noEngine(recipe) }),
    models: [...new Map(models.map((x) => [`${x.engine}:${x.name}`, x])).values()],
  };
}

/**
 * Why a checked recipe should be checked again, per engine (none: it's fine): a step's model moved by REPLACED_BY, a
 * model switched off in Settings → Models & licences, a plan that no longer passes, or a plan hash (models, routes,
 * prices) that differs from the one checked. Computed when read: there is no background job.
 */
export function needsRecheck(recipe: Recipe, engines: Engine[] = recipeEngines(recipe).filter((e) => !!recipe.verified?.[e]?.plan)): Partial<Record<Engine, string[]>> {
  const out: Partial<Record<Engine, string[]>> = {};
  const replaced = recipe.steps.flatMap((s) => {
    if (s.kind !== "generate") return [];
    const r = replacedBy(s.request.modelId);
    return r ? [`${r.was} was replaced by ${getModel(r.id)?.name ?? r.id}`] : [];
  });
  for (const e of engines) {
    const v = recipe.verified?.[e];
    if (!v?.plan) continue;
    const reasons = [...replaced];
    for (const s of recipe.steps) {
      if (s.kind !== "generate") continue;
      const id = currentModelId(s.request.modelId);
      const m = getModel(id);
      if (m && !isOffered(id, dualEngine(m) ? e : undefined)) reasons.push(`${m.name} is switched off in Settings → Models & licences`);
    }
    if (!reasons.length) {
      try {
        const c = compileRun({ name: "check", title: "Check" }, recipe, valuesForCheck(recipe), e, { run: "check" });
        const plan = planCheck(c, e);
        if (plan.errors.length) reasons.push(plan.errors[0]);
        else if (v.catalog && planHash(c, e) !== v.catalog) reasons.push("The models, routes or prices it uses changed since it was checked");
      } catch (err) {
        reasons.push((err as Error).message);
      }
    }
    if (reasons.length) out[e] = [...new Set(reasons)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rows

export interface RunInput {
  values?: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  csv?: string;
}

interface Row {
  line: number;
  values?: RecipeValues;
  errors: string[];
}

/** The runs asked for: one set of values, a list of rows, or a CSV (parsed and checked like the form). */
function rowsOf(recipe: Recipe, input: RunInput): { rows: Row[]; errors: string[] } {
  if (input.csv !== undefined) {
    const p = parseRows(input.csv, recipe);
    return { rows: p.rows.map((r) => ({ line: r.line, values: r.values, errors: r.errors })), errors: p.errors };
  }
  const list = input.rows ?? [input.values ?? {}];
  const errors = list.length > RECIPE_LIMITS.rows ? [`At most ${RECIPE_LIMITS.rows} rows at a time — this has ${list.length}`] : list.length ? [] : ["Add a row to run"];
  return {
    errors,
    rows: list.slice(0, RECIPE_LIMITS.rows).map((v, i) => {
      const c = checkValues(recipe, v ?? {});
      return { line: i + 1, values: c.values, errors: Object.values(c.errors) };
    }),
  };
}

function engineFor(recipe: Recipe, asked: Engine | undefined): Engine {
  const engines = recipeEngines(recipe);
  if (!engines.length) throw new SkillError(noEngine(recipe), 422);
  if (asked && !engines.includes(asked)) throw new SkillError(`This skill doesn't run on ${ENGINE_NAME[asked]}: its steps run on ${engines.map((e) => ENGINE_NAME[e]).join(" or ")}`, 422);
  return asked ?? engines[0];
}

// ---------------------------------------------------------------------------
// Estimate and run

export interface RecipeEstimate {
  engine: Engine;
  /** One entry per row: its jobs priced, and what stops it. */
  runs: { line: number; jobs: PlannedJob[]; total: number | null; errors: string[] }[];
  /** The first run's jobs ("What runs"). */
  jobs: PlannedJob[];
  /** Every run together (null: a price that varies). */
  total: number | null;
  /** Every job would run on the demo provider. */
  demo: boolean;
  runnable: boolean;
  /** What stops every run (no column for an input, too many rows, a recipe that runs nowhere). */
  errors: string[];
  place?: JobPlace;
}

/** Price one run or many (rows priced together, with a total) on an engine, without starting anything. */
export function estimateRecipe(name: string, input: RunInput, asked?: Engine): RecipeEstimate {
  const { skill, recipe } = getRecipe(name);
  const engine = engineFor(recipe, asked);
  const { rows, errors } = rowsOf(recipe, input);
  let place: JobPlace | undefined;
  const runs = rows.map((r) => {
    if (!r.values) return { line: r.line, jobs: [], total: null, errors: r.errors };
    try {
      const plan = planRun(compileRun(skill, recipe, r.values, engine, { run: "estimate" }), engine);
      place ??= plan.place;
      return { line: r.line, jobs: plan.jobs, total: plan.total, errors: plan.errors };
    } catch (e) {
      return { line: r.line, jobs: [], total: null, errors: [(e as Error).message] };
    }
  });
  const jobs = runs.flatMap((r) => r.jobs);
  const totals = runs.map((r) => r.total);
  const total = totals.some((t) => t === null) ? null : Math.round(totals.reduce<number>((s, t) => s + (t ?? 0), 0) * 1000) / 1000;
  return {
    engine,
    runs,
    jobs: runs.find((r) => r.jobs.length)?.jobs ?? [],
    total: runs.every((r) => !r.errors.length) ? total : null,
    demo: jobs.length > 0 && jobs.every((j) => j.demo || j.error),
    runnable: !errors.length && runs.length > 0 && runs.every((r) => !r.errors.length),
    errors,
    ...(place && { place }),
  };
}

export interface RecipeRun {
  /** The run's batch (a pipeline's rows share it), its generations, and the studio page a tool run opens in. */
  batchId?: string;
  ids: string[];
  href?: string;
}

/**
 * Run a recipe once or once per row on an engine whose plan check passed. Every row is validated and priced first:
 * one bad row starts nothing. A pipeline is one createPipeline per row; a tool recipe one executeTool call per row.
 */
export async function runRecipe(name: string, input: RunInput, asked?: Engine): Promise<{ engine: Engine; runs: RecipeRun[]; demo: boolean }> {
  const { skill, recipe } = getRecipe(name);
  const engine = engineFor(recipe, asked);
  if (!recipe.verified?.[engine]?.plan) throw new SkillError(`Check this skill on ${ENGINE_NAME[engine]} first — the check is free`, 409);
  const { rows, errors } = rowsOf(recipe, input);
  if (errors.length) throw new RecipeError(errors);
  const bad = rows.flatMap((r) => (r.errors.length ? [`${rows.length > 1 ? `Row ${r.line}: ` : ""}${r.errors.join("; ")}`] : []));
  if (bad.length) throw new RecipeError(bad);
  // Compile and price every row before anything starts.
  const compiled = rows.map((r) => {
    const run = nanoid(10);
    const c = compileRun(skill, recipe, r.values!, engine, { run });
    const plan = planRun(c, engine);
    if (plan.errors.length) throw new RecipeError(plan.errors.map((e) => `${rows.length > 1 ? `Row ${r.line}: ` : ""}${e}`));
    return { run, c };
  });
  const runs: RecipeRun[] = [];
  let demo = true;
  if (compiled[0].c.kind === "tool") {
    for (const { c } of compiled) {
      if (c.kind !== "tool") continue;
      const out = await executeTool(c.tool, c.input, { engine });
      const text = typeof out.content === "string" ? out.content : "";
      if (out.isError) {
        if (!runs.length) throw new SkillError(text.replace(/^\{"error":"(.*)"\}$/, "$1") || "The tool couldn't start", 422);
        break;
      }
      let href: string | undefined;
      try {
        href = (JSON.parse(text) as { href?: string }).href;
      } catch {
        href = undefined;
      }
      const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
      demo &&= ids.every((id) => getGeneration(id)?.provider === "mock");
      runs.push({ ids, ...(href && { href }) });
    }
    return { engine, runs, demo };
  }
  const made: Generation[] = [];
  try {
    for (const { run, c } of compiled) {
      if (c.kind !== "pipeline") continue;
      const p = createPipeline(c.steps, { batchId: run });
      made.push(...p.items);
      runs.push({ batchId: p.batchId, ids: p.items.map((g) => g.id), href: "/library" });
    }
  } catch (e) {
    // One row couldn't start after all (a race with Settings): stop the rows already started.
    for (const g of made) void cancelGeneration(g.id);
    throw e;
  }
  demo = made.every((g) => g.provider === "mock");
  return { engine, runs, demo };
}

// ---------------------------------------------------------------------------
// Checks

export type VerifyLevel = "plan" | "demo" | "real";

export interface EngineCheck {
  engine: Engine;
  /** `notes`: what stops a real run on this install that isn't the recipe's fault (a provider to connect). */
  plan: { ok: boolean; total: number | null; demo: boolean; errors: string[]; notes: string[] };
  dryRun?: { ok: boolean; problems: string[]; skipped?: string };
  real?: { ok: boolean; problems: string[]; notes: string[]; demo: boolean };
}

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/** Wait for generations to finish (the runner moves them), at most `ms`; cancels what's left when time runs out. */
async function settle(ids: string[], ms: number): Promise<Generation[]> {
  const until = Date.now() + ms;
  for (;;) {
    const gens = ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
    if (gens.length === ids.length && gens.every((g) => TERMINAL.has(g.status))) return gens;
    if (Date.now() > until) {
      for (const g of gens) if (!TERMINAL.has(g.status)) await cancelGeneration(g.id);
      return ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** What a step should make: its check's kind, else the kind of the row it made. */
const kindOf = (check: FilledCheck | undefined, g: Generation): MediaKind => check?.kind ?? g.kind;

/** A step's own failure, in words. */
const failure = (key: string, g: Generation | undefined) =>
  !g ? `Step “${key}” wasn't made` : g.status !== "succeeded" ? `Step “${key}” ${g.status === "canceled" ? "was stopped" : "failed"}${g.error ? `: ${g.error}` : ""}` : null;

const DRY_RUN_MS = 120_000;
const REAL_RUN_MS = 15 * 60_000;

/** The free dry run: one run on the demo provider, its rows hidden (skill-check) and moved to the Trash at the end. */
async function dryRun(skill: Skill, recipe: Recipe, engine: Engine): Promise<NonNullable<EngineCheck["dryRun"]>> {
  const c = compileRun(skill, recipe, valuesForCheck(recipe, true), engine, { run: nanoid(10), demo: true });
  // A studio step would make a record the user sees (a demo dub, a Layers project): its plan is its check in W1.
  if (c.kind === "tool") return { ok: true, problems: [], skipped: `A studio step (${c.tool}) is checked by its plan only` };
  const p = createPipeline(c.steps, { batchId: nanoid(10) });
  const ids = p.items.map((g) => g.id);
  try {
    const done = new Map((await settle(ids, DRY_RUN_MS)).map((g) => [g.id, g]));
    const problems: string[] = [];
    for (const s of c.steps) {
      const g = done.get(p.byKey[s.key]?.id);
      const why = failure(s.key, g);
      if (why) {
        problems.push(why);
        continue;
      }
      const kind = kindOf(c.checks[s.key], g!);
      if (!g!.outputs.some((o) => o.kind === kind)) problems.push(`Step “${s.key}” made no ${kind}`);
    }
    return { ok: !problems.length, problems };
  } finally {
    trashGenerations(ids);
  }
}

/** A stored output's header facts (duration, size, sound), or null when it can't be read. */
async function infoOf(url: string, kind: MediaKind): Promise<MediaInfo | null> {
  if (kind !== "video" && kind !== "audio") return null;
  try {
    return probeMedia(new Uint8Array((await readRef(url)).data));
  } catch {
    return null;
  }
}

/** Whether a picture shows a sentence, by a model that sees images; null when none answers. */
async function judgeLook(look: string, image: string): Promise<boolean | null> {
  if (!llmTextBackend()) return null;
  try {
    const f = await readRef(image);
    const answer = await llmText(
      "You check whether a picture matches a short description. Answer yes or no first, then one short reason.",
      `Description: ${look}`,
      [{ data: f.data, contentType: f.contentType }],
    );
    if (!answer) return null;
    return /^\W*yes\b/i.test(answer) ? true : /^\W*no\b/i.test(answer) ? false : null;
  } catch {
    return null;
  }
}

/** One frame of a clip, through the cloud extract-frame model (the open engine has none to ask). */
async function frameOf(video: string, engine: Engine): Promise<{ url?: string; ids: string[] }> {
  if (engine !== "cloud" || !isOffered("extract-frame")) return { ids: [] };
  try {
    const [g] = createGenerations({ feature: SKILL_CHECK_FEATURE, modelId: "extract-frame", op: "frame", inputs: { video }, params: { extra: { frame_type: "middle" } } });
    const [done] = await settle([g.id], 120_000);
    return { url: done?.outputs.find((o) => o.kind === "image")?.url, ids: [g.id] };
  } catch {
    return { ids: [] };
  }
}

/** The optional real test: the examples run for real, then each checked step's outputs are measured. */
async function realRun(skill: Skill, recipe: Recipe, engine: Engine): Promise<NonNullable<EngineCheck["real"]>> {
  const notes: string[] = [];
  const problems: string[] = [];
  const c = compileRun(skill, recipe, valuesForCheck(recipe, true), engine, { run: nanoid(10) });
  const helpers: string[] = [];
  let made: Generation[];
  let byKey: Record<string, string> = {};
  if (c.kind === "tool") {
    const out = await executeTool(c.tool, c.input, { engine });
    if (out.isError) return { ok: false, problems: [typeof out.content === "string" ? out.content : "The tool couldn't start"], notes, demo: false };
    const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
    made = await settle(ids, REAL_RUN_MS);
    if (ids.length) byKey = { [c.key]: ids[0] };
  } else {
    const p = createPipeline(c.steps, { batchId: nanoid(10) });
    made = await settle(p.items.map((g) => g.id), REAL_RUN_MS);
    byKey = Object.fromEntries(Object.entries(p.byKey).map(([k, g]) => [k, g.id]));
  }
  const demo = made.length > 0 && made.every((g) => g.provider === "mock");
  if (demo) notes.push(`It ran as a demo (no provider connected for ${ENGINE_NAME[engine]}): connect one in Settings for a real test`);
  const byId = new Map(made.map((g) => [g.id, g]));
  for (const [key, check] of Object.entries(c.checks)) {
    const g = byId.get(byKey[key]);
    const why = failure(key, g);
    if (why) {
      problems.push(why);
      continue;
    }
    // A real check's length is ±10% of one length; a range stays a range.
    const infos = await Promise.all(g!.outputs.map((o) => infoOf(o.url, o.kind)));
    const res = checkOutputs(check, g!.outputs, infos);
    problems.push(...res.problems.map((x) => `Step “${key}”: ${x}`));
    notes.push(...res.skipped.map((x) => `Step “${key}”: couldn't read ${x}`));
    if (check.look && res.ok) {
      const still = g!.outputs.find((o) => o.kind === "image")?.url;
      const clip = still ? undefined : g!.outputs.find((o) => o.kind === "video")?.url;
      const frame = clip ? await frameOf(clip, engine) : { url: still, ids: [] };
      helpers.push(...frame.ids);
      const verdict = frame.url ? await judgeLook(check.look, frame.url) : null;
      if (verdict === false) problems.push(`Step “${key}” doesn't look like “${check.look}”`);
      else if (verdict === null) notes.push(`Step “${key}”: the look wasn't judged (no model that sees images${clip && engine === "open" ? ", and no frame extractor on your GPU" : ""})`);
    }
  }
  if (helpers.length) trashGenerations(helpers);
  return { ok: !problems.length, problems, notes, demo };
}

export interface VerifyResult {
  ok: boolean;
  engines: EngineCheck[];
  view: RecipeView;
}

/**
 * Check a recipe and write what passed into its `verified`:
 * - `plan`: compile with the examples (a stand-in file for a media input with none) and price it on each engine its
 *   steps allow (or the one asked). Free.
 * - `demo`: the plan, then one dry run per engine on the demo provider, with or without keys and whatever Settings →
 *   Demo mode says. Free; its rows are hidden and go to the Trash.
 * - `real`: the above, then the examples for real (asks first: `confirm`), each checked step measured.
 */
export async function verifyRecipe(name: string, level: VerifyLevel, asked?: Engine, o: { confirm?: boolean } = {}): Promise<VerifyResult> {
  const found = getRecipe(name);
  const { skill } = found;
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then check your copy", 403);
  // A step that names a model Fuobe retired runs on what replaced it (as every run does): the re-check writes that down.
  const recipe: Recipe = {
    ...found.recipe,
    steps: found.recipe.steps.map((s) => (s.kind === "generate" ? { ...s, request: currentRequest(s.request).request as typeof s.request } : s)),
  };
  const problems = allProblems(recipe);
  if (problems.length) throw new RecipeError(problems);
  const all = recipeEngines(recipe);
  if (!all.length) throw new SkillError(noEngine(recipe), 422);
  if (asked && !all.includes(asked)) throw new SkillError(`This skill doesn't run on ${ENGINE_NAME[asked]}`, 422);
  if (level === "real" && !o.confirm) throw new SkillError("A real test spends money or GPU time: confirm it with its price first", 409);
  const engines = asked ? [asked] : all;
  const verified: NonNullable<Recipe["verified"]> = { ...recipe.verified };
  const day = today();
  const checks: EngineCheck[] = [];
  for (const e of engines) {
    const prev = recipe.verified?.[e] ?? null;
    let check: EngineCheck;
    let hash: string | undefined;
    try {
      const c = compileRun(skill, recipe, valuesForCheck(recipe), e, { run: "check" });
      const plan = planCheck(c, e);
      check = { engine: e, plan: { ok: !plan.errors.length, total: plan.total, demo: plan.jobs.every((j) => j.demo), errors: plan.errors, notes: plan.notes } };
      if (check.plan.ok) hash = planHash(c, e);
    } catch (err) {
      check = { engine: e, plan: { ok: false, total: null, demo: false, errors: [(err as Error).message], notes: [] } };
    }
    if (!check.plan.ok || !hash) {
      verified[e] = null;
      checks.push(check);
      continue;
    }
    // Checks made against another plan don't count for this one.
    const same = prev?.catalog === hash;
    const next: VerifiedEngine = { plan: day, dryRun: same ? (prev?.dryRun ?? null) : null, real: same ? (prev?.real ?? null) : null, catalog: hash, ...(same && prev?.notes && { notes: prev.notes }) };
    if (check.plan.notes.length) next.notes = check.plan.notes.slice(0, 12);
    if (level !== "plan") {
      check.dryRun = await dryRun(skill, recipe, e).catch((err) => ({ ok: false, problems: [(err as Error).message] }));
      next.dryRun = check.dryRun.ok && !check.dryRun.skipped ? day : check.dryRun.ok ? next.dryRun : null;
      if (check.dryRun.skipped) next.notes = [...(next.notes ?? []), check.dryRun.skipped].slice(0, 12);
    }
    if (level === "real" && check.dryRun?.ok) {
      check.real = await realRun(skill, recipe, e).catch((err) => ({ ok: false, problems: [(err as Error).message], notes: [], demo: false }));
      next.real = check.real.ok && !check.real.demo ? day : check.real.ok ? next.real : null;
      next.notes = check.real.notes.slice(0, 12);
    }
    verified[e] = next;
    checks.push(check);
  }
  saveRecipe(name, { ...recipe, verified }, { keepVerified: true });
  const ok = checks.every((c) => c.plan.ok && (c.dryRun?.ok ?? true) && (c.real?.ok ?? true));
  return { ok, engines: checks, view: recipeView(name) };
}
