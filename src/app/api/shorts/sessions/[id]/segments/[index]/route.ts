import { regenerateSegment, ShortsError } from "@/server/shorts";
import { NonceSchema, handle, once, optionalBody } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Regenerate: one more take of this segment (a repeated requestId gets the first answer, not a second take). */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/segments/[index]">) => {
  return handle(async () => {
    const { id, index } = await ctx.params;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new ShortsError("No such segment", 404);
    const { requestId } = await optionalBody(request, NonceSchema);
    return Response.json(await once(`shorts-take:${id}:${i}`, requestId, () => regenerateSegment(id, i)), { status: 201 });
  });
});
