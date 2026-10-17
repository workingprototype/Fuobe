import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { modelsFor } from "@/lib/catalog";
import { OPERATION_LABELS, type GenerationRequest, type MediaKind, type ModelDef, type Operation } from "@/lib/catalog/types";
import { type AssistItem, type PlannedJob, totalCost } from "@/lib/assist";
import { STORYBOARD_MODELS } from "@/lib/catalog/storyboard";
import { listElements } from "../elements";
import { createGenerations, getGeneration, listGenerations, previewGeneration } from "../generations";
import { provider } from "../providers";
import { engineMode } from "../settings";
import { readRef } from "../storage";
import { createStoryboard } from "../storyboard";

type ResultContent = Anthropic.Beta.BetaToolResultBlockParam["content"];

export interface ToolContext {
  engine: "cloud" | "open";
}

export interface ToolOutcome {
  content: ResultContent;
  isError?: boolean;
  /** Cards to show in the chat (generations started, a short "looked up models" line…). */
  items?: AssistItem[];
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Spends money or GPU time: waits for the user's approval unless auto-approve is on. */
  gated?: boolean;
  strict?: boolean;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
  /** For gated tools: what the run would do, priced. */
  plan?: (input: z.infer<S>, ctx: ToolContext) => PlannedJob[];
}

const defineTool = <S extends z.ZodType>(def: ToolDef<S>) => def;

const ref = z.string().describe("A file URL from the chat: an attachment or an earlier output (/api/files/…).");

// ---------------------------------------------------------------------------
// search_models

const KINDS = ["image", "video", "audio"] as const;

function summarize(m: ModelDef) {
  const o = m.options;
  const configured = m.routes.some((r) => provider(r.provider).isConfigured());
  return {
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    engine: m.engine === "open" ? "open source (ComfyUI)" : "paid cloud API",
    about: m.tagline,
    does: [...new Set(m.routes.map((r) => r.op))].map((op) => `${op} (${OPERATION_LABELS[op]})`),
    price: m.engine === "open" ? "free (your GPU)" : m.pricing ? `$${m.pricing.usd} per ${m.pricing.unit}${m.pricing.note ? ` — ${m.pricing.note}` : ""}` : "unknown",
    connected: configured,
    ...(o.aspectRatios && { aspectRatios: o.aspectRatios }),
    ...(o.resolutions && { resolutions: o.resolutions }),
    ...(o.durations && { durations: o.durations }),
    ...(o.maxImages && { maxReferenceImages: o.maxImages }),
    ...(o.maxOutputs && { maxOutputsPerRun: o.maxOutputs }),
    ...(o.audio && { nativeAudio: o.audio === "always" ? "always on" : "optional" }),
    ...(o.endFrame && { endFrame: true }),
    ...(o.multiShot && { multiShot: `up to ${o.multiShot.maxShots} shots` }),
    ...(o.voices?.length && { voices: o.voices.slice(0, 12).map((v) => v.id) }),
    ...(o.voiceClone && { voiceClone: true }),
    ...(o.presets && { needs: o.presets.required ? `a ${o.presets.label} (pick in the studio)` : undefined }),
  };
}

const searchModels = defineTool({
  name: "search_models",
  description:
    "Look up the models this studio can run for a kind of output. Call it before generate whenever you haven't already looked up models for this kind of job in this chat, and whenever the user names a model, asks what's best or cheapest, or wants a capability (audio, end frame, multi-shot, a voice). Returns ids, what each does, price, options and whether a provider is connected.",
  schema: z.object({
    kind: z.enum(KINDS).describe("Output kind."),
    task: z.string().optional().describe("Operation id to filter by, e.g. t2i, edit, t2v, i2v, flf2v, ref2v, extend, lipsync, avatar, tts, upscale-image."),
    query: z.string().optional().describe("Words to match in the model name, vendor or description, e.g. 'kling', 'cheap', 'photoreal'."),
  }),
  async run({ kind, task, query }, ctx) {
    const mode = engineMode();
    let list = modelsFor({ kind: kind as MediaKind, ops: task ? [task as Operation] : undefined, engine: mode === "both" ? "all" : mode });
    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = list.map((m) => {
        const hay = `${m.name} ${m.vendor} ${m.family} ${m.tagline} ${m.id}`.toLowerCase();
        return { m, s: words.filter((w) => hay.includes(w)).length };
      });
      if (scored.some((x) => x.s)) list = scored.filter((x) => x.s).sort((a, b) => b.s - a.s).map((x) => x.m);
    }
    // The engine the user picked first, then the rest.
    list = [...list].sort((a, b) => Number(b.engine === ctx.engine) - Number(a.engine === ctx.engine));
    const shown = list.slice(0, 20);
    return {
      content: JSON.stringify({ engineMode: mode, preferredEngine: ctx.engine, total: list.length, models: shown.map(summarize) }),
      items: [{ id: "", role: "tool", text: `Looked up ${list.length} ${kind} model${list.length === 1 ? "" : "s"}${task ? ` for ${OPERATION_LABELS[task as Operation] ?? task}` : ""}` }],
    };
  },
});

