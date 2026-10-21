import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { PlannedJob } from "@/lib/assist";
import { getModel } from "@/lib/catalog";
import { routesFor } from "@/lib/catalog/plan";
import type { ChainSlot, Engine, GenerationRequest, Operation } from "@/lib/catalog/types";
import { createPipeline, type PipelineStep } from "../chains";
import { db } from "../db";
import { chooseRoute, createGenerations, outputKind, previewChained } from "../generations";
import { engineMode } from "../settings";
import { fileUrl, saveFile } from "../storage";
import { defineTool, type ToolContext, type ToolOutcome } from "./define";

/**
 * Agent access to whole studios: split an image into layers, restyle footage, dub a video, make a
 * faceless episode, a batch of ads, captions. Each tool runs the studio's own module when one is
 * wired into STUDIO_ROUTES (so the job shows up in that studio), and otherwise builds the same job
 * from catalog models with createPipeline — the studios that aren't in this build still work
 * from Assist and MCP, just without their own page.
 */

// ---------------------------------------------------------------------------
// Wiring for the studio modules (set at merge; see the report for each adapter)

/** What a studio module returns when it takes a job: the generations to show and its page. */
export interface StudioRun {
  /** Generation ids to show in the chat (the finished results first). */
  ids: string[];
  /** The studio page for this job, e.g. /layers/<id>. */
  href?: string;
  /** Extra facts for the agent (session id, segments, steps). */
  info?: Record<string, unknown>;
}

export interface StudioRoute<I> {
  /** Price the job; the built-in plan is used when absent. */
  plan?: (input: I, ctx: ToolContext) => PlannedJob[];
  run: (input: I, ctx: ToolContext) => Promise<StudioRun>;
}

const ref = z.string().describe("A file URL from the chat: an attachment, a project source or an earlier output (/api/files/…).");

const LayersInput = z.object({
  image: ref.describe("The image to split."),
  layers: z.number().int().optional().describe("How many layers (2–8, default 4)."),
  focus: z.string().optional().describe("What to separate, e.g. 'the person, the product, the headline text, the background'."),
  model_id: z.string().optional().describe("A layers model from search_models (task layers); default: the engine's best."),
});
const RestyleInput = z.object({
  video: ref.describe("The footage to restyle."),
  style: z.string().describe("The new look, e.g. 'claymation, warm studio light' or 'anime, cel shading'."),
  references: z.array(ref).optional().describe("Up to 4 style reference images."),
  model_id: z.string().optional().describe("A video-to-video model from search_models (task v2v)."),
});
const DubInput = z.object({
  video: ref.describe("The video to dub."),
  languages: z.array(z.string()).describe("1–4 languages to dub into, e.g. ['Spanish', 'German']."),
  lipsync: z.boolean().optional().describe("Re-sync the lips to the new speech (default true)."),
  source_language: z.string().optional().describe("The language spoken in the video, if known."),
});
const FacelessInput = z.object({
  title: z.string().optional().describe("The episode title."),
  scenes: z
    .array(
      z.object({
        narration: z.string().describe("What the narrator says over this scene (about 8–10 seconds of speech)."),
        visual: z.string().describe("What the scene shows, in the episode's style."),
      }),
    )
    .describe("2–8 scenes in order."),
  style: z.string().describe("The visual style for every scene, e.g. 'flat 2D illustration, muted palette'."),
  aspect_ratio: z.string().optional().describe("9:16 (default), 16:9 or 1:1."),
  voice: z.string().optional().describe("A premade narrator voice id for the cloud engine (search_models kind audio lists them)."),
  voice_sample: ref
    .optional()
    .describe("A short recording of the narrator (10–60 s of clear speech): an attachment, a saved voice or an earlier audio output. The narration clones it. Required on the open-source engine; on the cloud engine it replaces the premade voice."),
});
const AdsInput = z.object({
  brief: z.string().describe("What the ads sell and to whom, with the offer or angle."),
  product_image: ref.optional().describe("The product photo (keeps the real product in every ad)."),
  count: z.number().int().optional().describe("How many different ads (1–8, default 4)."),
  aspect_ratios: z.array(z.string()).optional().describe("Formats for each ad: 1:1, 4:5 (default), 9:16, 16:9."),
  headline: z.string().optional().describe("A headline to use exactly; otherwise each ad gets its own."),
  cta: z.string().optional().describe("Call to action, e.g. 'Shop now'."),
  brand_id: z.string().optional().describe("A brand kit id from the Ads studio, when the user has one."),
  product_id: z.string().optional().describe("A product id from the Ads studio, when the user has one."),
});
const CaptionsInput = z.object({
  video: ref.describe("The video to caption."),
  spoken_language: z.string().optional().describe("The language spoken in the video (auto-detected when left out on most models)."),
  translate_to: z.string().optional().describe("Caption in this language instead (translated subtitles)."),
});

