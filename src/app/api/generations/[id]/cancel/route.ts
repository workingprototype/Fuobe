import { cancelGeneration, getGeneration } from "@/server/generations";
import { handler } from "@/server/access/route";

export const POST = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/generations/[id]/cancel">) => {
  const { id } = await ctx.params;
  await cancelGeneration(id);
  return Response.json(getGeneration(id));
});
