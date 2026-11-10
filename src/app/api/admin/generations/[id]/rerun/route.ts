import { POST as submitRun } from "@/app/api/generations/route";
import { adminAccess, audit } from "@/server/admin-tokens";
import { rerunFor, RerunError } from "@/server/admin-rerun";

const NO_STORE = { "Cache-Control": "no-store" };

/** The longest reason the admin log keeps. */
const REASON_MAX = 300;

/**
 * Re-run an account's run that failed or was cancelled (owner only, or an admin token with runs:write): `{ reason? }`.
 * A new run is made in the same account with the same request, through the account's own Run, so it meets the same
 * checks, limits and services and is queued the same way; the account sees it as any run of its own. 201
 * `{ run, account, ids, held? }`. 404 for no such run, the owner's own run or a deleted account; 409 for a run still
 * going or done, one in the Trash, a step of a longer run, a switched-off account, a run re-run already (`rerunAs`) or
 * input files that are gone; any other refusal is the Run's own answer. Each call is in the admin log, with the reason.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/generations/[id]/rerun">) {
  const access = adminAccess(request, "runs:write", "Only the studio's owner re-runs a person's run");
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!/^[\w-]{1,80}$/.test(id)) {
    audit(access.actor, "run.rerun", null, null, 404);
    return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  }
  const text = await request.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    audit(access.actor, "run.rerun", id, null, 400);
    return Response.json({ error: "Send JSON: { reason? }" }, { status: 400, headers: NO_STORE });
  }
  const raw = body && typeof body === "object" ? (body as { reason?: unknown }).reason : undefined;
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    audit(access.actor, "run.rerun", id, null, 400);
    return Response.json({ error: "reason is a sentence" }, { status: 400, headers: NO_STORE });
  }
  const reason = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, REASON_MAX) : "";
  try {
    const made = await rerunFor(id, submitRun);
    audit(access.actor, "run.rerun", id, { account: made.account, ids: made.ids, ...(made.held && { held: made.held }), ...(reason && { reason }) }, 201);
    return Response.json({ run: id, account: made.account, ids: made.ids, ...(made.held && { held: made.held }) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    const status = e instanceof RerunError ? e.status : 500;
    const error = e instanceof RerunError ? e.message : "The run couldn't be made";
    const code = e instanceof RerunError ? e.code : undefined;
    const extra = e instanceof RerunError ? e.extra : {};
    audit(access.actor, "run.rerun", id, { error: error.slice(0, 200), ...(code && { code }), ...(reason && { reason }) }, status);
    return Response.json({ error, ...(code && { code }), ...extra }, { status, headers: NO_STORE });
  }
}
