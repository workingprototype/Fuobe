import { handle, makeAvatar } from "@/server/faceless";

/** Draw a channel avatar in the channel's style (one picture generation; PATCH avatarUrl with it when it's done). */
export async function POST(_req: Request, ctx: RouteContext<"/api/faceless/channels/[id]/avatar">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeAvatar(id), { status: 201 });
  });
}
