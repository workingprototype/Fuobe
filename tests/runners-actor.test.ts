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
import type { EpisodeSettings } from "@/lib/catalog/faceless";
import type { SwapProject } from "@/lib/catalog/swap-studio";
import type { PollContext } from "@/server/providers/types";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-runners-actor-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

// No real sweeps in this process: each test drives the runner's ticks itself.
const stubTimer = setInterval(() => {}, 60_000);
clearInterval(stubTimer);
globalThis.__fuobeScheduleRunner = { tick: () => {}, timer: stubTimer };
globalThis.__fuobeFacelessRunner = { tick: () => {}, timer: stubTimer };
globalThis.__fuobeSwapStudioRunner = stubTimer;

const { db } = await import("@/server/db");
const gens = await import("@/server/generations");
const { PROVIDERS } = await import("@/server/providers");
const perms = await import("@/server/access/permissions");
const { maybeActor, currentActor, runAs, asSystem, SYSTEM } = await import("@/server/access/actor");
const sched = await import("@/server/assist/schedules");
const agent = await import("@/server/assist/agent");
const { setSetting } = await import("@/server/settings");
const swap = await import("@/server/swap-studio");
const faceless = await import("@/server/faceless");
const { newSegment, newShot, DEFAULT_SETTINGS } = await import("@/lib/catalog/swap-studio");
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
function storedRow(r: { status: string; externalId?: string; dependsOn?: string; outputs?: object[]; request?: object; createdAt?: number }): string {
  const id = `row-${++rows}`;
  const now = r.createdAt ?? Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, depends_on, created_at, updated_at)
       VALUES (?, 'image', 'nano-banana-pro', 'cloud', 'mock', 'generate', 'image', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, r.status, JSON.stringify({ modelId: "nano-banana-pro", prompt: "a lighthouse", ...r.request }), JSON.stringify(r.outputs ?? []), r.externalId ?? null, r.dependsOn ?? null, now, now);
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

  it("cancels the provider's job of an owner who was turned off, so it stops running and charging", async () => {
    vi.spyOn(PROVIDERS.mock, "poll").mockResolvedValue({ state: "running" });
    // The demo provider has nothing to cancel; a cloud one does.
    const cancel = vi.fn<(ctx: PollContext) => Promise<void>>(async () => {});
    PROVIDERS.mock.cancel = cancel;
    const id = storedRow({ status: "running", externalId: "mock-cancel" });
    updatePerson("u_owner", { status: "disabled" });
    try {
      await tickUntil(() => gens.getGeneration(id)?.status === "failed");
    } finally {
      delete PROVIDERS.mock.cancel;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toMatchObject({ externalId: "mock-cancel" });
    expect(gens.getGeneration(id)).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
  });

  it("drops the steps waiting only to feed a paused one, as a failed step does", async () => {
    // A per-frame join: one lane failed, the other still waits on its own input (and is only for the join).
    const t0 = Date.now() - 1000;
    const input = storedRow({ status: "queued", createdAt: t0 });
    const lane = storedRow({ status: "failed", createdAt: t0 });
    const join = storedRow({ status: "queued", createdAt: t0 + 1, dependsOn: "" });
    const waiting = storedRow({ status: "queued", createdAt: t0 + 2, dependsOn: input, request: { dropWhenUnused: true } });
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(JSON.stringify([lane, waiting]), join);
    updatePerson("u_owner", { status: "disabled" });
    await tickUntil(() => gens.getGeneration(join)?.status === "failed");
    expect(gens.getGeneration(join)).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
    expect(gens.getGeneration(waiting)).toMatchObject({ status: "canceled", error: gens.DROPPED_UNUSED });
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(input);
  });

  it("fails a waiting step of a chain whose owner went dormant, and plans the next one as the owner", async () => {
    const parent = storedRow({ status: "succeeded", outputs: [{ url: "/api/files/x.png", kind: "image" }] });
    const child = storedRow({ status: "queued", dependsOn: parent });
    updatePerson("u_owner", { dormant: true });
    await tickUntil(() => gens.getGeneration(child)?.status === "failed");
    expect(gens.getGeneration(child)).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
  });
});

