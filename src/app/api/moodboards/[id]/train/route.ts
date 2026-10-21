import { trainMoodboard } from "@/server/moodboards";

/** Train the board as a Z-Image Turbo style LoRA (a style element, AI-Toolkit on your own GPU). */
export async function POST(_req: Request, ctx: RouteContext<"/api/moodboards/[id]/train">) {
  const { id } = await ctx.params;
  try {
    return Response.json(trainMoodboard(id), { status: 202 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 409 });
  }
}
