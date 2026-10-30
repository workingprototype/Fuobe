import "server-only";
import { z } from "zod";
import { planJoin, planLoop, CROSSFADE_MAX, JOIN_MAX_CLIPS, LOOP_MAX_SECONDS, type AudioToolPreview, type ToolPlan } from "@/lib/av/audio-tools";
import type { Engine, Generation } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
import { engineMode } from "./settings";
import { storedMedia } from "./storage";

/**
 * The Audio hub's Loop / extend and Join tools on the server: each clip's length is read from its own header
 * (the browser's figure is the fallback for containers the probe doesn't read), the plan from
 * src/lib/av/audio-tools.ts is priced step by step, and a run is one createPipeline batch, so its result
 * lands in the Library like any generation.
 */

const FileUrl = z.string().startsWith("/api/files/").max(500);
const Engine = z.enum(["cloud", "open"]);
const Curve = z.enum(["equal-power", "linear"]).optional();
const Crossfade = z.number().min(0).max(CROSSFADE_MAX).optional();

export const AudioToolBody = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("loop"),
    engine: Engine,
    audio: FileUrl,
    name: z.string().max(200).optional(),
    duration: z.number().positive().max(LOOP_MAX_SECONDS),
    /** What the browser measured, used when the server can't read the file's header. */
    sourceDuration: z.number().positive().max(36_000).optional(),
    crossfade: Crossfade,
    curve: Curve,
  }),
  z.object({
    tool: z.literal("join"),
    engine: Engine,
    clips: z.array(z.object({ url: FileUrl, name: z.string().max(200).optional(), duration: z.number().positive().max(36_000).optional() })).min(2).max(JOIN_MAX_CLIPS),
    crossfade: Crossfade,
    curve: Curve,
  }),
]);
export type AudioToolRequest = z.infer<typeof AudioToolBody>;

export class AudioToolError extends Error {}

/**
 * A clip's length from its header (WAV, FLAC, MP3, M4A), else the browser's. Only the header is read, once per file
 * (storedMedia caches it: the page asks for a price after every settled change). A visitor's price check reads only its
 * own files: another's answers like one that is gone.
 */
function lengthOf(url: string, given?: number): number | undefined {
  const found = storedMedia(url);
  if (!found) throw new AudioToolError("That audio file is gone — add it again");
  const d = found.info?.duration;
  return d && d > 0 ? Math.round(d * 1000) / 1000 : given;
}

async function plan(body: AudioToolRequest): Promise<ToolPlan & { engine: Engine }> {
  const mode = engineMode();
  if (mode !== "both" && body.engine !== mode) throw new AudioToolError(mode === "open" ? "This install is set to open source only (Settings → Engine mode)" : "This install is set to paid cloud APIs only (Settings → Engine mode)");
  try {
    if (body.tool === "loop") {
      const sourceDuration = lengthOf(body.audio, body.sourceDuration);
      return { engine: body.engine, ...planLoop({ ...body, sourceDuration: sourceDuration ?? 0 }) };
    }
    const clips = body.clips.map((c) => ({ ...c, duration: lengthOf(c.url, c.duration) }));
    return { engine: body.engine, ...planJoin({ ...body, clips }) };
  } catch (e) {
    throw e instanceof AudioToolError ? e : new AudioToolError((e as Error).message);
  }
}

/** What a run would do and cost, without starting it. */
export async function previewAudioTool(body: AudioToolRequest): Promise<AudioToolPreview> {
  const p = await plan(body);
  let cost: number | null = 0;
  let demo = false;
  for (const s of p.steps) {
    let r: ReturnType<typeof previewChained>;
    try {
      r = previewChained(s.chain ? { ...s.request, chain: s.chain } : s.request, s.after?.length ?? 0);
    } catch (e) {
      throw new AudioToolError((e as Error).message);
    }
    demo ||= r.demo;
    cost = cost === null || r.costUsd === null ? null : cost + r.costUsd;
  }
  return { summary: p.summary, notes: p.notes, length: p.length, steps: p.steps.length, costUsd: cost === null ? null : Math.round(cost * 1000) / 1000, demo };
}

/** Start a run: one batch; the last step's generation is the result. */
export async function runAudioTool(body: AudioToolRequest): Promise<{ batchId: string; result: Generation; items: Generation[] }> {
  const p = await plan(body);
  try {
    const run = createPipeline(p.steps.map((s) => ({ key: s.key, request: s.request, ...(s.after && { after: s.after }), ...(s.chain && { chain: s.chain }) })));
    return { batchId: run.batchId, result: run.byKey[p.steps[p.steps.length - 1].key], items: run.items };
  } catch (e) {
    throw new AudioToolError((e as Error).message);
  }
}
