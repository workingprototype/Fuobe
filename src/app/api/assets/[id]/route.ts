import { connection } from "next/server";
import { assetUses } from "@/server/generations";
import { deleteUnusedAsset } from "@/server/library";
import { getAsset } from "@/server/storage";
import { describeUses } from "@/lib/library";
import { handler } from "@/server/access/route";

/** A stored file and where it's used (`uses`, and `usedBy`: the same in one line, empty when nothing uses it). */
export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assets/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const asset = getAsset(id);
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  const uses = assetUses(id);
  return Response.json({ ...asset, uses, usedBy: describeUses(uses) });
});

/** Delete the file for good, only when nothing uses it (409 with `uses` and `usedBy` otherwise). */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assets/[id]">) => {
  const { id } = await ctx.params;
  const r = deleteUnusedAsset(id);
  if (!r) return Response.json({ error: "That file is already gone" }, { status: 404 });
  if (!r.deleted) {
    const usedBy = describeUses(r.uses);
    return Response.json({ error: `It's still used by ${usedBy}.`, uses: r.uses, usedBy }, { status: 409 });
  }
  return new Response(null, { status: 204 });
});
