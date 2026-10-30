import { createStoryboard, StoryboardBodySchema } from "@/server/storyboard";
import { handler } from "@/server/access/route";

/** Popcorn-style storyboard: consecutive frames, each made from the previous one. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = StoryboardBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(await createStoryboard(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