// ---------------------------------------------------------------------------
// list_elements

const listElementsTool = defineTool({
  name: "list_elements",
  description:
    "List the user's saved Elements (characters, locations, props, styles, voices). Call it when the user mentions a character, person, place or product by name, or uses an @handle. Writing @handle in a generate prompt makes the model use that element's reference photos or trained identity.",
  schema: z.object({}),
  async run() {
    const els = listElements();
    return {
      content: JSON.stringify(
        els.map((e) => ({
          handle: `@${e.handle}`,
          name: e.name,
          kind: e.kind,
          description: e.description,
          referencePhotos: e.references.length,
          trainedFor: e.loras.map((l) => l.modelId),
        })),
      ),
      items: [{ id: "", role: "tool", text: `Checked your elements (${els.length})` }],
    };
  },
});

// ---------------------------------------------------------------------------
// list_recent / check_generations

function genSummary(id: string) {
  const g = getGeneration(id);
  if (!g) return { id, status: "unknown id" };
  return {
    id: g.id,
    status: g.status,
    model: g.modelId,
    op: g.op,
    kind: g.kind,
    prompt: g.request.prompt?.slice(0, 300),
    ...(g.progress !== null && g.status === "running" && { progress: g.progress }),
    ...(g.error && { error: g.error }),
    ...(g.provider === "mock" && { demo: true }),
    outputs: g.outputs.map((o) => ({ url: o.url, kind: o.kind, ...(o.draftId && { draftId: o.draftId }) })),
  };
}

const listRecent = defineTool({
  name: "list_recent",
  description:
    "List the user's most recent generations with their output URLs. Call it when the user refers to something they made earlier ('animate my last image', 'the one from before') so you can pass its URL as an input.",
  schema: z.object({
    limit: z.number().int().optional().describe("How many (default 8, up to 30)."),
    kind: z.enum(KINDS).optional(),
  }),
  async run({ limit, kind }) {
    const items = listGenerations({ kind, limit: Math.max(1, Math.min(30, limit ?? 8)) });
    return { content: JSON.stringify(items.map((g) => genSummary(g.id))) };
  },
});

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const LOOK_LIMIT = 4;
const LOOK_BYTES = 3_500_000;

const checkGenerations = defineTool({
  name: "check_generations",
  description:
    "Get the status and output URLs of generations you started. Call it when you need an output to continue (animate an image you just made, upscale it, use it as a reference) — set wait_seconds to wait for them to finish. Set look to true to see finished images yourself, e.g. to pick the best take or check the result matches the brief.",
  schema: z.object({
    ids: z.array(z.string()).describe("Generation ids returned by generate or create_storyboard."),
    wait_seconds: z.number().int().optional().describe("Wait up to this long (max 120) for all of them to finish. 0 = just report."),
    look: z.boolean().optional().describe("Attach finished image outputs so you can see them (up to 4)."),
  }),
  async run({ ids, wait_seconds, look }) {
    const until = Date.now() + Math.max(0, Math.min(120, wait_seconds ?? 0)) * 1000;
    let summaries = ids.slice(0, 20).map(genSummary);
    while (Date.now() < until && summaries.some((s) => !TERMINAL.has(s.status))) {
      await new Promise((r) => setTimeout(r, 1500));
      summaries = ids.slice(0, 20).map(genSummary);
    }
    const blocks: Exclude<ResultContent, string | undefined> = [{ type: "text", text: JSON.stringify(summaries) }];
    if (look) {
      const images = summaries.flatMap((s) => ("outputs" in s ? (s.outputs ?? []).filter((o) => o.kind === "image").map((o) => ({ id: s.id, url: o.url })) : []));
      for (const img of images.slice(0, LOOK_LIMIT)) {
        try {
          const { data, contentType } = await readRef(img.url);
          if (data.length > LOOK_BYTES || !/^image\/(png|jpeg|webp|gif)$/.test(contentType)) continue;
          blocks.push({ type: "text", text: `Output of ${img.id}: ${img.url}` });
          blocks.push({ type: "image", source: { type: "base64", media_type: contentType as "image/png", data: data.toString("base64") } });
        } catch {
          // Unreadable output: the URL is still in the summary.
        }
      }
    }
    return {
      content: blocks,
      items: [{ id: "", role: "tool", text: `Checked ${ids.length} generation${ids.length === 1 ? "" : "s"}${look ? " and looked at the results" : ""}` }],
    };
  },
});

