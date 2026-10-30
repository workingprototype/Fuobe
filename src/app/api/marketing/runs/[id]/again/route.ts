import { failure, rerun } from "@/server/marketing";
import { handler } from "@/server/access/route";

/** Run again: the same template, product and settings as a new run. */
export const POST = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/marketing/runs/[id]/again">) => {
  const { id } = await ctx.params;
  try {
    return Response.json({ runs: await rerun(id) }, { status: 201 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
});
