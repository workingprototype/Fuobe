import { generateInProject } from "@/server/cinema-generate";
import { GenerateBody, body, handle } from "@/server/cinema-schemas";
import { handler } from "@/server/access/route";

/**
 * Generate from the workspace: plans the run (model, chained steps), checks the project's cost
 * cap, creates the generations and records them in the project (in `folderId`).
 */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/generate">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, GenerateBody, "That request isn't valid");
    return Response.json(generateInProject(id, b.input, b.folderId ?? null), { status: 201 });
  });
});
