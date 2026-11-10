import "server-only";
import type { GenerationRequest } from "@/lib/catalog/types";
import { accountInputProblem } from "./account-inputs";
import { accountById, accountRequest } from "./auth";
import { db } from "./db";
import { stampOf, withoutStamp } from "./run-stamp";

/**
 * An admin's re-run of an account's run that failed or was cancelled (POST /api/admin/generations/{id}/rerun): a new
 * run in the same account with the same request (feature, model, words, settings and files), sent through the account's
 * own Run (POST /api/generations) as if its page had sent it. So it meets every check a press of Run meets (the limits,
 * the moderation and billing services, the policy of this install's GPUs), and it is queued, priced and set aside the
 * same way. To the account it is a run like any other. Which run re-ran which is kept here for the admin API only.
 */

/** How a run must have ended to be re-run. */
export const RERUN_STATUSES = ["failed", "canceled"] as const;

/** A re-run being made that long ago and never finished (a server stopped in the middle): another may be made. */
const PENDING_MS = 2 * 60_000;

export const INPUTS_GONE = "Its input files are no longer here";

export class RerunError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The account's Run: the run route's POST, given as an argument so this module never imports a route. */
export type SubmitRun = (request: Request) => Promise<Response>;

export interface RerunResult {
  account: string;
  ids: string[];
  /** Why the new run waits to enter the line, when it does (the limits or a service). */
  held?: string;
}

interface Row {
  status: string;
  request_json: string;
  depends_on: string | null;
  batch_id: string | null;
}

/** The new run's ids for a re-run made of `id`, or null (none, or one being made). */
function madeOf(id: string): { ids: string[] | null; at: number } | undefined {
  const r = db().prepare("SELECT new_ids_json, at FROM admin_reruns WHERE run_id = ?").get(id) as { new_ids_json: string | null; at: number } | undefined;
  if (!r) return undefined;
  return { ids: r.new_ids_json ? (JSON.parse(r.new_ids_json) as string[]) : null, at: r.at };
}

/**
 * Re-run run `id` for its account. Throws RerunError with the status to answer: 404 for no such run, the owner's own run
 * or a deleted account; 409 for a run that hasn't failed or been cancelled, one in the Trash, a step of a longer run, an
 * account switched off, a run re-run already, or files that are gone; else the account's Run's own answer.
 */