export type LayersToolInput = z.infer<typeof LayersInput>;
export type RestyleToolInput = z.infer<typeof RestyleInput>;
export type DubToolInput = z.infer<typeof DubInput>;
export type FacelessToolInput = z.infer<typeof FacelessInput>;
export type AdsToolInput = z.infer<typeof AdsInput>;
export type CaptionsToolInput = z.infer<typeof CaptionsInput>;

/** Studio modules plug in here; a tool falls back to its catalog-model pipeline when its entry is empty. */
export const STUDIO_ROUTES: {
  split_layers?: StudioRoute<LayersToolInput>;
  restyle_footage?: StudioRoute<RestyleToolInput>;
  dub_video?: StudioRoute<DubToolInput>;
  faceless_episode?: StudioRoute<FacelessToolInput>;
  create_ads?: StudioRoute<AdsToolInput>;
  add_captions?: StudioRoute<CaptionsToolInput>;
} = {};

// ---------------------------------------------------------------------------
// Fallback: pipelines of catalog models

const engineOf = (ctx: ToolContext): Engine => (engineMode() === "both" ? ctx.engine : (engineMode() as Engine));
const pick = (ctx: ToolContext, cloud: string, open: string, override?: string) => override || (engineOf(ctx) === "open" ? open : cloud);
const asList = <T,>(a: T | T[] | undefined): T[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);
const req = (r: Omit<GenerationRequest, "feature">): GenerationRequest => ({ feature: "assist", ...r });

/**
 * Price each step of a pipeline the way createPipeline validates it, without creating anything.
 * Every job is marked `atomic`: a pipeline only starts when all of its steps can. `problems` names
 * a step (by key) that can't run as planned, in clearer words than the model's own check. With
 * `independent` the steps start on their own (a batch, not a pipeline): one bad step doesn't stop the rest.
 */
export function planSteps(tool: string, steps: PipelineStep[], problems: Record<string, string | undefined> = {}, independent = false): PlannedJob[] {
  const atomic = independent ? undefined : true;
  const jobs = steps.map((s, i): PlannedJob => {
    const chain = s.chain ?? s.request.chain;
    const r: GenerationRequest = { ...s.request, ...(chain && { chain }) };
    const label = s.request.step?.label ?? `Step ${i + 1} of ${steps.length}`;
    try {
      const problem = problems[s.key];
      if (problem) throw new Error(problem);
      const p = previewChained(r, asList(s.after).length);
      return { tool, modelId: p.model.id, modelName: p.model.name, kind: outputKind(p.op, p.model), op: p.op, prompt: s.request.prompt?.trim() || label, count: p.outputs, costUsd: p.costUsd, demo: p.demo, note: label, atomic };
    } catch (e) {
      const m = getModel(s.request.modelId);
      return { tool, modelId: s.request.modelId, modelName: m?.name ?? s.request.modelId, kind: m?.kind ?? "video", op: s.request.op ?? "t2i", prompt: s.request.prompt?.trim() || label, count: 0, costUsd: 0, demo: false, note: label, atomic, error: (e as Error).message };
    }
  });
  if (independent) return jobs;
  // createPipeline refuses a mix of demo and real steps: say so on the card already.
  if (jobs.some((j) => j.demo && !j.error) && jobs.some((j) => !j.demo && !j.error)) {
    const d = jobs.find((j) => j.demo && !j.error)!;
    d.error = `${d.modelName} would run as a demo while the other steps run for real — connect it in Settings, or turn on demo mode`;
  }
  return jobs;
}

