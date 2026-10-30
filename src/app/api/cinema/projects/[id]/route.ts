import { connection } from "next/server";
import { CinemaError, deleteProject, getProject, listFolders, spentUsd, updateProject } from "@/server/cinema";
import { ProjectPatch, body, handle } from "@/server/cinema-schemas";
import { cinemaContext } from "@/server/cinema-generate";
import { handler } from "@/server/access/route";

/** The project with its folders, its estimated spend and what this install can run (cloud models allowed, a civitai key). */
export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) => {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) throw new CinemaError("Project not found", 404);
    const { cloudAllowed, civitai } = cinemaContext();
    return Response.json({ project, folders: listFolders(id), spentUsd: spentUsd(id), context: { cloudAllowed, civitai } });
  });
});

export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, ProjectPatch, "Those project settings aren't valid");
    return Response.json(updateProject(id, patch));
  });
});

export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    deleteProject(id);
    return new Response(null, { status: 204 });
  });
});
