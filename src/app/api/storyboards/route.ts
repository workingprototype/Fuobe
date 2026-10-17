import { z } from "zod";
import { createStoryboard } from "@/server/storyboard";

const Body = z.object({
  engine: z.enum(["cloud", "open"]),
  scenes: z.array(z.string().max(1000)).max(8).optional(),
  story: z.string().max(4000).optional(),
  frames: z.number().int().min(1).max(8).optional(),
  references: z.array(z.string().startsWith("/api/files/")).max(4).optional(),
  style: z.string().max(500).optional(),
  aspectRatio: z.string().max(10).optional(),
  resolution: z.string().max(10).optional(),
});

/** Popcorn-style storyboard: consecutive frames, each made from the previous one. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(await createStoryboard(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
