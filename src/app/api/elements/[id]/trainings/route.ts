import { connection } from "next/server";
import { z } from "zod";
import { TRAINING_TARGETS } from "@/lib/catalog/training";
import { ensureRunner } from "@/server/generations";
import { listTrainings, startTraining, trainingBlocker } from "@/server/training";

export async function GET(_req: Request, ctx: RouteContext<"/api/elements/[id]/trainings">) {
  await connection();
  const { id } = await ctx.params;
  ensureRunner(); // the background poller also checks training jobs
  return Response.json({
    targets: TRAINING_TARGETS.map((t) => ({ ...t, blocker: trainingBlocker(t) })),
    items: listTrainings(id),
  });
}

const Body = z.object({ target: z.string().min(1) });

export async function POST(request: Request, ctx: RouteContext<"/api/elements/[id]/trainings">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick what to train" }, { status: 400 });
  try {
    ensureRunner();
    return Response.json(startTraining(id, parsed.data.target), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
