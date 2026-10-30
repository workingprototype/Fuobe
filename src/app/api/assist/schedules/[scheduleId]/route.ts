import { connection } from "next/server";
import { deleteSchedule, getSchedule, ScheduleError, updateSchedule } from "@/server/assist/schedules";
import { ScheduleBody } from "@/server/assist/schemas";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Patch = ScheduleBody.partial();

export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/schedules/[scheduleId]">) => {
  await connection();
  const s = getSchedule((await ctx.params).scheduleId);
  return s ? Response.json(s) : Response.json({ error: "Not found" }, { status: 404 });
});

/** Edit, pause (`{paused: true}`) or resume a task. */
export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/assist/schedules/[scheduleId]">) => {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  try {
    const s = updateSchedule((await ctx.params).scheduleId, parsed.data);
    return s ? Response.json(s) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof ScheduleError ? e.status : 500 });
  }
});

/** Delete the task; the chats its runs made stay. */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/schedules/[scheduleId]">) => {
  return deleteSchedule((await ctx.params).scheduleId) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
});
