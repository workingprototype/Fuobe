import { deleteCustomPreset, ShortsError, updateCustomPreset } from "@/server/shorts";
import { PresetPatchSchema, body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/shorts/presets/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, PresetPatchSchema, "Those preset settings aren't valid");
    return Response.json(updateCustomPreset(id, patch));
  });
});

export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/shorts/presets/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!deleteCustomPreset(id)) throw new ShortsError("This preset no longer exists", 404);
    return new Response(null, { status: 204 });
  });
});