/** Steps labelled for the Library ("Voice · Spanish"), keeping createPipeline's order index. */
function labelled(steps: (PipelineStep & { label: string })[]): PipelineStep[] {
  return steps.map(({ label, ...s }, i) => ({ ...s, request: { ...s.request, step: { label, index: i, of: steps.length } } }));
}

function layerSteps(i: LayersToolInput, ctx: ToolContext): PipelineStep[] {
  const n = Math.max(2, Math.min(8, i.layers ?? 4));
  return labelled([
    {
      key: "layers",
      label: "Layers",
      request: req({ modelId: pick(ctx, "seedream-5-layers", "oss-qwen-layered", i.model_id), op: "layers", prompt: i.focus?.trim() || "Split the image into clean layers", inputs: { images: [i.image] }, params: { numLayers: n } }),
    },
  ]);
}

function restyleSteps(i: RestyleToolInput, ctx: ToolContext): PipelineStep[] {
  const refs = (i.references ?? []).slice(0, 4);
  return labelled([
    {
      key: "restyle",
      label: "Restyled video",
      request: req({ modelId: pick(ctx, "kling-o3", "oss-mixed-media", i.model_id), op: "v2v", prompt: i.style, inputs: { video: i.video, ...(refs.length && { images: refs }) } }),
    },
  ]);
}

function dubSteps(i: DubToolInput, ctx: ToolContext): PipelineStep[] {
  const langs = [...new Set(i.languages.map((l) => l.trim()).filter(Boolean))].slice(0, 4);
  if (!langs.length) throw new Error("Name the language to dub into");
  const lipsync = i.lipsync !== false;
  if (engineOf(ctx) === "cloud") {
    // HeyGen translates, re-voices, lip-syncs and keeps the background in one job.
    return labelled(langs.map((l, k) => ({ key: `dub${k}`, label: `Dub · ${l}`, request: req({ modelId: "heygen-translate", op: "dub", inputs: { video: i.video }, params: { targetLanguage: l, sourceLanguage: i.source_language } }) })));
  }
  const steps: (PipelineStep & { label: string })[] = [
    { key: "stems", label: "Voice and background", request: req({ modelId: "oss-voice-separate", op: "separate-audio", inputs: { video: i.video } }) },
    { key: "words", label: "Transcript", request: req({ modelId: "oss-qwen3-asr", op: "transcribe", params: { sourceLanguage: i.source_language } }), after: "stems", chain: [{ slot: "audio", stem: "voice" }] },
  ];
  langs.forEach((l, k) => {
    steps.push(
      { key: `tr${k}`, label: `Translation · ${l}`, request: req({ modelId: "oss-text-llm", op: "translate", params: { targetLanguage: l } }), after: "words", chain: [{ slot: "prompt" }] },
      {
        key: `voice${k}`,
        label: `Voice · ${l}`,
        request: req({ modelId: "oss-chatterbox", op: "tts" }),
        after: [`tr${k}`, "stems"],
        chain: [{ slot: "prompt" }, { slot: "voiceAudio", stem: "voice" }],
      },
    );
    if (lipsync) steps.push({ key: `lips${k}`, label: `Lip sync · ${l}`, request: req({ modelId: "oss-infinitetalk-v2v", op: "lipsync", inputs: { video: i.video } }), after: `voice${k}`, chain: [{ slot: "audio" }] });
    const background: ChainSlot = { slot: "audio2", stem: "background" };
    steps.push(
      lipsync
        ? { key: `film${k}`, label: `Dubbed video · ${l}`, request: req({ modelId: "oss-mux", op: "mux" }), after: [`lips${k}`, `voice${k}`, "stems"], chain: [{ slot: "video" }, { slot: "audio" }, background] }
        : { key: `film${k}`, label: `Dubbed video · ${l}`, request: req({ modelId: "oss-mux", op: "mux", inputs: { video: i.video } }), after: [`voice${k}`, "stems"], chain: [{ slot: "audio" }, background] },
    );
  });
  return labelled(steps);
}

