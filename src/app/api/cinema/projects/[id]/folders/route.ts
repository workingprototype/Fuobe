import { createFolder } from "@/server/cinema";
import { FolderCreate, body, handle } from "@/server/cinema-schemas";
import { handler } from "@/server/access/route";

export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/folders">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = await body(request, FolderCreate, "Give the folder a name");
    return Response.json(createFolder(id, input), { status: 201 });
  });
});