// ---------------------------------------------------------------------------
// generate

const Job = z.object({
  model_id: z.string().describe("Model id from search_models."),
  prompt: z.string().describe("The full prompt. Put @handles here to use saved elements."),
  op: z.string().optional().describe("Operation id (t2i, edit, t2v, i2v, flf2v, ref2v, extend, tts…). Usually inferred from the inputs; set it when ambiguous."),
  images: z.array(ref).optional().describe("Input images: the image to edit, the start frame, or references, in order."),
  end_image: ref.optional().describe("End frame (first-and-last-frame video)."),
  video: ref.optional().describe("Input video (extend, edit, lipsync, upscale…)."),
  audio: ref.optional().describe("Input audio (lipsync, avatar)."),
  aspect_ratio: z.string().optional().describe("e.g. 16:9, 9:16, 1:1 — one the model lists."),
  resolution: z.string().optional().describe("e.g. 1080p, 2K — one the model lists."),
  duration: z.number().optional().describe("Seconds, for video and music — one the model lists."),
  outputs: z.number().int().optional().describe("How many takes (1–4)."),
  generate_audio: z.boolean().optional().describe("Native audio on/off, for video models that offer it."),
  voice: z.string().optional().describe("Voice id for text to speech."),
  negative_prompt: z.string().optional(),
});
type JobInput = z.infer<typeof Job>;

function toRequest(j: JobInput): GenerationRequest {
  const inputs = {
    ...(j.images?.length && { images: j.images }),
    ...(j.end_image && { endImage: j.end_image }),
    ...(j.video && { video: j.video }),
    ...(j.audio && { audio: j.audio }),
  };
  return {
    feature: "assist",
    modelId: j.model_id,
    op: j.op as Operation | undefined,
    prompt: j.prompt,
    negativePrompt: j.negative_prompt,
    inputs: Object.keys(inputs).length ? inputs : undefined,
    params: {
      aspectRatio: j.aspect_ratio,
      resolution: j.resolution,
      duration: j.duration,
      numOutputs: j.outputs ? Math.max(1, Math.min(4, j.outputs)) : undefined,
      generateAudio: j.generate_audio,
      voice: j.voice,
    },
  };
}

function planJob(j: JobInput): PlannedJob {
  const req = toRequest(j);
  try {
    const p = previewGeneration(req);
    return { tool: "generate", modelId: p.model.id, modelName: p.model.name, kind: p.model.kind, op: p.op, prompt: j.prompt, count: p.outputs, costUsd: p.costUsd, demo: p.demo };
  } catch (e) {
    return { tool: "generate", modelId: j.model_id, modelName: j.model_id, kind: "image", op: (j.op as Operation) ?? "t2i", prompt: j.prompt, count: 0, costUsd: 0, demo: false, error: (e as Error).message };
  }
}

const GenerateInput = z.object({
  summary: z.string().describe("One short sentence describing the plan, shown on the approval card."),
  jobs: z.array(Job).describe("1–6 jobs. Jobs in one call run in parallel; to use one job's output in another, call generate again after check_generations."),
});