// The narrator's voice. Open-source narration (Chatterbox) clones a voice from a sample, so the
// open engine needs one; the cloud engine has premade voices, and clones a sample when given one.

const NEEDS_SAMPLE =
  "Add a voice sample for the narrator: open-source narration clones a voice. Attach or record 10–60 s of clear speech (or use a saved voice), then pass it as voice_sample.";

/** Whether a model's operation would run as a demo right now (no provider connected). */
function runsAsDemo(modelId: string, op: Operation): boolean {
  const m = getModel(modelId);
  if (!m) return false;
  try {
    return chooseRoute(routesFor(m, op)).demo;
  } catch {
    return false;
  }
}

/** Stands in for the demo voice while planning, so a plan never writes a file. */
const DEMO_VOICE_PLAN = "/api/files/uploads/fuobe-demo-voice.wav";

/**
 * A voice to clone when the open narrator has no sample and the narration only runs as a demo
 * anyway (no ComfyUI): a short tone saved once, so demo mode stays clickable end to end. It has the
 * same asset name as Faceless Studio's, so the two share one file.
 */
function demoVoice(): string {
  const found = db().prepare("SELECT rel_path FROM assets WHERE name = 'fuobe-demo-voice.wav' LIMIT 1").get() as { rel_path: string } | undefined;
  if (found) return fileUrl(found.rel_path);
  const rate = 16000;
  const n = rate * 2;
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
  for (let k = 0; k < n; k++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * k) / rate) * 0.2 * 32767 * Math.min(1, k / 800, (n - k) / 800)), 44 + k * 2);
  return saveFile({ data: buf, contentType: "audio/wav", name: "fuobe-demo-voice.wav", source: "upload" }).url;
}

/** Planning uses a placeholder for the demo voice; starting the job saves the real file. */
type VoiceFor = "plan" | "run";

/** The narration model and the sample it clones (none: a premade voice); `missing` when the open engine has nothing to clone. */
export function narratorVoice(i: Pick<FacelessToolInput, "voice_sample">, ctx: ToolContext, voiceFor: VoiceFor = "plan"): { modelId: string; voiceAudio?: string; missing?: string } {
  const sample = i.voice_sample?.trim();
  if (engineOf(ctx) === "cloud") return sample ? { modelId: "chatterbox-cloud", voiceAudio: sample } : { modelId: "elevenlabs-v4" };
  if (sample) return { modelId: "oss-chatterbox", voiceAudio: sample };
  if (runsAsDemo("oss-chatterbox", "tts")) return { modelId: "oss-chatterbox", voiceAudio: voiceFor === "run" ? demoVoice() : DEMO_VOICE_PLAN };
  return { modelId: "oss-chatterbox", missing: NEEDS_SAMPLE };
}

