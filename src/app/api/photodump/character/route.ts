import { z } from "zod";
import { createSheet, previewSheet, type SheetRun } from "@/server/photodump";

const Engine = z.enum(["cloud", "open"]);

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("reference"), engine: Engine, images: z.array(z.string().startsWith("/api/files/")).max(5), details: z.string().max(300).optional() }),
  z.object({
    mode: z.literal("cast"),
    engine: Engine,
    cast: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.array(z.string().max(60)).max(8)])),
    details: z.string().max(300).optional(),
  }),
  z.object({ mode: z.literal("describe"), engine: Engine, prompt: z.string().max(2000) }),
]);

/**
 * Character Sheet: a turnaround sheet from 1–5 reference photos, from a Soul Cast build, or from a
 * description (the AI Influencer app). `?preview=1` prices it instead.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const images = (parsed.error.issues.find((i) => i.path[0] === "images") && "Maximum 5 images") || "Upload at least 1 image";
    return Response.json({ error: images }, { status: 400 });
  }
  const input = parsed.data as SheetRun;
  if (new URL(request.url).searchParams.get("preview")) return Response.json(previewSheet(input));
  try {
    return Response.json(createSheet(input), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
