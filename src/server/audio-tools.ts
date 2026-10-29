import "server-only";
import fs from "node:fs/promises";
import { z } from "zod";
import { planJoin, planLoop, CROSSFADE_MAX, JOIN_MAX_CLIPS, LOOP_MAX_SECONDS, type AudioToolPreview, type ToolPlan } from "@/lib/av/audio-tools";
import { CLOUD_ONLY_PROBLEM, dbsChannelsFor, hostPick, planRemux, planSplit, splitTime } from "@/lib/av/split";
import type { Engine, Generation } from "@/lib/catalog/types";
import { probeMedia } from "@/lib/media-probe";
import { createPipeline } from "./chains";
import { previewChained } from "./generations";
import { comfyDevice } from "./providers/comfyui";
import { engineMode } from "./settings";
import { absolutePath } from "./storage";

/**
 * The Audio hub's Loop / extend, Join and Split soundtrack tools on the server: each clip's length is read from its own
 * header (the browser's figure is the fallback for containers the probe doesn't read), the plan from
 * src/lib/av/audio-tools.ts or src/lib/av/split.ts is priced step by step, and a run is one createPipeline batch, so its
 * results land in the Library like any generation. Split soundtrack runs on the open engine only (DBS isn't hosted);
 * its mix goes back on the video with a "remux" run on either engine.
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
  z.object({
    tool: z.literal("split"),
    engine: Engine,
    media: FileUrl,
    kind: z.enum(["audio", "video"]),
    name: z.string().max(200).optional(),
    /** Fast (DBS-BSRNN) or Best (DBS-TIGER); unset = the host's pick. */
    quality: z.enum(["fast", "best"]).optional(),
    stereo: z.boolean().optional(),
    /** What the browser decoded (the server reads WAV / FLAC / MP3 headers itself). */
    channels: z.number().int().positive().max(64).optional(),
    sourceDuration: z.number().positive().max(36_000).optional(),
  }),
  z.object({
    tool: z.literal("remux"),
    engine: Engine,
    video: FileUrl,
    audio: FileUrl,
    name: z.string().max(200).optional(),
  }),
]);
export type AudioToolRequest = z.infer<typeof AudioToolBody>;

export class AudioToolError extends Error {}

/** What a clip's header says. */
interface ClipFacts {
  duration?: number;
  channels?: number;
}

declare global {
  var __fuobeAudioFacts: Map<string, ClipFacts | null> | undefined;
}
/**
 * Lengths already read, by file and version (path, size, modified time): the page asks for a price after
 * every settled change, and a Join of big WAVs would read every file again each time.
 */
const lengths = (globalThis.__fuobeAudioFacts ??= new Map<string, ClipFacts | null>());
const LENGTHS_KEPT = 500;

/** A clip's length from its header (WAV, FLAC, MP3, M4A), else the browser's. Read without blocking the server. */
async function lengthOf(url: string, given?: number): Promise<number | undefined> {
  return (await factsOf(url))?.duration ?? given;
}

/** Throws `gone` unless the file is still in storage. */
async function present(url: string, gone: string): Promise<void> {
  try {
    if (!(await fs.stat(absolutePath(decodeURIComponent(url.slice("/api/files/".length))))).isFile()) throw new Error("not a file");
  } catch {
    throw new AudioToolError(gone);
  }
}

/** A clip's length and channel count from its header (cached by file version), or null when the header says neither. */
async function factsOf(url: string): Promise<ClipFacts | null> {
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
    const duration = info?.duration && info.duration > 0 ? Math.round(info.duration * 1000) / 1000 : undefined;
    lengths.set(key, duration || info?.channels ? { ...(duration && { duration }), ...(info?.channels && { channels: info.channels }) } : null);
  }
  return lengths.get(key) ?? null;
}

async function plan(body: AudioToolRequest): Promise<ToolPlan & { engine: Engine; split?: ClipFacts }> {
  const mode = engineMode();
  // Split soundtrack runs on the open engine only: an install set to paid APIs only says why, whichever engine was asked for.
  if (body.tool === "split" && mode === "cloud") throw new AudioToolError(CLOUD_ONLY_PROBLEM);
  if (mode !== "both" && body.engine !== mode) throw new AudioToolError(mode === "open" ? "This install is set to open source only (Settings → Engine mode)" : "This install is set to paid cloud APIs only (Settings → Engine mode)");
  try {
    if (body.tool === "split") {
      const facts = await factsOf(body.media);
      const seconds = facts?.duration ?? body.sourceDuration;
      const channels = facts?.channels ?? body.channels;
      return { engine: body.engine, ...planSplit({ ...body, seconds, channels }), split: { duration: seconds, channels } };
    }
    if (body.tool === "remux") {
      await present(body.audio, "That mix is gone — export it again");
      await present(body.video, "That video is gone — add it again");
      return { engine: body.engine, ...planRemux(body) };
    }
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
  const out: AudioToolPreview = { summary: p.summary, notes: p.notes, length: p.length, steps: p.steps.length, costUsd: cost === null ? null : Math.round(cost * 1000) / 1000, demo };
  if (body.tool === "split") {
    // How long it takes on this host: its device (asked once a minute), the model it would use and how many passes.
    const device = demo ? undefined : await comfyDevice().catch(() => undefined);
    const quality = body.quality ?? hostPick(device);
    const { duration: seconds, channels } = p.split ?? {};
    Object.assign(out, { hostPick: hostPick(device), ...(device && { device }) });
    if (seconds) out.estimate = splitTime({ seconds, quality, mode: dbsChannelsFor(body.stereo ? "each channel" : "mono", channels), channels, device });
  }
  return out;
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
