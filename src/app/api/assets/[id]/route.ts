import { deleteAsset } from "@/server/storage";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const { id } = await ctx.params;
  deleteAsset(id);
  return new Response(null, { status: 204 });
}
