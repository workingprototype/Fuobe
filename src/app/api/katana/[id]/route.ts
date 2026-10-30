import { connection } from "next/server";
import { deleteKatana, getKatana } from "@/server/katana";
import { handler } from "@/server/access/route";

export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/katana/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const job = getKatana(id);
  return job ? Response.json(job) : Response.json({ error: "Not found" }, { status: 404 });
});

/** Forget the run: steps still running are stopped first (the clips it made stay in the Library). */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/katana/[id]">) => {
  const { id } = await ctx.params;
  return deleteKatana(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
});
