import { connection } from "next/server";
import { deleteGeneration, getGeneration, setFavorite } from "@/server/generations";

export async function GET(_req: Request, ctx: RouteContext<"/api/generations/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const g = getGeneration(id);
  return g ? Response.json(g) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { favorite?: boolean };
  if (typeof body.favorite === "boolean") setFavorite(id, body.favorite);
  const g = getGeneration(id);
  return g ? Response.json(g) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const { id } = await ctx.params;
  deleteGeneration(id);
  return new Response(null, { status: 204 });
}
