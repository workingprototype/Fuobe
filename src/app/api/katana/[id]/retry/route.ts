import { getKatana, rerunKatana, retryKatana } from "@/server/katana";
import { handler } from "@/server/access/route";

/** Retry the failed steps of a run (and the ones after them); `?all=1` starts the same run again from scratch. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/katana/[id]/retry">) => {
  const { id } = await ctx.params;
  if (!getKatana(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    return Response.json(all ? rerunKatana(id) : retryKatana(id), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
