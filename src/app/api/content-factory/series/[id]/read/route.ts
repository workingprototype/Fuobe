import { z } from "zod";
import { handle, rereadSeries } from "@/server/content-factory";
import { body } from "@/server/faceless";
import { handler } from "@/server/access/route";

const Read = z.object({ engine: z.enum(["cloud", "open"]) });

/** Read the reference clip again (on either engine). */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/content-factory/series/[id]/read">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await rereadSeries(id, (await body(request, Read, "Pick an engine")).engine));
  });
});
