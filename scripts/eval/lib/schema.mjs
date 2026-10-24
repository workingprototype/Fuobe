// The case-file format (scripts/eval/cases/*.json): one suite per Fuobe Original, its targets per
// engine, the recipe variants to compare, and the cases (prompt sets with pinned seeds, inputs,
// references, training runs, shot lists). `pnpm eval:validate` and tests/eval-harness.test.ts check
// every file against it; `schemaJson()` writes cases/case.schema.json for editors.
import { z } from "zod";

export const ENGINES = /** @type {const} */ (["demo", "open", "cloud"]);
export const METRICS = /** @type {const} */ (["clip", "aesthetic", "style", "identity", "temporal", "lipsync", "continuity"]);

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lower-case letters, digits and dashes");
const CaseId = z.string().max(120).regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/, "lower-case words joined by - . _ and /");
/** A file: local/… (yours, git-ignored), fixtures/…, samples/… (public/samples), absolute, relative to the case file, or a link. */
const FileRef = z.string().min(1).max(500);
const Json = z.record(z.string(), z.unknown());

/** GenerationRequest.params as the API takes it (checked again by the server). */
const Params = z
  .object({
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    duration: z.number().positive().optional(),
    numOutputs: z.number().int().min(1).max(8).optional(),
    generateAudio: z.boolean().optional(),
    fps: z.number().positive().optional(),
    palette: z.array(z.string()).optional(),
    styleId: z.string().optional(),
    voice: z.string().optional(),
    targetLanguage: z.string().optional(),
    startTime: z.number().min(0).optional(),
    endTime: z.number().min(0).optional(),
    shots: z.array(z.object({ prompt: z.string(), duration: z.number().positive() })).optional(),
    matteOutput: z.enum(["cutout", "matte"]).optional(),
  })
  .catchall(z.unknown());

const Inputs = z
  .object({
    images: z.array(FileRef).max(14).optional(),
    endImage: FileRef.optional(),
    mask: FileRef.optional(),
    video: FileRef.optional(),
    videos: z.array(FileRef).max(24).optional(),
    audio: FileRef.optional(),
    audio2: FileRef.optional(),
    audios: z.array(FileRef).max(10).optional(),
    voiceAudio: FileRef.optional(),
  })
  .strict();

