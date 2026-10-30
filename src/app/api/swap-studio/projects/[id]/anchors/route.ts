import { AnchorSchema, makeAnchor } from "@/server/swap-studio";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** A scene anchor for a shot (or a reference for a segment): your character put into its first frame. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/anchors">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeAnchor(id, await body(request, AnchorSchema, "Pick a shot")), { status: 201 });
  });
});
