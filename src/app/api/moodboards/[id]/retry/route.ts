import { z } from "zod";
import { retryMoodboard } from "@/server/moodboards";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Body = z.object({ engine: z.enum(["cloud", "open"]).optional() });

/** Run a board's cover job again (after a failure, or on the other engine). */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/moodboards/[id]/retry">) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  try {
    return Response.json(retryMoodboard(id, parsed.success ? parsed.data.engine : undefined));
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 409 });
  }
});
