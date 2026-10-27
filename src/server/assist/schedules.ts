import "server-only";
import { nanoid } from "nanoid";
import { threadTitle, type AssistItem, type AssistModeChoice } from "@/lib/assist";
import {
  DEFAULT_SCHEDULE_CAP_USD,
  describeRule,
  formatWhen,
  nextRun,
  ruleError,
  validTimeZone,
  type ScheduleApproval,
  type ScheduleResult,
  type ScheduleRule,
  type ScheduleView,
} from "@/lib/assist-schedule";
import { formatCost } from "@/lib/format";
import { db } from "../db";
import { addMessage, createThread, getThread, resolveMode, run, type ModelCall } from "./agent";
import { getProject } from "./projects";

/**
 * Assist's scheduled tasks. A task is a prompt with a rule (daily, weekly, every N hours, once) in a
 * time zone; each run is a new chat (in the task's project, when it has one) that the server's sweep
 * starts — `ensureScheduleRunner()`, started at boot by src/instrumentation.ts, checks every 30 s.
 *
 * Approval per task: "ask" runs the chat until its first plan, which then waits as an approval card
 * (nothing is spent until the user approves); "auto" lets plans start on their own while they fit the
 * task's cost cap for that run, and leaves the rest waiting (see withinCap and the agent's step()).
 * A run the server missed (it was off) happens once when it's back, not once per missed time.
 */

export class ScheduleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SWEEP_MS = 30_000;
/** At most this many tasks start in one sweep; the rest start on the next. */
const PER_SWEEP = 10;

interface Row {
  id: string;
  title: string;
  prompt: string;
  attachments_json: string;
  project_id: string | null;
  rule_json: string;
  tz: string;
  approval: ScheduleApproval;
  cap_usd: number | null;
  engine: "cloud" | "open";
  mode_json: string | null;
  paused: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_thread_id: string | null;
  last_status: ScheduleResult["status"] | null;
  last_text: string | null;
  runs: number;
  created_at: number;
  updated_at: number;
}

/** A rule as the dialog sends it: "every N hours" gets its start (`from`) here. */
export type RuleInput = ScheduleRule extends infer R ? (R extends { kind: "hours" } ? Omit<R, "from"> & { from?: number } : R) : never;

export interface ScheduleInput {
  title: string;
  prompt: string;
  attachments?: string[];
  projectId?: string | null;
  rule: RuleInput;
  tz: string;
  approval: ScheduleApproval;
  capUsd?: number | null;
  engine: "cloud" | "open";
  mode?: AssistModeChoice | null;
  paused?: boolean;
}

const getRow = (id: string) => db().prepare("SELECT * FROM assist_schedules WHERE id = ?").get(id) as Row | undefined;

/** How a run's chat went, read from the chat itself (so an approval given later shows). */
function resultOf(r: Row): ScheduleResult | null {
  if (!r.last_status) return null;
  const stored: ScheduleResult = { threadId: r.last_thread_id, status: r.last_status, text: r.last_text ?? "" };
  if (r.last_status === "skipped" || !r.last_thread_id) return stored;
  const view = getThread(r.last_thread_id);
  if (!view) return { ...stored, threadId: null, text: stored.status === "running" ? "Its chat was deleted" : stored.text };
  return { threadId: r.last_thread_id, ...summarize(view.thread.status, view.thread.items) };
}