function facelessSteps(i: FacelessToolInput, ctx: ToolContext, voiceFor: VoiceFor = "plan"): PipelineStep[] {
  const scenes = i.scenes.filter((s) => s.visual.trim() || s.narration.trim()).slice(0, 8);
  if (scenes.length < 2) throw new Error("Give at least 2 scenes");
  const open = engineOf(ctx) === "open";
  const aspect = ["9:16", "16:9", "1:1"].includes(i.aspect_ratio ?? "") ? i.aspect_ratio! : "9:16";
  const stillModel = open ? "oss-z-image-turbo" : "nano-banana-pro";
  // Higgsfield's Faceless runs Gemini Omni Flash per block (16:9 / 9:16 only); square goes to Seedance.
  const clipModel = open ? "oss-wan22-14b-fast" : aspect === "1:1" ? "seedance-2-5" : "gemini-omni-flash";
  const steps: (PipelineStep & { label: string })[] = [];
  scenes.forEach((s, k) => {
    steps.push(
      { key: `still${k}`, label: `Scene ${k + 1} · still`, request: req({ modelId: stillModel, op: "t2i", prompt: `${s.visual.trim()}. Style: ${i.style.trim()}. No text.`, params: { aspectRatio: aspect } }) },
      {
        key: `clip${k}`,
        label: `Scene ${k + 1} · clip`,
        request: req({ modelId: clipModel, op: "i2v", prompt: `${s.visual.trim()}. Gentle, slow camera push-in; subtle natural motion; same style.`, params: { aspectRatio: aspect, ...(clipModel === "seedance-2-5" && { duration: 5 }) } }),
        after: `still${k}`,
        chain: [{ slot: "images", position: "first" }],
      },
    );
  });
  // Joins: the open join takes up to 4 clips a step, so longer episodes join in groups first.
  const join = open ? "oss-join-clips" : "join-clips";
  const clips = scenes.map((_, k) => `clip${k}`);
  let film: string;
  if (clips.length <= (open ? 4 : 24)) {
    steps.push({ key: "film", label: "Joined scenes", request: req({ modelId: join, op: "concat", prompt: i.title?.trim() || "Episode" }), after: clips, chain: clips.map(() => ({ slot: "videos" as const })) });
    film = "film";
  } else {
    const groups: string[] = [];
    for (let g = 0; g * 4 < clips.length; g++) {
      const part = clips.slice(g * 4, g * 4 + 4);
      steps.push({ key: `part${g}`, label: `Scenes ${g * 4 + 1}–${g * 4 + part.length} joined`, request: req({ modelId: join, op: "concat", prompt: i.title?.trim() || "Episode" }), after: part, chain: part.map(() => ({ slot: "videos" as const })) });
      groups.push(`part${g}`);
    }
    steps.push({ key: "film", label: "Joined scenes", request: req({ modelId: join, op: "concat", prompt: i.title?.trim() || "Episode" }), after: groups, chain: groups.map(() => ({ slot: "videos" as const })) });
    film = "film";
  }
  const narrator = narratorVoice(i, ctx, voiceFor);
  const narration = scenes.map((s) => s.narration.trim()).filter(Boolean).join("\n\n");
  steps.push(
    {
      key: "voice",
      label: "Narration",
      request: req({ modelId: narrator.modelId, op: "tts", prompt: narration, ...(narrator.voiceAudio ? { inputs: { voiceAudio: narrator.voiceAudio } } : { params: { voice: i.voice } }) }),
    },
    { key: "episode", label: "Episode", request: req({ modelId: open ? "oss-mux" : "merge-audio-video", op: "mux", prompt: i.title?.trim() || "Episode" }), after: [film, "voice"], chain: [{ slot: "video" }, { slot: "audio" }] },
  );
  return labelled(steps);
}

function captionSteps(i: CaptionsToolInput, ctx: ToolContext): PipelineStep[] {
  if (engineOf(ctx) === "cloud") {
    const model = i.translate_to ? "veed-subtitles" : "auto-subtitle";
    return labelled([{ key: "captions", label: "Captioned video", request: req({ modelId: model, op: "captions", inputs: { video: i.video }, params: { sourceLanguage: i.spoken_language, targetLanguage: i.translate_to } }) }]);
  }
  const steps: (PipelineStep & { label: string })[] = [{ key: "words", label: "Transcript", request: req({ modelId: "oss-qwen3-asr", op: "transcribe", inputs: { video: i.video }, params: { sourceLanguage: i.spoken_language } }) }];
  let last = "words";
  if (i.translate_to) {
    steps.push({ key: "tr", label: `Translation · ${i.translate_to}`, request: req({ modelId: "oss-text-llm", op: "translate", params: { targetLanguage: i.translate_to } }), after: "words", chain: [{ slot: "prompt" }] });
    last = "tr";
  }
  steps.push({ key: "captions", label: "Captioned video", request: req({ modelId: "oss-captions-burnin", op: "captions", inputs: { video: i.video } }), after: last, chain: [{ slot: "prompt" }] });
  return labelled(steps);
}