export async function rerunFor(id: string, submit: SubmitRun, now = Date.now()): Promise<RerunResult> {
  const row = db().prepare("SELECT status, request_json, depends_on, batch_id FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new RerunError(404, "No such run");
  let stored: GenerationRequest;
  try {
    stored = JSON.parse(row.request_json) as GenerationRequest;
  } catch {
    throw new RerunError(409, "That run's request can't be read");
  }
  const accountId = stored.account;
  if (!accountId) throw new RerunError(404, "That run is the owner's own, not an account's");
  if (!(RERUN_STATUSES as readonly string[]).includes(row.status)) throw new RerunError(409, "Only a run that failed or was cancelled can be re-run", "not-ended");
  if (db().prepare("SELECT 1 FROM generation_trash WHERE generation_id = ?").get(id)) throw new RerunError(409, "That run was deleted", "deleted");
  const later = db().prepare("SELECT 1 FROM generations WHERE depends_on = @id OR (substr(depends_on, 1, 1) = '[' AND instr(depends_on, @quoted) > 0) LIMIT 1").get({ id, quoted: JSON.stringify(id) });
  if (row.depends_on || later) throw new RerunError(409, "That run is one step of a longer run, so it can't be re-run on its own", "chained");
  const account = accountById(accountId);
  if (!account) throw new RerunError(404, "That run's account is gone");
  if (account.disabled) throw new RerunError(409, "That account is switched off", "account-off");
  const made = madeOf(id);
  if (made?.ids) throw new RerunError(409, `That run was re-run already, as ${made.ids[0]}`, "rerun-already", { rerunAs: made.ids[0] });
  if (made && now - made.at < PENDING_MS) throw new RerunError(409, "A re-run of that run is being made", "rerun-pending");

  // The request as its page sent it: the server's own stamp and the account are set again by the Run.
  const base = withoutStamp(stored) as GenerationRequest & Record<string, unknown>;
  delete base.account;
  let body: Record<string, unknown> = base;
  // One job of a batch: its share of the outputs, not the whole batch's again.
  if (row.batch_id) {
    const jobs = db().prepare("SELECT COUNT(*) FROM generations WHERE batch_id = ? AND request_json = ? AND depends_on IS NULL").pluck().get(row.batch_id, row.request_json) as number;
    const asked = Math.max(1, Number(stored.params?.numOutputs) || 1);
    if (jobs > 1) body = { ...base, params: { ...stored.params, numOutputs: Math.max(1, Math.ceil(asked / jobs)) } };
  }
  const files = accountInputProblem(body as unknown as GenerationRequest, accountId);
  if (files?.code === "input-gone") throw new RerunError(409, INPUTS_GONE, "input-gone");
  if (files) throw new RerunError(files.status, files.error, files.code);

  // Where it ran before is where it is asked to run again (the Run decides, as for any press).
  const place = stampOf(stored).place === "pool" ? "pool" : "own";
  const send = async (preview: boolean, extra: Record<string, unknown>) => {
    const text = JSON.stringify({ ...body, place, ...extra });
    const res = await submit(
      accountRequest(account, `http://localhost/api/generations${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: text }),
    );
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  // Claimed first: two presses make one run.
  const claimed = db()
    .prepare("INSERT INTO admin_reruns (run_id, new_ids_json, at) VALUES (?, NULL, ?) ON CONFLICT (run_id) DO UPDATE SET at = excluded.at WHERE admin_reruns.new_ids_json IS NULL AND admin_reruns.at < ?")
    .run(id, now, now - PENDING_MS);
  if (claimed.changes === 0) throw new RerunError(409, "A re-run of that run is being made", "rerun-pending");
  try {
    // The price its page would show, as a press of Run sends it beside the request.
    const quote = (await send(true, {})).json.quote as { amount?: unknown; priceVersion?: unknown } | undefined;
    const shown = quote && typeof quote.amount === "number" && typeof quote.priceVersion === "string" ? { amount: quote.amount, priceVersion: quote.priceVersion } : undefined;
    const r = await send(false, shown ? { shown } : {});
    const items = Array.isArray(r.json.items) ? (r.json.items as { id?: unknown }[]) : [];
    const ids = items.map((g) => g.id).filter((x): x is string => typeof x === "string");
    if (r.status !== 201 || !ids.length) {
      const error = typeof r.json.error === "string" ? r.json.error : "The run couldn't be made";
      throw new RerunError(r.status === 201 ? 500 : r.status, error, typeof r.json.code === "string" ? r.json.code : undefined);
    }
    db().prepare("UPDATE admin_reruns SET new_ids_json = ?, at = ? WHERE run_id = ?").run(JSON.stringify(ids), Date.now(), id);
    const held = (r.json.held as { reason?: unknown } | undefined)?.reason;
    return { account: accountId, ids, ...(typeof held === "string" && { held }) };
  } catch (e) {
    db().prepare("DELETE FROM admin_reruns WHERE run_id = ? AND new_ids_json IS NULL").run(id);
    if (e instanceof RerunError) throw e;
    throw new RerunError(500, (e as Error).message || "The run couldn't be made");
  }
}

/** For each of `ids`: the run it is a re-run of, and the run it was re-run as (admin API only). */
export function rerunLinks(ids: string[]): Map<string, { rerunOf?: string; rerunAs?: string }> {
  const out = new Map<string, { rerunOf?: string; rerunAs?: string }>();
  if (!ids.length) return out;
  const set = (id: string, v: { rerunOf?: string; rerunAs?: string }) => out.set(id, { ...out.get(id), ...v });
  const list = JSON.stringify(ids);
  const as = db()
    .prepare("SELECT run_id, json_extract(new_ids_json, '$[0]') AS first FROM admin_reruns WHERE new_ids_json IS NOT NULL AND run_id IN (SELECT value FROM json_each(?))")
    .all(list) as { run_id: string; first: string }[];
  for (const r of as) set(r.run_id, { rerunAs: r.first });
  const of = db()
    .prepare("SELECT r.run_id, j.value AS id FROM admin_reruns r, json_each(r.new_ids_json) j WHERE r.new_ids_json IS NOT NULL AND j.value IN (SELECT value FROM json_each(?))")
    .all(list) as { run_id: string; id: string }[];
  for (const r of of) set(r.id, { rerunOf: r.run_id });
  return out;
}
