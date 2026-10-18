import { regenerateSegment, ShortsError } from "@/server/shorts";
import { handle } from "@/server/shorts-schemas";

/** Regenerate: one more take of this segment. */
export async function POST(_req: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/segments/[index]">) {
  return handle(async () => {
    const { id, index } = await ctx.params;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new ShortsError("No such segment", 404);
    return Response.json(regenerateSegment(id, i), { status: 201 });
  });
}
