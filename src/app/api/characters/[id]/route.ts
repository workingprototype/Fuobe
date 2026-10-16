import { connection } from "next/server";
import { deleteCharacter, getCharacter } from "@/server/characters";

export async function GET(_req: Request, ctx: RouteContext<"/api/characters/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const c = getCharacter(id);
  return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/characters/[id]">) {
  const { id } = await ctx.params;
  deleteCharacter(id);
  return new Response(null, { status: 204 });
}
