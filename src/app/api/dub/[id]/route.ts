import { connection } from "next/server";
import { z } from "zod";
import { CueSchema, deleteDubSession, dubView, getDubSession, saveDubDraft } from "@/server/dub";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Patch = z.object({ lang: z.string().min(2).max(12), cues: z.array(CueSchema).max(3000) });

export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/dub/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const s = getDubSession(id);
  return s ? Response.json(dubView(s)) : Response.json({ error: "Not found" }, { status: 404 });
});

/** Save the reviewed lines of one language. */
export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/dub/[id]">) => {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Those lines can't be saved" }, { status: 400 });
  try {
    return Response.json(saveDubDraft(id, parsed.data.lang, parsed.data.cues));
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: getDubSession(id) ? 422 : 404 });
  }
});

/** Forget the dub (its results stay in the Library). */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/dub/[id]">) => {
  const { id } = await ctx.params;
  return deleteDubSession(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
});
