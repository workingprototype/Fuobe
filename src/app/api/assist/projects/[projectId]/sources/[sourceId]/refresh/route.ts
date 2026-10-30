import { ProjectError, refreshSource } from "@/server/assist/projects";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

/** Fetch a link source again. */
export const POST = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources/[sourceId]/refresh">) => {
  const { projectId, sourceId } = await ctx.params;
  try {
    return Response.json(await refreshSource(projectId, sourceId));
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
});
