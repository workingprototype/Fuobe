import { deleteFolder, updateFolder } from "@/server/cinema";
import { FolderPatch, body, handle } from "@/server/cinema-schemas";
import { handler } from "@/server/access/route";

export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/folders/[folderId]">) => {
  return handle(async () => {
    const { id, folderId } = await ctx.params;
    const patch = await body(request, FolderPatch, "Those folder settings aren't valid");
    return Response.json(updateFolder(id, folderId, patch));
  });
});

/** Its takes and subfolders move up to the parent folder. */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]/folders/[folderId]">) => {
  return handle(async () => {
    const { id, folderId } = await ctx.params;
    deleteFolder(id, folderId);
    return new Response(null, { status: 204 });
  });
});
