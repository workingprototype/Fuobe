import { connection } from "next/server";
import { CinemaError, deleteProject, getProject, listFolders, spentUsd, updateProject } from "@/server/cinema";
import { ProjectPatch, body, handle } from "@/server/cinema-schemas";
import { cinemaContext } from "@/server/cinema-generate";

/** The project with its folders, its estimated spend and what this install can run (Higgsfield key or not). */
export async function GET(_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) throw new CinemaError("Project not found", 404);
    const { higgsfield, cloudAllowed } = cinemaContext();
    return Response.json({ project, folders: listFolders(id), spentUsd: spentUsd(id), context: { higgsfield, cloudAllowed } });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, ProjectPatch, "Those project settings aren't valid");
    return Response.json(updateProject(id, patch));
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    deleteProject(id);
    return new Response(null, { status: 204 });
  });
}
