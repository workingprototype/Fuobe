import { z } from "zod";
import { createStoryboardFilm } from "@/server/storyboard";
import { handler } from "@/server/access/route";

const Body = z.object({ modelId: z.string().max(100).optional() });

/** Animate a storyboard's frames into clips and join them into one film. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/storyboards/[id]/film">) => {
  const parsed = Body.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    return Response.json(createStoryboardFilm((await ctx.params).id, parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
