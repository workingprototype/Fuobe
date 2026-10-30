import { deleteSource } from "@/server/assist/projects";
import { handler } from "@/server/access/route";

export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources/[sourceId]">) => {
  const { projectId, sourceId } = await ctx.params;
  return deleteSource(projectId, sourceId) ? new Response(null, { status: 204 }) : Response.json({ error: "That source isn't in this project" }, { status: 404 });
});
