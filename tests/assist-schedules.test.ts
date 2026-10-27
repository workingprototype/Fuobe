import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-sched-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const sched = await import("@/server/assist/schedules");
const projects = await import("@/server/assist/projects");
const { db } = await import("@/server/db");
const { spendOf } = await import("@/lib/assist-schedule");
const listRoute = await import("@/app/api/assist/schedules/route");
const oneRoute = await import("@/app/api/assist/schedules/[scheduleId]/route");

type Block = Anthropic.Beta.BetaContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const generateCall = (id: string, input: unknown) => ({ type: "tool_use", id, name: "generate", input }) as unknown as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Anthropic.Beta.BetaMessage;
const job = (prompt: string) => ({ summary: prompt, jobs: [{ model_id: "nano-banana-pro", prompt }] });

/** A model that makes one generate call per turn listed, then says it's done; it records what it saw. */
function scripted(...prompts: string[]) {
  const seen: { system: string }[] = [];
  let n = 0;
  const call: import("@/server/assist/agent").ModelCall = async ({ system }) => {
    seen.push({ system: system.turn });
    const p = prompts[n++];
    return p ? reply([text("On it."), generateCall(`toolu_${n}`, job(p))], "tool_use") : reply([text("Done — your ad is rendering.")], "end_turn");
  };
  return { call, seen };
}

const T = (s: string) => Date.parse(s);
const base = { prompt: "Make today's perfume ad", tz: "UTC", engine: "cloud" as const, approval: "ask" as const };
const threadOf = (id: string) => agent.getThread(id)!.thread;

beforeAll(() => setSetting("demoMode", "auto"));
afterEach(() => {
  setSetting("falKey", "");
  db().prepare("DELETE FROM assist_schedules").run();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scheduled tasks", () => {
  it("are checked when saved: the zone, a time that has passed, the project", () => {
    const now = T("2026-10-27T08:00:00Z");
    expect(() => sched.createSchedule({ ...base, title: "x", tz: "Mars/Base", rule: { kind: "daily", time: "09:00" } }, now)).toThrow("Pick a time zone");
    expect(() => sched.createSchedule({ ...base, title: "x", rule: { kind: "once", at: "2026-10-26T09:00" } }, now)).toThrow(/passed/);
    expect(() => sched.createSchedule({ ...base, title: "x", projectId: "nope", rule: { kind: "daily", time: "09:00" } }, now)).toThrow(/project/);
    const s = sched.createSchedule({ ...base, title: "Every 6h", rule: { kind: "hours", every: 6 } }, now);
    expect(s.rule).toEqual({ kind: "hours", every: 6, from: now });
    expect(s.nextRunAt).toBe(now + 6 * 3_600_000);
    // Ask first has no cap; auto gets the default unless one is given.
    expect(s.capUsd).toBeNull();
    expect(sched.createSchedule({ ...base, title: "auto", approval: "auto", rule: { kind: "daily", time: "09:00" } }, now).capUsd).toBe(2);
    // Pausing hides the next run; resuming picks it from now; an unchanged "every N hours" keeps counting from its start.
    const paused = sched.updateSchedule(s.id, { paused: true }, now + 1000)!;
    expect(paused).toMatchObject({ paused: true, nextRunAt: null });
    const resumed = sched.updateSchedule(s.id, { paused: false }, now + 7 * 3_600_000)!;
    expect(resumed.nextRunAt).toBe(now + 12 * 3_600_000);
    expect(sched.updateSchedule(s.id, { rule: { kind: "hours", every: 2 } }, now + 7 * 3_600_000)!.nextRunAt).toBe(now + 9 * 3_600_000);
  });

  it("the routes validate the body and say what's wrong", async () => {
    const bad = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...base, title: "x", rule: { kind: "daily", time: "9am" } }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Pick a time");
    const ok = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...base, title: "Daily", rule: { kind: "weekly", days: [1, 3], time: "09:00" } }) }));
    expect(ok.status).toBe(201);
    const created = await ok.json();
    expect((await (await listRoute.GET(new Request("http://x/api/assist/schedules?project=none"))).json()).items).toHaveLength(1);
    const ctx = { params: Promise.resolve({ scheduleId: created.id }) };
    expect(await (await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ paused: true }) }), ctx)).json()).toMatchObject({ paused: true });
    expect((await oneRoute.DELETE(new Request("http://x"), ctx)).status).toBe(204);
    expect((await oneRoute.GET(new Request("http://x"), ctx)).status).toBe(404);
  });
});