const LoraSpec = z
  .object({
    file: z.string().min(1).max(200),
    url: z.string().regex(/^https:\/\//).optional(),
    strength: z.number().min(-4).max(4).optional(),
    trigger: z.string().max(200).optional(),
    target: z.enum(["high", "low", "both"]).optional(),
    commercial: z.boolean().optional(),
    hostedOk: z.boolean().optional(),
    licence: z.string().optional(),
  })
  .strict();

const Prompt = z.union([
  z.string().min(1).max(4000),
  z
    .object({
      id: Slug.optional(),
      text: z.string().min(1).max(4000),
      seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
      negative: z.string().max(2000).optional(),
    })
    .strict(),
]);

const Shot = z
  .object({
    id: Slug.optional(),
    prompt: z.string().min(1).max(4000),
    duration: z.number().positive().max(60).optional(),
    presetId: z.string().optional(),
    seed: z.number().int().min(0).optional(),
  })
  .strict();

const PerEngine = (inner) => z.object({ demo: inner.optional(), open: inner.optional(), cloud: inner.optional() }).strict();

const Target = z
  .object({
    /** Model ids in order of preference: the first one this Fuobe has is used (an Original first, then today's base). */
    models: z.array(z.string().min(1)).min(1),
    op: z.string().optional(),
    params: Params.optional(),
    /** params.extra for this engine: workflow inputs on ComfyUI (steps, shift…), payload fields on fal. */
    extra: Json.optional(),
  })
  .strict();

const Variant = z
  .object({
    description: z.string().optional(),
    /** Soul looks: put the look's template and LoRA triggers around the prompt (default true). */
    template: z.boolean().optional(),
    /** The recipe's LoRAs from the research ("recipe"), none, or your own list. */
    loras: z.union([z.literal("recipe"), z.literal("none"), z.array(LoraSpec).max(8)]).optional(),
    /** Multiplies every recipe LoRA's strength. */
    loraScale: z.number().min(0).max(4).optional(),
    /** Send the case's presetId (default true when the case has one). */
    preset: z.boolean().optional(),
    /** Motions / effects: 0 runs the preset's prompt without its catalog LoRAs. */
    presetStrength: z.number().min(0).max(1).optional(),
    /** The server's own Original applies the look: send the case's look id in this field and no client recipe. */
    lookParam: z.enum(["presetId", "styleId"]).optional(),
    /** Other models for this variant (A/B a model against the recipe). A case can name its own (variantModels). */
    models: PerEngine(z.array(z.string().min(1)).min(1)).optional(),
    /** The engines this variant runs on (a partner model is a cloud model: on the others it would repeat another variant). */
    engines: z.array(z.enum(ENGINES)).min(1).optional(),
    params: Params.optional(),
    extra: Json.optional(),
  })
  .strict();

const Train = z
  .object({
    /** A folder of the person's photos (local/characters/<name>/): never committed. */
    photos: FileRef,
    /** Training target ids per engine (GET /api/elements/<id>/trainings lists them). */
    targets: PerEngine(z.string().min(1)),
    name: z.string().min(1).max(60).optional(),
    minPhotos: z.number().int().min(1).default(5),
    /** The people in the photos agreed to being trained on. Training refuses to start without it. */
    consent: z.boolean().default(false),
    /** An element that is already trained (its id): the run uses it instead of training again. */
    element: z.string().min(1).max(64).optional(),
  })
  .strict();

const Submit = z
  .object({
    /** A studio route that builds a pipeline (POST), e.g. /api/mixed-media. */
    route: z.string().regex(/^\/api\/[\w/-]+$/),
    /**
     * The body. Filled in: {{inputs.video}}, {{inputs.images.0}}… (uploaded URLs), {{source:inputs.video}} (the clip as
     * studios take it: url, name, duration, fps, width, height, hasAudio), {{prompt}}, {{seed}}, {{engine}} (open or
     * cloud; demo runs send open) and {{requestId}}.
     */
    body: Json,
    /** Which generations of the answer are the result: the final step (default), the last listed, or all. */
    result: z.enum(["final", "last", "all"]).default("final"),
    /** Where the same body is priced (default: the route + /estimate; false when the route has none). */
    estimate: z.union([z.string().regex(/^\/api\/[\w/-]+$/), z.literal(false)]).optional(),
  })
  .strict();

export const CaseSchema = z
  .object({
    id: CaseId,
    title: z.string().min(1).max(200),
    /** A Soul look id (docs/research/higgsfield-image-studios.json soulPresets[].id): the recipe comes from the research. */
    look: z.string().optional(),
    /** A motion or effect name in the research's motionsEffects map (fuobe-originals-recipes-5.json). */
    motion: z.string().optional(),
    presetId: z.string().optional(),
    /** Models for this case instead of the suite's targets (a look on another base, a mode with its own model). */
    models: PerEngine(z.array(z.string().min(1)).min(1)).optional(),
    /** A variant's models for this case, over the variant's own (each mode of a studio has its own partner model). */
    variantModels: z.record(Slug, PerEngine(z.array(z.string().min(1)).min(1))).optional(),
    op: z.string().optional(),
    prompts: z.array(Prompt).min(1).optional(),
    shots: z.array(Shot).min(1).max(24).optional(),
    inputs: Inputs.optional(),
    /** Used on --engine demo (and when `inputs` name local files that aren't there and --allow-fixtures is set). */
    demoInputs: Inputs.optional(),
    params: Params.optional(),
    extra: Json.optional(),
    /** Reference images or clips: a look's style set, a person's photos, a clip to A/B against (a folder or files). */
    references: z.union([FileRef, z.array(FileRef).min(1)]).optional(),
    metrics: z.array(z.enum(METRICS)).optional(),
    train: Train.optional(),
    submit: Submit.optional(),
    engines: z.array(z.enum(ENGINES)).min(1).optional(),
    tags: z.array(Slug).optional(),
    note: z.string().optional(),
  })
  .strict();

export const SuiteSchema = z
  .object({
    $schema: z.string().optional(),
    suite: Slug,
    title: z.string().min(1),
    description: z.string().min(1),
    /** The Fuobe Original(s) this suite measures (fuobe-soul, fuobe-dop…). */
    original: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    kind: z.enum(["image", "video", "audio"]),
    /** Where a case's recipe comes from: a Soul look, a motion / effect, or nothing beyond the case itself. */
    recipe: z.enum(["soul-look", "motion", "none"]).default("none"),
    targets: PerEngine(Target).refine((t) => t.open || t.cloud || t.demo, "name a target for at least one engine"),
    defaults: z
      .object({
        seeds: z.array(z.number().int().min(0).max(2 ** 31 - 1)).min(1).default([1001]),
        prompts: z.array(Prompt).min(1).optional(),
        params: Params.optional(),
        extra: Json.optional(),
        metrics: z.array(z.enum(METRICS)).default(["clip"]),
        variant: Slug.optional(),
        /** The variant the promote rule judges and the blind review pairs with the others (default: recipe, else the first). */
        candidate: Slug.optional(),
        timeoutSeconds: z.number().positive().default(1800),
      })
      .strict()
      .default({ seeds: [1001], metrics: ["clip"], timeoutSeconds: 1800 }),
    variants: z.record(Slug, Variant).optional(),
    cases: z.array(CaseSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set();
    s.cases.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", path: ["cases", i, "id"], message: `duplicate case id ${c.id}` });
      seen.add(c.id);
      if (!c.prompts && !c.shots && !s.defaults.prompts && !c.submit && !c.inputs && !c.demoInputs) {
        ctx.addIssue({ code: "custom", path: ["cases", i], message: "give the case prompts, shots, inputs or a submit body" });
      }
      const ids = (c.prompts ?? []).flatMap((p) => (typeof p === "object" && p.id ? [p.id] : []));
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["cases", i, "prompts"], message: "prompt ids repeat" });
      if (c.look && s.recipe !== "soul-look") ctx.addIssue({ code: "custom", path: ["cases", i, "look"], message: 'a look needs "recipe": "soul-look"' });
      if (c.motion && s.recipe !== "motion") ctx.addIssue({ code: "custom", path: ["cases", i, "motion"], message: 'a motion needs "recipe": "motion"' });
      for (const v of Object.keys(c.variantModels ?? {})) {
        if (!s.variants?.[v]) ctx.addIssue({ code: "custom", path: ["cases", i, "variantModels", v], message: `no variant ${v} in this suite` });
      }
    });
    const variants = Object.keys(s.variants ?? { default: {} });
    for (const k of ["variant", "candidate"]) {
      if (s.defaults[k] && !variants.includes(s.defaults[k])) ctx.addIssue({ code: "custom", path: ["defaults", k], message: `no variant ${s.defaults[k]} (have ${variants.join(", ")})` });
    }
  });

/** Readable lines for a failed parse: `cases[3].prompts[0].seed: expected an integer`. */
export function issues(error) {
  return error.issues.map((i) => {
    const where = i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "");
    return `${where || "(file)"}: ${i.message}`;
  });
}

/** JSON Schema of a suite file (cases/case.schema.json), for editors. */
export function schemaJson() {
  return z.toJSONSchema(SuiteSchema, { target: "draft-2020-12", unrepresentable: "any", io: "input" });
}
