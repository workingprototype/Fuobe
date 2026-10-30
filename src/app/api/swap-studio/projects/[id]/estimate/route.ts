import { connection } from "next/server";
import { handle } from "@/server/shorts-schemas";
import { estimateProject } from "@/server/swap-studio";
import { handler } from "@/server/access/route";

/** Prices before running: one take of each segment, each shot's and the project's queue, masks, anchors, words and assembly. */
export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/estimate">) => {
  await connection();
  return handle(async () => Response.json(estimateProject((await ctx.params).id)));
});
