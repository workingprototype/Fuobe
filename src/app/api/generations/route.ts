import { connection } from "next/server";
import { z } from "zod";
import { createGenerations, listGenerations } from "@/server/generations";

const RequestSchema = z.object({
  feature: z.string().min(1),
  presetId: z.string().optional(),
  modelId: z.string().min(1),
  op: z.string().optional(),
  prompt: z.string().max(10_000).optional(),
  negativePrompt: z.string().max(4_000).optional(),
  inputs: z
    .object({
      images: z.array(z.string()).max(14).optional(),
      endImage: z.string().optional(),
      mask: z.string().optional(),
      sketch: z.string().optional(),
      video: z.string().optional(),
      audio: z.string().optional(),
    })
    .optional(),
  params: z
    .object({
      aspectRatio: z.string().optional(),
      resolution: z.string().optional(),
      duration: z.number().positive().max(600).optional(),
      numOutputs: z.number().int().min(1).max(8).optional(),
      seed: z.number().int().optional(),
      generateAudio: z.boolean().optional(),
      enhancePrompt: z.boolean().optional(),
      shots: z.array(z.object({ prompt: z.string().max(2000), duration: z.number().positive().max(60) })).max(12).optional(),
      multiShot: z.literal("auto").optional(),
      draft: z.boolean().optional(),
      draftId: z.string().max(8192).optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  presetOptions: z.record(z.string(), z.string()).optional(),
});

export async function GET(request: Request) {
  await connection();
  const u = new URL(request.url);
  const items = listGenerations({
    feature: u.searchParams.get("feature") ?? undefined,
    features: u.searchParams.get("features")?.split(",").filter(Boolean),
    kind: u.searchParams.get("kind") ?? undefined,
    favorites: u.searchParams.get("favorites") === "1",
    status: u.searchParams.get("status") ?? undefined,
    q: u.searchParams.get("q") ?? undefined,
    before: u.searchParams.get("before") ? Number(u.searchParams.get("before")) : undefined,
    limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
  });
  return Response.json({ items });
}

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  try {
    const items = createGenerations(parsed.data as Parameters<typeof createGenerations>[0]);
    return Response.json({ items }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