describe("the sweep (fake clock)", () => {
  it("starts what's due, once, as a new chat — and moves the task to its next time", async () => {
    const s = sched.createSchedule({ ...base, title: "Perfume ad", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(s.nextRunAt).toBe(T("2026-10-27T09:00:00Z"));
    const m = scripted("A perfume ad");
    expect(await sched.sweepSchedules(T("2026-10-27T08:59:59Z"), { model: m.call })).toEqual([]);
    // Two sweeps at once (a hot reload's second timer): one run.
    const [a, b] = await Promise.all([sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: m.call }), sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: m.call })]);
    expect([...a, ...b]).toHaveLength(1);
    const view = sched.getSchedule(s.id)!;
    expect(view).toMatchObject({ runs: 1, lastRunAt: T("2026-10-27T09:00:30Z"), nextRunAt: T("2026-10-28T09:00:00Z") });
    const t = threadOf([...a, ...b][0]);
    expect(t).toMatchObject({ title: "Perfume ad · Tue 27 Oct, 09:00", scheduleId: s.id, autoApprove: false });
    expect(t.items[0]).toMatchObject({ role: "notice", text: expect.stringMatching(/^Scheduled run of “Perfume ad” · Every day at 09:00 · plans wait for your approval/) });
    expect(t.items[1]).toMatchObject({ role: "user", text: "Make today's perfume ad" });
    // The model was told nobody is watching.
    expect(m.seen[0].system).toMatch(/scheduled run of the task “Perfume ad” \(Every day at 09:00, UTC/);
    expect(m.seen[0].system).toMatch(/don't ask questions/);
  });

  it("a run the server missed while it was off happens once, then the next time is from now", async () => {
    const s = sched.createSchedule({ ...base, title: "Missed", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const started = await sched.sweepSchedules(T("2026-10-30T12:00:00Z"), { model: scripted().call });
    expect(started).toHaveLength(1);
    expect(sched.getSchedule(s.id)).toMatchObject({ runs: 1, nextRunAt: T("2026-10-31T09:00:00Z") });
    expect(await sched.sweepSchedules(T("2026-10-30T12:00:01Z"), { model: scripted().call })).toEqual([]);
  });

  it("a one-off runs once, then has no next time; paused tasks don't run", async () => {
    const once = sched.createSchedule({ ...base, title: "Once", rule: { kind: "once", at: "2026-10-27T10:00" } }, T("2026-10-27T08:00:00Z"));
    const paused = sched.createSchedule({ ...base, title: "Paused", paused: true, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(await sched.sweepSchedules(T("2026-10-27T10:00:00Z"), { model: scripted().call })).toHaveLength(1);
    expect(sched.getSchedule(once.id)).toMatchObject({ runs: 1, nextRunAt: null, last: { status: "done", text: "Done — your ad is rendering." } });
    expect(sched.getSchedule(paused.id)).toMatchObject({ runs: 0, paused: true });
    expect(await sched.sweepSchedules(T("2026-10-29T10:00:00Z"), { model: scripted().call })).toEqual([]);
  });

  it("skips a run while the one before is still going", async () => {
    const s = sched.createSchedule({ ...base, title: "Slow", rule: { kind: "hours", every: 1 } }, T("2026-10-27T08:00:00Z"));
    let release!: () => void;
    const slow: import("@/server/assist/agent").ModelCall = () => new Promise((r) => (release = () => r(reply([text("Finally.")], "end_turn"))));
    const first = sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: slow });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await sched.sweepSchedules(T("2026-10-27T10:00:00Z"), { model: scripted().call })).toEqual([]);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "skipped", text: expect.stringMatching(/the run before was still going/) });
    release();
    await first;
    expect(sched.getSchedule(s.id)).toMatchObject({ runs: 1, last: { status: "done", text: "Finally." } });
  });

  it("a task whose project was deleted pauses and says why", async () => {
    const p = projects.createProject({ name: "Launch" });
    const s = sched.createSchedule({ ...base, title: "In a project", projectId: p.id, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    // Runs inside the project.
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted().call });
    expect(threadOf(id).projectId).toBe(p.id);
    projects.deleteProject(p.id);
    expect(sched.getSchedule(s.id)).toMatchObject({ projectId: null, paused: true, nextRunAt: null });
    expect(await sched.sweepSchedules(T("2026-10-28T09:00:00Z"), { model: scripted().call })).toEqual([]);
  });
});