describe("Faceless", () => {
  const cloud: EpisodeSettings = {
    engine: "cloud",
    length: 20,
    animation: "animated",
    aspect: "16:9",
    subtitles: true,
    music: false,
    styleId: "editorial-motion-graphics",
    styleRefs: [],
    voice: { kind: "preset", id: "Xb7hH8MSUJpSbSDYk0k2" },
    elements: [],
  };

  it("doesn't start stage two for an owner who was turned off, whoever looks: the episode fails saying why", async () => {
    setSetting("demoMode", "auto");
    setSetting("enhanceProvider", "none");
    const ep = faceless.createEpisode({ kind: "explainer", topic: "Why bridges sway", settings: cloud, autoRender: true });
    await faceless.scriptWritten(ep.id);
    const plan = () => JSON.parse((db().prepare("SELECT plan_json FROM faceless_episodes WHERE id = ?").get(ep.id) as { plan_json: string }).plan_json);
    // Stage one runs (demo jobs); nobody reads the episode and the sweep is off, so stage two waits for a look.
    gens.ensureRunner();
    await vi.waitFor(() => expect(Object.values(plan().ids as Record<string, string>).every((id) => gens.getGeneration(id)?.status === "succeeded")).toBe(true), { timeout: 60_000, interval: 200 });
    expect(plan().awaiting).toBe(true);
    updatePerson("u_owner", { status: "disabled" });
    const v = runAs(actor(seedPerson(), "admin"), () => faceless.episodeView(ep.id));
    expect(v.episode).toMatchObject({ status: "failed", error: "Paused: the account that started this is off." });
    expect(plan().awaiting).toBe(true);
  }, 90_000);
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

describe("Character Swap Studio", () => {
  /** A project whose second segment's take waits for the first segment's take (still running). */
  function waitingProject(): string {
    // The first take's job keeps running (the server's own runner polls it too).
    vi.spyOn(PROVIDERS.mock, "poll").mockResolvedValue({ state: "running" });
    const running = storedRow({ status: "running", externalId: "mock-swap" });
    const shot = { ...newShot(0, 96, DEFAULT_SETTINGS, true, () => 0.5), id: "shot-a" };
    const [a, b] = [newSegment(shot, 0, 48, 0, () => 0.1), newSegment(shot, 48, 96, 1, () => 0.2)];
    const take = (id: string, over: object) => ({ id, createdAt: 1, engine: "open", signature: "", dependencies: [], prompt: "", seed: 1, favourite: false, decision: "pending", notes: "", ...over });
    const segments = [
      { ...a, takes: [take("t1", { state: "launched", genId: running })] },
      { ...b, takes: [take("t2", { state: "waiting", waitsOn: [{ segmentId: a.id, takeId: "t1" }], dependencies: [{ segmentId: a.id, takeId: "t1", frames: 8 }] })] },
    ];
    const clip = {
      id: "clip-1",
      name: "walk",
      source: { url: "/api/files/uploads/x/walk.mp4", name: "walk.mp4", duration: 4, fps: 24, width: 1280, height: 720, hasAudio: true },
      normalized: { url: "/api/files/outputs/x/walk24.mp4", genId: "g-norm" },
      frames: 96,
      cuts: [],
      detected: null,
      cutsReviewed: true,
      shots: [{ ...shot, segments }],
      transcript: null,
      review: "pending",
      reviewNotes: "",
      assembly: null,
    };
    const id = `swap-${++rows}`;
    const doc = { id, name: "Off", engine: "open", character: { image: "/api/files/uploads/x/hero.png", description: "a woman" }, defaults: DEFAULT_SETTINGS, clips: [clip], createdAt: 0, updatedAt: 0, revision: 1 };
    db()
      .prepare("INSERT INTO swap_projects (id, name, engine, data_json, revision, waiting, created_at, updated_at) VALUES (?, 'Off', 'open', ?, 1, 1, ?, ?)")
      .run(id, JSON.stringify(doc), Date.now(), Date.now());
    return id;
  }
  const takes = (p: SwapProject) => p.clips[0].shots[0].segments!.flatMap((g) => g.takes.map((t) => ({ id: t.id, state: t.state, reason: t.reason })));
  const waitingCount = (id: string) => (db().prepare("SELECT waiting FROM swap_projects WHERE id = ?").get(id) as { waiting: number }).waiting;

  it("keeps a take waiting while its owner is on, whoever looks at the project", () => {
    const id = waitingProject();
    const viewer = actor(seedPerson(), "member");
    const p = runAs(viewer, () => swap.advanceProject(id));
    expect(takes(p).find((t) => t.id === "t2")).toMatchObject({ state: "waiting" });
    expect(waitingCount(id)).toBe(1);
  });

  it("stops the waiting takes of a project whose owner was turned off, saying why, so the sweep lets it go", () => {
    const id = waitingProject();
    updatePerson("u_owner", { status: "disabled" });
    // A teammate's look (the page's poll) launches nothing for the owner.
    const p = runAs(actor(seedPerson(), "admin"), () => swap.projectView(id)).project;
    expect(takes(p).find((t) => t.id === "t2")).toEqual({ id: "t2", state: "stopped", reason: "Paused: the account that started this is off." });
    expect(waitingCount(id)).toBe(0);
  });
});
