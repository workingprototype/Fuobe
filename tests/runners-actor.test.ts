/**
 * Runners carry an actor (docs/research/accounts-8.md §7.11): background work runs as the person who started the
 * row (runAs(row owner), via "runner"), never as whoever's request happened to start a timer, and a row whose owner
 * was turned off fails with "Paused: the account that started this is off." Timers themselves belong to the server
 * (asSystem).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-runners-actor-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

// No real sweeps in this process: each test drives the runner's ticks itself.
const stubTimer = setInterval(() => {}, 60_000);
clearInterval(stubTimer);
globalThis.__fuobeScheduleRunner = { tick: () => {}, timer: stubTimer };

const { db } = await import("@/server/db");
const gens = await import("@/server/generations");
const { PROVIDERS } = await import("@/server/providers");
const perms = await import("@/server/access/permissions");
const { maybeActor, currentActor, runAs, asSystem, SYSTEM } = await import("@/server/access/actor");
const sched = await import("@/server/assist/schedules");
const agent = await import("@/server/assist/agent");
const { setSetting } = await import("@/server/settings");
const { seedPerson, updatePerson, actor } = await import("./helpers/actors");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

afterEach(() => {
  updatePerson("u_owner", { status: "active", dormant: false });
  vi.restoreAllMocks();
});

const who = () => {
  const a = maybeActor();
  return a && { userId: a.userId, via: a.via };
};

let rows = 0;
function storedRow(r: { status: string; externalId?: string; dependsOn?: string; outputs?: object[] }): string {
  const id = `row-${++rows}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, depends_on, created_at, updated_at)
       VALUES (?, 'image', 'nano-banana-pro', 'cloud', 'mock', 'generate', 'image', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, r.status, JSON.stringify({ modelId: "nano-banana-pro", prompt: "a lighthouse" }), JSON.stringify(r.outputs ?? []), r.externalId ?? null, r.dependsOn ?? null, now, now);
  return id;
}

describe("acting for a row's owner", () => {
  it("reads the owner from created_by once rows have it, else the install owner", () => {
    expect(perms.rowOwner({})).toBe("u_owner");
    expect(perms.rowOwner({ created_by: null })).toBe("u_owner");
    expect(perms.rowOwner({ created_by: "u_alex" })).toBe("u_alex");
  });

  it("acts as that person, via the runner", () => {
    const alex = seedPerson({ role: "admin" });
    expect(perms.ownerActor(alex)).toEqual({ userId: alex, role: "admin", via: "runner", scopes: ["full"] });
    expect(perms.runAsOwner(alex, () => currentActor().userId)).toBe(alex);
    expect(perms.runAsOwner(null, () => who())).toEqual({ userId: "u_owner", via: "runner" });
  });

  it("refuses for a person who is pending, off, deleted, dormant or unknown", () => {
    for (const p of [{ status: "pending" as const }, { status: "disabled" as const }, { status: "deleted" as const }, { dormant: true }]) {
      const id = seedPerson(p);
      expect(() => perms.ownerActor(id)).toThrow(perms.AccountOffError);
    }
    expect(() => perms.ownerActor("u_nobody")).toThrow("Paused: the account that started this is off.");
  });
});

describe("the generations runner", () => {
  async function tickUntil(done: () => boolean) {
    gens.ensureRunner();
    for (let i = 0; i < 50 && !done(); i++) {
      await globalThis.__fuobeRunner!.tick();
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it("polls a running job as the person who started it, whoever's request started the runner", async () => {
    const seen: unknown[] = [];
    vi.spyOn(PROVIDERS.mock, "poll").mockImplementation(async () => {
      seen.push(who());
      return { state: "running", progress: 0.5 };
    });
    const id = storedRow({ status: "running", externalId: "mock-1" });
    // A member's request is what first starts the runner; the timers it sets up still belong to the server.
    runAs(actor(seedPerson(), "member"), () => gens.ensureRunner());
    await asSystem(() => tickUntil(() => seen.length > 0));
    expect(seen[0]).toEqual({ userId: "u_owner", via: "runner" });
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(id);
  });

  it("fails a running job whose owner was turned off, with the words the plan gives", async () => {
    vi.spyOn(PROVIDERS.mock, "poll").mockResolvedValue({ state: "running" });
    const id = storedRow({ status: "running", externalId: "mock-2" });
    updatePerson("u_owner", { status: "disabled" });
    await tickUntil(() => gens.getGeneration(id)?.status === "failed");
    expect(gens.getGeneration(id)).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
  });

  it("fails a waiting step of a chain whose owner went dormant, and plans the next one as the owner", async () => {
    const parent = storedRow({ status: "succeeded", outputs: [{ url: "/api/files/x.png", kind: "image" }] });
    const child = storedRow({ status: "queued", dependsOn: parent });
    updatePerson("u_owner", { dormant: true });
    await tickUntil(() => gens.getGeneration(child)?.status === "failed");
    expect(gens.getGeneration(child)).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
  });
});

describe("Assist", () => {
  type Block = Anthropic.Beta.BetaContentBlock;
  const done = (seen: unknown[]): import("@/server/assist/agent").ModelCall =>
    async () => {
      seen.push(who());
      return { content: [{ type: "text", text: "Done.", citations: null } as Block], stop_reason: "end_turn", stop_details: null } as unknown as Anthropic.Beta.BetaMessage;
    };

  it("carries a chat on as its author, whoever's request or schedule carried it", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    const t = agent.createThread({ engine: "cloud", agent: "claude", title: "Ad" });
    agent.addMessage(t.id, "Make an ad");
    const seen: unknown[] = [];
    await runAs(SYSTEM, () => agent.run(t.id, done(seen)));
    expect(seen[0]).toEqual({ userId: "u_owner", via: "runner" });
  });

  it("ends a chat whose author was turned off with the plan's words, and leaves it idle", async () => {
    const t = agent.createThread({ engine: "cloud", agent: "claude", title: "Off" });
    agent.addMessage(t.id, "Make an ad");
    updatePerson("u_owner", { status: "disabled" });
    const seen: unknown[] = [];
    await agent.run(t.id, done(seen));
    expect(seen).toEqual([]);
    const { thread } = agent.getThread(t.id)!;
    expect(thread.status).toBe("idle");
    expect(thread.items.at(-1)).toMatchObject({ role: "notice", tone: "error", text: "Paused: the account that started this is off." });
  });

  it("runs a scheduled task as the person who owns it, from the server's sweep", async () => {
    const T = (s: string) => Date.parse(s);
    const s = sched.createSchedule(
      { title: "Daily ad", prompt: "Make today's ad", tz: "UTC", engine: "cloud", approval: "ask", rule: { kind: "daily", time: "09:00" } },
      T("2026-10-27T08:00:00Z"),
    );
    const seen: unknown[] = [];
    const started = await asSystem(() => sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: done(seen) }));
    expect(started).toHaveLength(1);
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual({ userId: "u_owner", via: "runner" });
    sched.deleteSchedule(s.id);
  });

  it("records a failed run when the task's owner is off, and starts no chat", async () => {
    const T = (s: string) => Date.parse(s);
    const s = sched.createSchedule(
      { title: "Weekly", prompt: "Make the weekly ad", tz: "UTC", engine: "cloud", approval: "ask", rule: { kind: "daily", time: "10:00" } },
      T("2026-10-28T08:00:00Z"),
    );
    updatePerson("u_owner", { status: "disabled" });
    const seen: unknown[] = [];
    expect(await asSystem(() => sched.sweepSchedules(T("2026-10-28T10:00:30Z"), { model: done(seen) }))).toEqual([]);
    expect(seen).toEqual([]);
    expect(sched.getSchedule(s.id)?.last).toMatchObject({ status: "failed", text: "Paused: the account that started this is off." });
  });
});
