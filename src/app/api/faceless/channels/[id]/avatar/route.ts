import { handle, makeAvatar } from "@/server/faceless";
import { handler } from "@/server/access/route";

/** Draw a channel avatar in the channel's style (one picture generation; it becomes the channel's picture when it's done). */
export const POST = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/faceless/channels/[id]/avatar">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeAvatar(id), { status: 201 });
  });
});
