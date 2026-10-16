import type {
  Engine,
  GenerationRequest,
  GenParams,
  LoraRef,
  ModelDef,
  ModelRoute,
  Operation,
  Preset,
  PresetRoute,
} from "./types";

/** Infer the operation from what the user attached. */
export function inferOperation(model: ModelDef, req: Pick<GenerationRequest, "op" | "inputs">): Operation {
  if (req.op) return req.op;
  const ops = new Set(model.routes.map((r) => r.op));
  const imgs = req.inputs?.images?.length ?? 0;
  const has = (op: Operation) => ops.has(op);
  if (model.kind === "video") {
    if (req.inputs?.video && req.inputs?.audio && has("lipsync")) return "lipsync";
    if (req.inputs?.audio && imgs && has("avatar")) return "avatar";
    if (req.inputs?.video && imgs && has("motion-transfer")) return "motion-transfer";
    if (req.inputs?.video && has("v2v")) return "v2v";
    if (imgs && req.inputs?.endImage && has("flf2v")) return "flf2v";
    if (imgs > 1 && has("ref2v")) return "ref2v";
    if (imgs && has("i2v")) return "i2v";
    if (has("t2v")) return "t2v";
  }
  if (model.kind === "image") {
    if (imgs && req.inputs?.mask && has("inpaint")) return "inpaint";
    if (imgs && has("edit")) return "edit";
    if (has("t2i")) return "t2i";
  }
  return model.routes[0].op;
}

export function routesFor(model: ModelDef, op: Operation): ModelRoute[] {
  return model.routes.filter((r) => r.op === op);
}

/** Fill a preset prompt template: {prompt} and {option:key}. Collapses leftover whitespace. */
export function composePrompt(
  template: string,
  userPrompt: string | undefined,
  preset: Pick<Preset, "options"> | null,
  selected: Record<string, string> | undefined,
): string {
  let out = template.replace(/\{prompt\}/g, (userPrompt ?? "").trim());
  out = out.replace(/\{option:([a-zA-Z0-9_-]+)\}/g, (_, key: string) => {
    const opt = preset?.options?.find((o) => o.key === key);
    const value = selected?.[key] ?? opt?.default ?? opt?.choices[0]?.value;
    return opt?.choices.find((c) => c.value === value)?.prompt ?? "";
  });
  return out
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:]+|[\s,;:]+$/g, "")
    .trim();
}

export function presetRoute(preset: Preset, engine: Engine): PresetRoute | null {
  return engine === "open" ? preset.open : preset.cloud;
}

export interface Plan {
  model: ModelDef;
  op: Operation;
  prompt: string;
  params: GenParams;
  loras: LoraRef[];
  /** Number of separate provider jobs (models that can't batch need several). */
  jobs: number;
  perJobOutputs: number;
}

