import { CreativePatch, deleteCreative, updateCreative } from "@/server/ads";
import { readBody } from "@/server/marketing";
import { handler } from "@/server/access/route";

/** Edit an ad's words or layout (the picture stays). */
export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/ads/creatives/[id]">) => {
  const { id } = await ctx.params;
  const body = await readBody(request, CreativePatch, "Check the ad's text");
  if (body instanceof Response) return body;
  const c = updateCreative(id, body);
  return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
});

/** Remove an ad from the grid (its picture stays in the Library). */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/ads/creatives/[id]">) => {
  const { id } = await ctx.params;
  return deleteCreative(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
});