/** A chat's outcome in a few words: still going, a plan waiting, an error, or what it made. */
export function summarize(status: "idle" | "running" | "waiting", items: AssistItem[]): Omit<ScheduleResult, "threadId"> {
  if (status === "running") return { status: "running", text: "Working…" };
  if (status === "waiting") {
    const card = items.findLast((i) => i.role === "approval");
    const price = card?.role === "approval" ? (card.totalUsd === null ? "" : ` (${card.totalUsd === 0 ? "free" : formatCost(card.totalUsd)})`) : "";
    return { status: "waiting", text: `A plan waits for your approval${price}` };
  }
  const lastUser = items.findLastIndex((i) => i.role === "user");
  const after = items.slice(lastUser + 1);
  const error = after.findLast((i) => i.role === "notice" && i.tone === "error");
  if (error?.role === "notice" && !after.slice(after.indexOf(error) + 1).some((i) => i.role === "assistant")) return { status: "failed", text: error.text };
  const made = items.reduce((n, i) => n + (i.role === "generations" ? i.ids.length : 0), 0);
  const said = after.findLast((i) => i.role === "assistant");
  const text = made ? `Started ${made} result${made === 1 ? "" : "s"}` : said?.role === "assistant" ? said.text.replace(/\s+/g, " ").slice(0, 140) : "Finished";
  return { status: "done", text };
}

