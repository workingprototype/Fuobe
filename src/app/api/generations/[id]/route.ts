import { connection } from "next/server";
import { getGeneration, setFavorite } from "@/server/generations";
import { deleteForever, trashGenerations } from "@/server/library";

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

/** Move to the Trash (restore with POST /api/generations/bulk {action: "restore"}); `?forever=1` deletes for good. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const { id } = await ctx.params;
  if (new URL(request.url).searchParams.get("forever") === "1") await deleteForever([id]);
  else trashGenerations([id]);
  return new Response(null, { status: 204 });
}
