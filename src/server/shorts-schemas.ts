import "server-only";
import { z } from "zod";
import { MIXED } from "@/lib/catalog/mixed-media";
import { SHORTS } from "@/lib/catalog/shorts";
import { ShortsError } from "./shorts";

/** Request bodies for /api/shorts/** and /api/mixed-media/** (zod), and the shared error answer. */

const fileUrl = z.string().startsWith("/api/files/").max(500);
const seconds = z.number().finite().min(0).max(3600);

const source = z.object({
  url: fileUrl,
  name: z.string().max(200).optional(),
  duration: z.number().finite().positive().max(3600).optional(),
  fps: z.number().finite().positive().max(240).optional(),
});

export const ShortsBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  presetId: z.string().min(1).max(80),
  source,
  range: z.object({ start: seconds, end: seconds }),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  language: z.string().max(40).default("auto"),
  modelId: z.string().max(80).optional(),
});

/** The estimate is asked for before the upload finishes: any URL stands in. */
export const ShortsEstimateSchema = ShortsBodySchema.extend({ source: source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }) });

export const PresetBodySchema = z.object({
  name: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  references: z.array(fileUrl).min(1).max(SHORTS.maxReferences),
});

export const PresetPatchSchema = PresetBodySchema.partial();

export const MixedBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  presetId: z.string().min(1).max(80),
  values: z.record(z.string(), z.string().max(200)).optional(),
  source,
  range: z.object({ start: seconds, end: seconds }),
  fps: z.number().finite().min(MIXED.manualFps.min).max(MIXED.manualFps.max).default(MIXED.defaultFps),
  resolution: z.enum(MIXED.resolutions).default("1K"),
  modelId: z.string().max(80).optional(),
  anchor: fileUrl.optional(),
  frameUrl: fileUrl.optional(),
  seed: z.number().int().min(0).max(2 ** 48).optional(),
});

export const MixedEstimateSchema = MixedBodySchema.extend({ source: source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }) });

/** A user-facing error answer: ShortsError keeps its status; anything else from the planner is a 422. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ShortsError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 422 });
}

/** Parse a JSON body with a schema; a bad one is a 400 with `message`. */
export async function body<S extends z.ZodType>(request: Request, schema: S, message: string): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ShortsError(message, 400);
  return parsed.data;
}

/** Run a route body, answering errors as `{ error }`. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}
