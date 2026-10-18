import { stitchSession } from "@/server/shorts";
import { handle } from "@/server/shorts-schemas";

/** Stitch again: join the chosen takes and put the original sound back. */
export async function POST(_req: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/stitch">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(stitchSession(id), { status: 201 });
  });
}
