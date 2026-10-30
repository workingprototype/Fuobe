import { estimateStoryboard, StoryboardBodySchema } from "@/server/storyboard";

/** What a board costs before it runs ("Free" on your GPU): every frame, the look's model for frame 1. */
export async function POST(request: Request) {
  const parsed = StoryboardBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(estimateStoryboard(parsed.data));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
