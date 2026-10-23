import "server-only";
import fs from "node:fs/promises";
import { z } from "zod";
import { planJoin, planLoop, CROSSFADE_MAX, JOIN_MAX_CLIPS, LOOP_MAX_SECONDS, type AudioToolPreview, type ToolPlan } from "@/lib/av/audio-tools";
import type { Engine, Generation } from "@/lib/catalog/types";
import { probeMedia } from "@/lib/media-probe";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
import { engineMode } from "./settings";
import { absolutePath } from "./storage";

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

declare global {
  var __fuobeAudioLengths: Map<string, number | null> | undefined;
}
/**
 * Lengths already read, by file and version (path, size, modified time): the page asks for a price after
 * every settled change, and a Join of big WAVs would read every file again each time.
 */
const lengths = (globalThis.__fuobeAudioLengths ??= new Map<string, number | null>());
const LENGTHS_KEPT = 500;

/** A clip's length from its header (WAV, FLAC, MP3, M4A), else the browser's. Read without blocking the server. */
async function lengthOf(url: string, given?: number): Promise<number | undefined> {
  let file: string;
  let key: string;
  try {
    file = absolutePath(decodeURIComponent(url.slice("/api/files/".length)));
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error("not a file");
    key = `${file}:${st.size}:${st.mtimeMs}`;
  } catch {
    throw new AudioToolError("That audio file is gone — add it again");
  }
  if (!lengths.has(key)) {
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      throw new AudioToolError("That audio file is gone — add it again");
    }
    const info = probeMedia(data);
    if (lengths.size >= LENGTHS_KEPT) lengths.delete(lengths.keys().next().value!);
    lengths.set(key, info?.duration && info.duration > 0 ? Math.round(info.duration * 1000) / 1000 : null);
  }
  return lengths.get(key) ?? given;
}

async function plan(body: AudioToolRequest): Promise<ToolPlan & { engine: Engine }> {
  const mode = engineMode();
  if (mode !== "both" && body.engine !== mode) throw new AudioToolError(mode === "open" ? "This install is set to open source only (Settings → Engine mode)" : "This install is set to paid cloud APIs only (Settings → Engine mode)");
  try {
    if (body.tool === "loop") {
      const sourceDuration = await lengthOf(body.audio, body.sourceDuration);
      return { engine: body.engine, ...planLoop({ ...body, sourceDuration: sourceDuration ?? 0 }) };
    }
    const clips = await Promise.all(body.clips.map(async (c) => ({ ...c, duration: await lengthOf(c.url, c.duration) })));
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