const generate = defineTool({
  name: "generate",
  description:
    "Start image, video or audio generations. The app shows the user the plan with its cost and runs it once they approve, so call this directly instead of asking for confirmation in text. Returns generation ids; their results appear in the chat by themselves.",
  schema: GenerateInput,
  gated: true,
  strict: true,
  plan: ({ jobs }) => jobs.slice(0, 6).map(planJob),
  async run({ jobs }) {
    const ids: string[] = [];
    const results: unknown[] = [];
    for (const j of jobs.slice(0, 6)) {
      try {
        const gens = createGenerations(toRequest(j));
        ids.push(...gens.map((g) => g.id));
        results.push({ model: j.model_id, started: gens.map((g) => g.id), demo: gens.some((g) => g.provider === "mock") || undefined, costUsd: gens.reduce((s, g) => s + (g.costUsd ?? 0), 0) || undefined });
      } catch (e) {
        results.push({ model: j.model_id, error: (e as Error).message });
      }
    }
    const failed = results.length && ids.length === 0;
    return {
      content: JSON.stringify(results),
      isError: !!failed,
      items: ids.length ? [{ id: "", role: "generations", ids }] : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// create_storyboard

const StoryboardInput = z.object({
  story: z.string().optional().describe("The story to split into frames (or give scenes)."),
  scenes: z.array(z.string()).optional().describe("One description per frame, in order (up to 8)."),
  frames: z.number().int().optional().describe("Number of frames when splitting a story (1–8, default 4)."),
  references: z.array(ref).optional().describe("Up to 4 character/style reference images used for every frame."),
  style: z.string().optional().describe("A look applied to every frame, e.g. 'moody 35mm film'."),
  aspect_ratio: z.string().optional(),
});

const storyboard = defineTool({
  name: "create_storyboard",
  description:
    "Make a storyboard: up to 8 consecutive frames of one film with the same characters and look, each made from the previous one. Use it for comics, storyboards, shot lists and 'tell this story in N images'. Gated by the same approval card as generate.",
  schema: StoryboardInput,
  gated: true,
  strict: true,
  plan: (s, ctx) => {
    const engine = engineMode() === "both" ? ctx.engine : (engineMode() as "cloud" | "open");
    const m = STORYBOARD_MODELS[engine];
    const n = Math.max(1, Math.min(8, s.scenes?.length || s.frames || 4));
    let one: ReturnType<typeof previewGeneration> | null = null;
    let error: string | undefined;
    try {
      one = previewGeneration({ feature: "storyboard", modelId: m.first, prompt: s.story || s.scenes?.[0] || "frame", params: { aspectRatio: s.aspect_ratio } });
    } catch (e) {
      error = (e as Error).message;
    }
    if (!s.story?.trim() && !s.scenes?.some((x) => x.trim())) error = "Give a story or scenes";
    return [
      {
        tool: "create_storyboard",
        modelId: m.first,
        modelName: one?.model.name ?? m.first,
        kind: "image",
        op: "storyboard",
        prompt: s.story || (s.scenes ?? []).join(" / "),
        count: n,
        costUsd: one?.costUsd === null || !one ? null : one.costUsd * n,
        demo: one?.demo ?? false,
        error,
      },
    ];
  },
  async run(s, ctx) {
    const engine = engineMode() === "both" ? ctx.engine : (engineMode() as "cloud" | "open");
    const r = await createStoryboard({ engine, story: s.story, scenes: s.scenes, frames: s.frames, references: s.references, style: s.style, aspectRatio: s.aspect_ratio });
    return {
      content: JSON.stringify({ frames: r.items.map((g, i) => ({ id: g.id, scene: r.scenes[i] })), note: "Frames render one after another; each waits for the previous." }),
      items: [{ id: "", role: "generations", ids: r.items.map((g) => g.id), storyboard: true }],
    };
  },
});

// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDef<any>[] = [searchModels, listElementsTool, listRecent, checkGenerations, generate, storyboard];
export const getTool = (name: string) => TOOLS.find((t) => t.name === name);

/** JSON Schema for the API: every object closed, constraints the API doesn't take removed (zod still checks them). */
export function apiSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "maxItems", "minItems", "multipleOf"].includes(k)) continue;
      out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, walk(s)])) : walk(v);
    }
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return walk(json) as Anthropic.Beta.BetaTool.InputSchema;
}

export function apiTools(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: apiSchema(t.schema),
    ...(t.strict && { strict: true }),
  }));
}

export function planFor(name: string, input: unknown, ctx: ToolContext): { jobs: PlannedJob[]; total: number | null } {
  const t = getTool(name);
  const jobs = t?.plan?.(input, ctx) ?? [];
  return { jobs, total: totalCost(jobs) };
}

/** Validate and run a tool. Never throws: failures come back as an error result. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = getTool(name);
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".")} ${i.message}`).join("; ")}`, isError: true };
  try {
    return await tool.run(parsed.data, ctx);
  } catch (e) {
    return { content: (e as Error).message, isError: true };
  }
}