const AD_ANGLES = [
  "Hero layout: the product large in the centre, headline above, call-to-action button below, bold brand colour backdrop",
  "Lifestyle scene: the product in use in a real setting, headline on a clean band across the top",
  "Offer burst: a large badge with the offer, the product to one side, high-contrast colours",
  "Minimal split layout: the product on one half, the headline and a short line on the other, lots of whitespace",
  "Social proof card: a short customer quote with five stars beside the product",
  "Benefit callouts: the product with three short labelled benefits and simple icons",
  "Close-up detail: a dramatic macro of the product with the headline in large type",
  "Problem / solution: the problem on the left, the product as the answer on the right",
];

function adRequests(i: AdsToolInput, ctx: ToolContext): GenerationRequest[] {
  const n = Math.max(1, Math.min(8, i.count ?? 4));
  const ratios = (i.aspect_ratios?.length ? i.aspect_ratios : ["4:5"]).slice(0, 4);
  const open = engineOf(ctx) === "open";
  const model = i.product_image ? (open ? "oss-qwen-edit" : "nano-banana-pro") : open ? "oss-qwen-image" : "nano-banana-pro";
  const out: GenerationRequest[] = [];
  for (let k = 0; k < n && out.length < 12; k++) {
    for (const ratio of ratios) {
      if (out.length >= 12) break;
      const text = [
        `Advertising creative: ${i.brief.trim()}.`,
        `${AD_ANGLES[k % AD_ANGLES.length]}.`,
        i.headline ? `Headline exactly: “${i.headline.trim()}”.` : "A short, punchy headline of 2–6 words.",
        i.cta ? `Call-to-action button: “${i.cta.trim()}”.` : "",
        i.product_image ? "Keep the product exactly as in the photo: same shape, colours, label and logo." : "",
        "Clean modern layout, crisp legible typography, no other text, no watermark.",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(req({ modelId: model, op: i.product_image ? "edit" : "t2i", prompt: text, ...(i.product_image && { inputs: { images: [i.product_image] } }), params: { aspectRatio: ratio } }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tools

function startPipeline(tool: string, steps: PipelineStep[], title: string, show: "last" | "all" = "last"): ToolOutcome {
  const p = createPipeline(steps.map((s) => ({ ...s, request: { ...s.request, batchTitle: title.slice(0, 200) } })));
  const final = p.items.at(-1)!;
  const finals = steps.filter((s) => !steps.some((t) => asList(t.after).includes(s.key))).map((s) => p.byKey[s.key].id);
  const ids = show === "all" ? p.items.map((g) => g.id) : finals;
  return {
    content: JSON.stringify({
      steps: steps.map((s) => ({ step: s.request.step?.label, id: p.byKey[s.key].id, waitsFor: asList(s.after).map((a) => p.byKey[a].id) })),
      results: finals,
      demo: final.provider === "mock" || undefined,
      note: `${steps.length} step${steps.length === 1 ? "" : "s"}; each starts by itself when the ones it waits for finish. The finished result${finals.length > 1 ? "s appear" : " appears"} in the chat.`,
    }),
    items: [
      { id: "", role: "tool", text: `${tool}: started ${steps.length} step${steps.length === 1 ? "" : "s"}`, href: "/library" },
      { id: "", role: "generations", ids },
    ],
  };
}

async function viaStudio<I>(route: StudioRoute<I> | undefined, input: I, ctx: ToolContext, label: string): Promise<ToolOutcome | null> {
  if (!route) return null;
  const r = await route.run(input, ctx);
  return {
    content: JSON.stringify({ results: r.ids, ...(r.href && { open: r.href }), ...r.info }),
    items: [{ id: "", role: "tool", text: label, ...(r.href && { href: r.href }) }, ...(r.ids.length ? [{ id: "", role: "generations" as const, ids: r.ids }] : [])],
  };
}

const splitLayers = defineTool({
  name: "split_layers",
  description:
    "Split an image into separate transparent layers (person, product, text, background…) for editing — Fuobe's Layers studio. Use it for 'separate the layers', 'make this editable', 'cut everything out into layers'. Gated by the same approval card as generate.",
  schema: LayersInput,
  gated: true,
  title: () => "Split into layers",
  plan: (i, ctx) => STUDIO_ROUTES.split_layers?.plan?.(i, ctx) ?? planSteps("split_layers", layerSteps(i, ctx)),
  async run(i, ctx) {
    return (await viaStudio(STUDIO_ROUTES.split_layers, i, ctx, "Opened a Layers project")) ?? startPipeline("Layers", layerSteps(i, ctx), "Layers", "all");
  },
});

const restyleFootage = defineTool({
  name: "restyle_footage",
  description:
    "Restyle the user's own footage into a new look (anime, claymation, oil paint, a reference image's style) while keeping its motion — Fuobe's Shorts / Mixed Media studio. Use it for 'turn my clip into…', 'restyle this video'. Gated by the same approval card as generate.",
  schema: RestyleInput,
  gated: true,
  title: (i) => `Restyle: ${i.style.slice(0, 60)}`,
  plan: (i, ctx) => STUDIO_ROUTES.restyle_footage?.plan?.(i, ctx) ?? planSteps("restyle_footage", restyleSteps(i, ctx)),
  async run(i, ctx) {
    return (await viaStudio(STUDIO_ROUTES.restyle_footage, i, ctx, "Started a Shorts restyle")) ?? startPipeline("Restyle", restyleSteps(i, ctx), `Restyle: ${i.style}`);
  },
});

const dubVideo = defineTool({
  name: "dub_video",
  description:
    "Dub a video into 1–4 other languages in the speaker's own voice, optionally lip-synced, keeping the background sound — Fuobe's Translate & dub studio. One approval runs every step (voice separation, transcript, translation, voice, lip sync, mix). Gated by the same approval card as generate.",
  schema: DubInput,
  gated: true,
  title: (i) => `Dub into ${i.languages.join(", ")}`,
  plan: (i, ctx) => {
    if (STUDIO_ROUTES.dub_video?.plan) return STUDIO_ROUTES.dub_video.plan(i, ctx);
    try {
      return planSteps("dub_video", dubSteps(i, ctx));
    } catch (e) {
      return [{ tool: "dub_video", modelId: "dub", modelName: "Translate & dub", kind: "video", op: "dub", prompt: i.languages.join(", "), count: 0, costUsd: 0, demo: false, atomic: true, error: (e as Error).message }];
    }
  },
  async run(i, ctx) {
    return (await viaStudio(STUDIO_ROUTES.dub_video, i, ctx, "Started a dub")) ?? startPipeline("Dub", dubSteps(i, ctx), `Dub into ${i.languages.join(", ")}`);
  },
});

const facelessEpisode = defineTool({
  name: "faceless_episode",
  description:
    "Make a narrated faceless video from scenes you wrote: a still and an animated clip per scene in one style, the narration, joined into one episode — Fuobe's Faceless studio. Write the narration and visuals first (load the faceless-video skill), then call this once. On the open-source engine the narration clones voice_sample, so ask the user for a recording (or a saved voice) when there is none. Gated by the same approval card as generate.",
  schema: FacelessInput,
  gated: true,
  title: (i) => i.title?.trim() || "Faceless episode",
  plan: (i, ctx) => {
    if (STUDIO_ROUTES.faceless_episode?.plan) return STUDIO_ROUTES.faceless_episode.plan(i, ctx);
    try {
      return planSteps("faceless_episode", facelessSteps(i, ctx), { voice: narratorVoice(i, ctx).missing });
    } catch (e) {
      return [{ tool: "faceless_episode", modelId: "faceless", modelName: "Faceless episode", kind: "video", op: "concat", prompt: i.title ?? "Episode", count: 0, costUsd: 0, demo: false, atomic: true, error: (e as Error).message }];
    }
  },
  async run(i, ctx) {
    const studio = await viaStudio(STUDIO_ROUTES.faceless_episode, i, ctx, "Started a faceless episode");
    if (studio) return studio;
    const missing = narratorVoice(i, ctx).missing;
    if (missing) return { content: JSON.stringify({ error: missing }), isError: true };
    return startPipeline("Faceless episode", facelessSteps(i, ctx, "run"), i.title?.trim() || "Faceless episode");
  },
});

const createAds = defineTool({
  name: "create_ads",
  description:
    "Make a batch of different ad creatives (1–8 concepts × up to 4 formats) for a product: varied layouts and angles, headline, call to action, the real product from its photo — Fuobe's Ads studio. Use it for 'ads for my product', 'a set of Meta ads', 'creatives to test'. Gated by the same approval card as generate.",
  schema: AdsInput,
  gated: true,
  title: (i) => `${Math.max(1, Math.min(8, i.count ?? 4))} ads: ${i.brief.slice(0, 50)}`,
  plan: (i, ctx) => {
    if (STUDIO_ROUTES.create_ads?.plan) return STUDIO_ROUTES.create_ads.plan(i, ctx);
    return planSteps(
      "create_ads",
      adRequests(i, ctx).map((r, k) => ({ key: `ad${k}`, request: { ...r, step: { label: `Ad ${k + 1} · ${r.params?.aspectRatio}`, index: k, of: 0 } } })),
      {},
      true,
    );
  },
  async run(i, ctx) {
    const studio = await viaStudio(STUDIO_ROUTES.create_ads, i, ctx, "Started an ads batch");
    if (studio) return studio;
    const batchId = nanoid(10);
    const ids: string[] = [];
    const errors: string[] = [];
    for (const r of adRequests(i, ctx)) {
      try {
        ids.push(...createGenerations({ ...r, batchTitle: `Ads: ${i.brief.slice(0, 120)}` }, { batchId }).map((g) => g.id));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!ids.length) return { content: JSON.stringify({ error: errors[0] ?? "Nothing could start" }), isError: true };
    return { content: JSON.stringify({ started: ids, ...(errors.length && { errors }) }), items: [{ id: "", role: "generations", ids }] };
  },
});

const addCaptions = defineTool({
  name: "add_captions",
  description:
    "Burn captions into a video from its speech, optionally translated into another language — Fuobe's Captions tool. Gated by the same approval card as generate.",
  schema: CaptionsInput,
  gated: true,
  title: (i) => (i.translate_to ? `Captions in ${i.translate_to}` : "Captions"),
  plan: (i, ctx) => STUDIO_ROUTES.add_captions?.plan?.(i, ctx) ?? planSteps("add_captions", captionSteps(i, ctx)),
  async run(i, ctx) {
    return (await viaStudio(STUDIO_ROUTES.add_captions, i, ctx, "Started captions")) ?? startPipeline("Captions", captionSteps(i, ctx), i.translate_to ? `Captions in ${i.translate_to}` : "Captions");
  },
});

export const STUDIO_TOOLS = [splitLayers, restyleFootage, dubVideo, facelessEpisode, createAds, addCaptions];

/** For tests: the fallback pipelines, as they would be created. */
export const fallbackSteps = { layers: layerSteps, restyle: restyleSteps, dub: dubSteps, faceless: facelessSteps, captions: captionSteps, ads: adRequests };
