import { after } from "next/server";
import { ScheduleError, startSchedule } from "@/server/assist/schedules";

/** Run a task now, off schedule: a new chat starts and the agent works in the background. */
export async function POST(_req: Request, ctx: RouteContext<"/api/assist/schedules/[scheduleId]/run">) {
  try {
    const { threadId, done } = await startSchedule((await ctx.params).scheduleId);
    after(() => done);
    return Response.json({ threadId }, { status: threadId ? 202 : 409 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ScheduleError ? e.status : 500 });
  }
}
