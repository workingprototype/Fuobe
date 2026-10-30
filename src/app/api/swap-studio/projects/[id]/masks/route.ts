import { body, handle } from "@/server/shorts-schemas";
import { makeMask, MaskSchema } from "@/server/swap-studio";
import { handler } from "@/server/access/route";

/** Who to swap, as a mask: Track shot (from a frame to the shot's end) or Update frame — a new mask version. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/masks">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeMask(id, await body(request, MaskSchema, "Pick a shot, a frame and who to swap")), { status: 201 });
  });
});