export function planGeneration(
  req: GenerationRequest,
  getModel: (id: string) => ModelDef | undefined,
  getPreset: (id: string) => Preset | undefined,
): Plan {
  const preset = req.presetId ? getPreset(req.presetId) : undefined;
  if (req.presetId && !preset) throw new Error(`Unknown preset ${req.presetId}`);
  const model = getModel(req.modelId);
  if (!model) throw new Error(`Unknown model ${req.modelId}`);

  let prompt = req.prompt?.trim() ?? "";
  let params: GenParams = { ...model.defaults, ...req.params };
  let loras: LoraRef[] = [];
  let op: Operation | undefined = req.op;

  if (preset) {
    const route = presetRoute(preset, model.engine);
    if (!route) throw new Error(`${preset.name} has no ${model.engine === "open" ? "open-source" : "cloud"} version yet`);
    if (route.modelId !== model.id && !preset.type.match(/motion|effect/)) {
      // Apps pin their model; motions/effects let the user pick any compatible video model.
      throw new Error(`${preset.name} runs on ${route.modelId}, not ${model.id}`);
    }
    prompt = composePrompt(route.promptTemplate ?? preset.promptTemplate, req.prompt, preset, req.presetOptions);
    // Preset params/LoRAs are tuned for the preset's own model; other compatible models only get the prompt.
    const sameModel = route.modelId === model.id;
    params = { ...model.defaults, ...(sameModel ? route.params : {}), ...req.params };
    loras = sameModel ? (route.loras ?? []) : [];
    if (sameModel) op = op ?? route.op;
  }

  op = op ?? inferOperation(model, req);
  if (!routesFor(model, op).length) {
    throw new Error(`${model.name} can't do ${op} — try another model`);
  }
  if (!prompt && op !== "upscale-image" && op !== "upscale-video" && op !== "bg-remove" && op !== "interpolate" && op !== "v2a" && op !== "face-swap" && op !== "motion-transfer" && op !== "lipsync" && op !== "avatar") {
    throw new Error("Write a prompt first");
  }

  const missing = missingInputs(op, req);
  if (missing) throw new Error(missing);

  const requested = Math.max(1, Math.min(8, params.numOutputs ?? 1));
  const maxPerJob = Math.max(1, model.options.maxOutputs ?? 1);
  const perJobOutputs = Math.min(requested, maxPerJob);
  const jobs = Math.ceil(requested / perJobOutputs);
  return { model, op, prompt, params: { ...params, numOutputs: perJobOutputs }, loras, jobs, perJobOutputs };
}

const NEEDS: Partial<Record<Operation, { images?: number; video?: boolean; audio?: boolean; endImage?: boolean; msg: string }>> = {
  edit: { images: 1, msg: "Add an image to edit" },
  inpaint: { images: 1, msg: "Add an image to inpaint" },
  outpaint: { images: 1, msg: "Add an image to extend" },
  i2v: { images: 1, msg: "Add a start frame" },
  flf2v: { images: 1, endImage: true, msg: "Add a start and an end frame" },
  ref2v: { images: 1, msg: "Add reference images" },
  v2v: { video: true, msg: "Add a video" },
  avatar: { images: 1, audio: true, msg: "Add a portrait and a voice track" },
  lipsync: { video: true, audio: true, msg: "Add a video and a voice track" },
  "motion-transfer": { images: 1, video: true, msg: "Add a character image and a driving video" },
  "upscale-image": { images: 1, msg: "Add an image to upscale" },
  "upscale-video": { video: true, msg: "Add a video to upscale" },
  "bg-remove": { images: 1, msg: "Add an image" },
  "face-swap": { images: 2, msg: "Add a target photo and a face" },
  v2a: { video: true, msg: "Add a video" },
  interpolate: { video: true, msg: "Add a video" },
};

/** Human message for the first missing input of an operation, or null. */
export function missingInputs(op: Operation, req: Pick<GenerationRequest, "inputs">): string | null {
  const n = NEEDS[op];
  if (!n) return null;
  const i = req.inputs ?? {};
  if (n.images && (i.images?.length ?? 0) < n.images) return n.msg;
  if (n.video && !i.video) return n.msg;
  if (n.audio && !i.audio) return n.msg;
  if (n.endImage && !i.endImage) return n.msg;
  return null;
}

/** Rough USD estimate for a plan (BYO-key cloud runs). Open-source runs are free. */
export function estimateCost(model: ModelDef, params: GenParams, jobs = 1): number | null {
  if (model.engine === "open" || !model.pricing) return model.engine === "open" ? 0 : null;
  const p = model.pricing;
  const n = params.numOutputs ?? 1;
  let per = p.usd;
  if (p.unit === "image") per = p.usd * n;
  if (p.unit === "second") per = p.usd * (params.duration ?? model.defaults?.duration ?? 5);
  if (p.unit === "minute") per = (p.usd * (params.duration ?? 60)) / 60;
  if (params.generateAudio === false && model.options.audio === true && p.note?.includes("audio-off-half")) per /= 2;
  return Math.round(per * jobs * 1000) / 1000;
}