function toView(r: Row): ScheduleView {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    attachments: JSON.parse(r.attachments_json) as string[],
    projectId: r.project_id,
    rule: JSON.parse(r.rule_json) as ScheduleRule,
    tz: r.tz,
    approval: r.approval,
    capUsd: r.cap_usd,
    engine: r.engine,
    mode: r.mode_json ? (JSON.parse(r.mode_json) as ScheduleView["mode"]) : null,
    paused: !!r.paused,
    nextRunAt: r.paused ? null : r.next_run_at,
    lastRunAt: r.last_run_at,
    last: resultOf(r),
    runs: r.runs,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Tasks, soonest first (paused ones last). `project`: one project's; null: those outside projects. */
export function listSchedules(f: { project?: string | null } = {}): ScheduleView[] {
  const where = f.project === null ? "WHERE project_id IS NULL" : f.project ? "WHERE project_id = ?" : "";
  const rows = db()
    .prepare(`SELECT * FROM assist_schedules ${where} ORDER BY paused, next_run_at IS NULL, next_run_at, created_at DESC LIMIT 200`)
    .all(...(f.project ? [f.project] : [])) as Row[];
  return rows.map(toView);
}

export function getSchedule(id: string): ScheduleView | null {
  const r = getRow(id);
  return r ? toView(r) : null;
}

function checked(input: ScheduleInput, prev: Row | undefined, now: number): Omit<Row, "id" | "last_run_at" | "last_thread_id" | "last_status" | "last_text" | "runs" | "created_at"> {
  if (!validTimeZone(input.tz)) throw new ScheduleError("Pick a time zone");
  if (input.projectId && !getProject(input.projectId)) throw new ScheduleError("That project doesn't exist anymore", 404);
  const before = prev ? (JSON.parse(prev.rule_json) as ScheduleRule) : null;
  // "Every N hours" counts from when it was set up; an unchanged one keeps counting from then.
  const rule: ScheduleRule =
    input.rule.kind === "hours"
      ? { kind: "hours", every: input.rule.every, from: before?.kind === "hours" && before.every === input.rule.every ? before.from : (input.rule.from ?? now) }
      : (input.rule as ScheduleRule);
  const bad = ruleError(rule);
  if (bad) throw new ScheduleError(bad);
  const paused = input.paused ?? !!prev?.paused;
  const next = nextRun(rule, input.tz, now);
  if (next === null && !paused) throw new ScheduleError(rule.kind === "once" ? "That time has passed — pick a later one" : "This schedule never runs");
  const cap = input.approval === "auto" ? (input.capUsd ?? DEFAULT_SCHEDULE_CAP_USD) : null;
  return {
    title: input.title.trim().slice(0, 80) || threadTitle(input.prompt),
    prompt: input.prompt.trim(),
    attachments_json: JSON.stringify(input.attachments ?? []),
    project_id: input.projectId ?? null,
    rule_json: JSON.stringify(rule),
    tz: input.tz,
    approval: input.approval,
    cap_usd: cap === null ? null : Math.round(cap * 100) / 100,
    engine: input.engine,
    mode_json: input.mode ? JSON.stringify(input.mode) : null,
    paused: paused ? 1 : 0,
    next_run_at: next,
    updated_at: now,
  };
}

export function createSchedule(input: ScheduleInput, now = Date.now()): ScheduleView {
  const row: Row = { id: nanoid(10), ...checked(input, undefined, now), last_run_at: null, last_thread_id: null, last_status: null, last_text: null, runs: 0, created_at: now };
  db()
    .prepare(
      `INSERT INTO assist_schedules (id, title, prompt, attachments_json, project_id, rule_json, tz, approval, cap_usd, engine, mode_json, paused, next_run_at,
         last_run_at, last_thread_id, last_status, last_text, runs, created_at, updated_at)
       VALUES (@id, @title, @prompt, @attachments_json, @project_id, @rule_json, @tz, @approval, @cap_usd, @engine, @mode_json, @paused, @next_run_at,
         @last_run_at, @last_thread_id, @last_status, @last_text, @runs, @created_at, @updated_at)`,
    )
    .run(row);
  ensureScheduleRunner();
  return toView(row);
}

/** Edit any part; pausing keeps the task, resuming picks the next time from now. */
export function updateSchedule(id: string, patch: Partial<ScheduleInput>, now = Date.now()): ScheduleView | null {
  const r = getRow(id);
  if (!r) return null;
  const current = toView(r);
  const merged: ScheduleInput = {
    title: patch.title ?? current.title,
    prompt: patch.prompt ?? current.prompt,
    attachments: patch.attachments ?? current.attachments,
    projectId: patch.projectId !== undefined ? patch.projectId : current.projectId,
    rule: patch.rule ?? current.rule,
    tz: patch.tz ?? current.tz,
    approval: patch.approval ?? current.approval,
    capUsd: patch.capUsd !== undefined ? patch.capUsd : current.capUsd,
    engine: patch.engine ?? current.engine,
    mode: patch.mode !== undefined ? patch.mode : (current.mode as AssistModeChoice | null),
    paused: patch.paused ?? current.paused,
  };
  const next = { ...r, ...checked(merged, r, now) };
  db()
    .prepare(
      `UPDATE assist_schedules SET title = @title, prompt = @prompt, attachments_json = @attachments_json, project_id = @project_id, rule_json = @rule_json,
         tz = @tz, approval = @approval, cap_usd = @cap_usd, engine = @engine, mode_json = @mode_json, paused = @paused, next_run_at = @next_run_at,
         updated_at = @updated_at WHERE id = @id`,
    )
    .run(next);
  return toView(next);
}

/** Delete the task; the chats its runs made stay. */
export function deleteSchedule(id: string): boolean {
  return db().prepare("DELETE FROM assist_schedules WHERE id = ?").run(id).changes > 0;
}

function record(id: string, fields: Partial<Pick<Row, "last_run_at" | "last_thread_id" | "last_status" | "last_text" | "paused">> & { addRun?: boolean }): void {
  const { addRun, ...set } = fields;
  const cols = Object.keys(set).map((k) => `${k} = @${k}`);
  if (addRun) cols.push("runs = runs + 1");
  db()
    .prepare(`UPDATE assist_schedules SET ${cols.join(", ")} WHERE id = @id`)
    .run({ id, ...set });
}

/**
 * Start one run of a task: a new chat with the task's prompt, in its project, on its engine and mode,
 * asking first or auto-running within its cap. Resolves once the chat exists (`threadId`); `done`
 * settles when the agent stops (a finished reply, or a plan waiting for approval).
 */
export async function startSchedule(id: string, o: { now?: number; model?: ModelCall } = {}): Promise<{ threadId: string | null; done: Promise<void> }> {
  const now = o.now ?? Date.now();
  const r = getRow(id);
  if (!r) throw new ScheduleError("No such scheduled task", 404);
  const idle = { threadId: null, done: Promise.resolve() };
  const prev = r.last_thread_id ? getThread(r.last_thread_id) : null;
  if (prev?.thread.status === "running") {
    record(id, { last_status: "skipped", last_text: `Skipped at ${formatWhen(now, r.tz)}: the run before was still going` });
    return idle;
  }
  if (r.project_id && !getProject(r.project_id)) {
    record(id, { last_run_at: now, last_status: "failed", last_text: "Its project was deleted — edit the task to pick another", paused: 1 });
    return idle;
  }
  const rule = JSON.parse(r.rule_json) as ScheduleRule;
  const mode = r.mode_json ? (JSON.parse(r.mode_json) as AssistModeChoice) : undefined;
  const m = await resolveMode(mode);
  const cap = r.approval === "auto" ? (r.cap_usd ?? DEFAULT_SCHEDULE_CAP_USD) : null;
  const how = cap === null ? "plans wait for your approval" : cap === 0 ? "only free plans run on their own" : `plans up to ${formatCost(cap)} run on their own`;
  let threadId: string;
  try {
    const t = createThread({
      engine: r.engine,
      agent: m.agent,
      autoApprove: r.approval === "auto",
      title: `${r.title} · ${formatWhen(now, r.tz)}`,
      projectId: r.project_id,
      mode: m.mode,
      model: m.model,
      effort: m.effort,
      scheduleId: r.id,
      capUsd: cap,
      note: `Scheduled run of “${r.title}” · ${describeRule(rule)} · ${how}.${m.note ? ` ${m.note}` : ""}`,
    });
    threadId = t.id;
    addMessage(t.id, r.prompt, JSON.parse(r.attachments_json) as string[]);
  } catch (e) {
    record(id, { last_run_at: now, last_status: "failed", last_text: (e as Error).message, addRun: true });
    return idle;
  }
  record(id, { last_run_at: now, last_thread_id: threadId, last_status: "running", last_text: "Working…", addRun: true });
  const done = run(threadId, o.model)
    .catch((e: Error) => console.warn(`[fuobe] scheduled task ${id} failed: ${e.message}`))
    .finally(() => {
      const view = getThread(threadId);
      if (!view) return;
      const s = summarize(view.thread.status, view.thread.items);
      record(id, { last_status: s.status, last_text: s.text });
    });
  return { threadId, done };
}

/**
 * Start every task that is due at `now`. Each task's next time is claimed first (a compare-and-set
 * on next_run_at), so two sweeps never start the same run. Resolves when the started runs settle.
 */
export async function sweepSchedules(now = Date.now(), o: { model?: ModelCall } = {}): Promise<string[]> {
  const due = db().prepare("SELECT * FROM assist_schedules WHERE paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?").all(now, PER_SWEEP) as Row[];
  const started: string[] = [];
  const runs: Promise<void>[] = [];
  for (const r of due) {
    const next = nextRun(JSON.parse(r.rule_json) as ScheduleRule, r.tz, now);
    const claimed = db().prepare("UPDATE assist_schedules SET next_run_at = ? WHERE id = ? AND next_run_at = ? AND paused = 0").run(next, r.id, r.next_run_at).changes;
    if (!claimed) continue;
    const begun = await startSchedule(r.id, { now, model: o.model }).catch((e: Error) => {
      record(r.id, { last_run_at: now, last_status: "failed", last_text: e.message });
      return null;
    });
    if (begun?.threadId) started.push(begun.threadId);
    if (begun) runs.push(begun.done);
  }
  await Promise.all(runs);
  return started;
}

declare global {
  var __fuobeScheduleRunner: { tick: () => void; timer: NodeJS.Timeout } | undefined;
}

const tick = () => void sweepSchedules().catch((e: Error) => console.warn(`[fuobe] schedule sweep failed: ${e.message}`));

/** Start the 30 s sweep (once per process: at boot, and when a task is created). */
export function ensureScheduleRunner(): void {
  const cur = globalThis.__fuobeScheduleRunner;
  if (cur) {
    // After a dev hot reload, point the timer at this module's code.
    cur.tick = tick;
    return;
  }
  const state = { tick, timer: setInterval(() => globalThis.__fuobeScheduleRunner?.tick(), SWEEP_MS) };
  state.timer.unref?.();
  globalThis.__fuobeScheduleRunner = state;
}
