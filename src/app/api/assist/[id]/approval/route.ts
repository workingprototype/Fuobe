import { after } from "next/server";
import { z } from "zod";
import { answerApproval, AssistBusyError, run } from "@/server/assist/agent";
import { handler } from "@/server/access/route";

const Body = z.object({ approve: z.boolean() });

/** Approve (run) or decline the plan on the thread's approval card; the agent then carries on. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/assist/[id]/approval">) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Say approve true or false" }, { status: 400 });
  try {
    const thread = await answerApproval(id, parsed.data.approve);
    const reply = run(id);
    after(() => reply);
    return Response.json(thread);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof AssistBusyError ? 409 : 404 });
  }
});
