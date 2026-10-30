import { connection } from "next/server";
import { z } from "zod";
import { moodboardTrainingTargets, trainMoodboard } from "@/server/moodboards";
import { handler } from "@/server/access/route";

/** The style trainings a board can run (each with its price, what stops it and whether it would be a demo). */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json({ targets: moodboardTrainingTargets() });
});

const Body = z.object({ target: z.string().min(1).optional() }).nullable();

/** Train the board as a Fuobe look: a Z-Image Turbo style LoRA on your GPU (AI-Toolkit) or in the cloud (fal). */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/moodboards/[id]/train">) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  try {
    return Response.json(trainMoodboard(id, parsed.success ? parsed.data?.target : undefined), { status: 202 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 409 });
  }
});