describe("approval and the cost cap", () => {
  it("ask first: the plan waits as an approval card, and nothing runs", async () => {
    const s = sched.createSchedule({ ...base, title: "Ask", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted("A perfume ad").call });
    const t = threadOf(id);
    expect(t.status).toBe("waiting");
    expect(t.items.filter((i) => i.role === "approval")).toHaveLength(1);
    expect(t.items.some((i) => i.role === "generations")).toBe(false);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ threadId: id, status: "waiting", text: expect.stringMatching(/^A plan waits for your approval/) });
    // Approving it later shows in the task's last result.
    await agent.answerApproval(id, true);
    await agent.run(id, scripted().call);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "done", text: "Started 1 result" });
  });

  it("auto-run: a plan within the cap starts on its own (demo runs cost nothing)", async () => {
    const s = sched.createSchedule({ ...base, title: "Auto", approval: "auto", capUsd: 0, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted("A perfume ad").call });
    const t = threadOf(id);
    expect(t).toMatchObject({ status: "idle", autoApprove: true, capUsd: 0, spentUsd: 0 });
    expect(t.items.some((i) => i.role === "approval")).toBe(false);
    expect(t.items.filter((i) => i.role === "generations")).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ text: expect.stringMatching(/only free plans run on their own/) });
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "done" });
  });

  it("auto-run: what fits runs and counts against the cap; the plan that would pass it waits, with the reason", async () => {
    setSetting("falKey", "fal-test-key");
    const realFetch = globalThis.fetch;
    // The paid job that fits is queued for fal; no request may leave this test.
    globalThis.fetch = (async () => new Response("offline", { status: 503 })) as typeof fetch;
    try {
      const price = spendOf(tools.planFor("generate", job("x"), { engine: "cloud" }).jobs)!;
      expect(price).toBeGreaterThan(0);
      const cap = Math.round(price * 1.5 * 100) / 100;
      const s = sched.createSchedule({ ...base, title: "Capped", approval: "auto", capUsd: cap, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
      const m = scripted("First ad", "Second ad");
      const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: m.call });
      const t = threadOf(id);
      expect(m.seen[0].system).toMatch(new RegExp(`Auto-run is on up to \\$${cap.toFixed(2)}`));
      expect(t).toMatchObject({ status: "waiting", spentUsd: price, capUsd: cap });
      expect(t.items.filter((i) => i.role === "generations")).toHaveLength(1);
      const card = t.items.find((i) => i.role === "approval");
      expect(card).toMatchObject({ status: "pending", summary: "Second ad" });
      const left = (cap - price).toFixed(2);
      expect(t.items.at(-1)).toMatchObject({ role: "notice", text: `Waiting for you: it costs about $${price.toFixed(2)} and this run has $${left} left of its $${cap.toFixed(2)} cap. Auto-run only starts what fits the cap.` });
      expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "waiting" });
    } finally {
      globalThis.fetch = realFetch;
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    }
  });

  it("an ordinary chat with auto-run on has no cap", async () => {
    setSetting("falKey", "fal-test-key");
    const t = agent.createThread({ engine: "cloud", agent: "offline", autoApprove: true });
    expect(threadOf(t.id).capUsd).toBeUndefined();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("offline", { status: 503 })) as typeof fetch;
    try {
      agent.addMessage(t.id, "go");
      await agent.run(t.id, scripted("One", "Two").call);
      expect(threadOf(t.id).items.filter((i) => i.role === "generations")).toHaveLength(2);
      expect(threadOf(t.id).items.some((i) => i.role === "approval")).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    }
  });
});
