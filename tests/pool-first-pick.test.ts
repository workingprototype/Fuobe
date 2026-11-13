import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * First pick (docs/gpu-workers.md, "Who picks first"): a worker with a higher pick order gets a job before the others
 * while it is free and can run it. Any other worker leaves that job for it, and takes its own next best job, only while
 * the preferred worker is free now (heard from, paused in neither place, not draining, inside its hours, holding no job
 * and nothing holding it back) and the job has been there for it for less than the grace. Pick order 0 everywhere, or a
 * grace of 0, is the line as before.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-pool-first-pick-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const qs = await import("@/server/queue-settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { loadIndex } = await import("@/server/gpu/index-file");
const workersRoute = await import("@/app/api/admin/workers/[id]/route");
const auth = await import("@/server/auth");

const KREA = "krea2-turbo-t2i";
const FILES = loadIndex().workflows[KREA].files;
const GB = 2 ** 30;
const VERSION = "e".repeat(64);
const GRAPH = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui", `${KREA}.json`), "utf8"));
let clock = Date.UTC(2026, 10, 4, 3, 0, 0);

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;

function beat(w: W, local: { paused: boolean; why: string | null } = { paused: false, why: null }, more: Record<string, unknown> = {}) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 5, version: "1.0.0", local: { ...local, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: VERSION, ...more }),
    clock,
  );
}

/** A worker on, all day, allowed Krea 2's lane, with its files and 24 GB of VRAM, and this pick order. */
function worker(name: string, pickOrder = 0, o: { vram?: number; files?: readonly string[]; delayMs?: number } = {}): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [pool.poolLane(KREA)]: { delayMs: o.delayMs ?? 0 } }, claimAfterMs: 0, pickOrder });
  beat(w);
  const files = (o.files ?? FILES).map((k) => {
    const f = loadIndex().files[k as keyof ReturnType<typeof loadIndex>["files"]];
    return { folder: f.folder, name: f.file, size: f.sizeBytes, sha256: "a".repeat(64) };
  });
  pool.saveInventory(row(w), { files, nodePacks: [], media: ["image"] });
  db().prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ? WHERE id = ?").run(JSON.stringify({ vramBytes: (o.vram ?? 24) * GB }), VERSION, w.id);
  beat(w);
  return w;
}

let gens = 0;
function generation() {
  const gid = `gen-fp-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  return gid;
}

/** A task made `ago` ms before the test's clock. */
function placed(id: string, ago = 0) {
  db().prepare("UPDATE relay_tasks SET created_at = ?, rank_at = ? WHERE id = ?").run(clock - ago, clock - ago, id);
  return id;
}

/** The owner's own Krea 2 job. */
const ownerJob = (ago = 0) => placed(tasks.createTask({ principal: "owner", generationId: generation(), graph: GRAPH, workflowId: KREA, pool: pool.poolFields(KREA, {}, clock) }).id, ago);

/** An account's Krea 2 run: a job ticket for this catalog. */
const accountJob = () =>
  placed(
    tasks.createTask({
      principal: "acct:a1",
      generationId: generation(),
      graph: {},
      ticket: { v: 1, workflowId: KREA, catalogVersion: VERSION, op: "t2i", settings: { prompt: "a portrait", seed: 1, numOutputs: 1 }, inputs: [], outputs: { count: 1, kind: "image" }, size: { megapixels: 1, seconds: 0, outputs: 1 } },
      workflowId: KREA,
      pool: pool.poolFields(KREA, { account: "a1", catalogVersion: VERSION }, clock),
    }).id,
  );

const claim = (w: W) => pool.workerClaim(row(w), [], clock);

/** No worker, and nothing in line or running. */
function clear() {
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
}

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * 60_000;
  qs.saveQueueSettings(qs.QUEUE_DEFAULTS);
  clear();
});

describe("who gets first pick (firstPickOf)", () => {
  const now = 100_000;
  const picker = (id: string, pickOrder: number, taskId: string | null, since = now - 1000) => ({ id, pickOrder, next: taskId ? { taskId, since } : null });

  it("a worker with a higher pick order whose next job it is, inside the grace", () => {
    expect(pool.firstPickOf("j", 0, [picker("x", 1, "j")], now, 20_000)).toBe("x");
    // The highest pick order wins.
    expect(pool.firstPickOf("j", 0, [picker("x", 1, "j"), picker("y", 5, "j")], now, 20_000)).toBe("y");
  });

  it("nobody: another next job, no higher pick order, past the grace, or a grace of 0", () => {
    expect(pool.firstPickOf("j", 0, [picker("x", 1, "k")], now, 20_000)).toBeNull();
    expect(pool.firstPickOf("j", 0, [picker("x", 1, null)], now, 20_000)).toBeNull();
    expect(pool.firstPickOf("j", 1, [picker("x", 1, "j")], now, 20_000)).toBeNull();
    expect(pool.firstPickOf("j", 0, [picker("x", 1, "j", now - 20_000)], now, 20_000)).toBeNull();
    expect(pool.firstPickOf("j", 0, [picker("x", 1, "j")], now, 0)).toBeNull();
  });
});

describe("a worker that picks first", () => {
  it("free and able: the other worker leaves the job for it, and it takes it", () => {
    const id = ownerJob();
    const fast = worker("fast");
    const slow = worker("slow", 1);
    expect(claim(fast)).toBeNull();
    expect(row(fast).asked_words).toBe("Asked for work: 1 waiting, 1 left for a worker that picks first");
    expect(claim(slow)?.id).toBe(id);
  });

  it("the other worker takes its own next best job at once", () => {
    const first = ownerJob(2000);
    const second = ownerJob(1000);
    const fast = worker("fast");
    const slow = worker("slow", 1);
    expect(claim(fast)?.id).toBe(second);
    expect(claim(slow)?.id).toBe(first);
  });

  it("busy: the other worker takes the job at once", () => {
    ownerJob(1000);
    const next = ownerJob();
    const fast = worker("fast");
    const slow = worker("slow", 1);
    expect(claim(slow)).not.toBeNull();
    expect(claim(fast)?.id).toBe(next);
  });

  it("paused on the website or on its PC, draining, silent or outside its hours: the other worker takes it at once", () => {
    const away: [string, (w: W) => void][] = [
      ["paused on the website", (w) => pool.patchWorker(w.id, { paused: true })],
      ["paused on its PC", (w) => beat(w, { paused: true, why: "here" })],
      ["draining", (w) => pool.patchWorker(w.id, { drain: true })],
      ["silent", (w) => db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(clock - 31_000, w.id)],
      ["outside its hours", (w) => pool.patchWorker(w.id, { hours: null })],
      ["held back on its PC", (w) => beat(w, undefined, { holding: { why: "starting-comfy", since: clock } })],
    ];
    for (const [why, make] of away) {
      clear();
      const id = ownerJob();
      const fast = worker("fast");
      make(worker("slow", 1));
      expect(claim(fast)?.id, why).toBe(id);
    }
  });

  it("can't run the job (its files, its memory, its lane, its lane's delay): the other worker takes it at once", () => {
    const cant: [string, () => W][] = [
      ["missing a file", () => worker("slow", 1, { files: FILES.slice(1) })],
      ["too little VRAM", () => worker("slow", 1, { vram: 8 })],
      ["lane not allowed", () => {
        const w = worker("slow", 1);
        pool.patchWorker(w.id, { allow: {} });
        return w;
      }],
      ["its lane's delay not over", () => worker("slow", 1, { delayMs: 60_000 })],
    ];
    for (const [why, make] of cant) {
      clear();
      const id = ownerJob();
      const fast = worker("fast");
      make();
      expect(claim(fast)?.id, why).toBe(id);
    }
  });

  it("past the grace, the other worker takes the job: nobody's job waits longer for it", () => {
    const id = ownerJob(20_000);
    const fast = worker("fast");
    worker("slow", 1);
    expect(claim(fast)?.id).toBe(id);
    // The grace is the queue's setting: 0 leaves no job for anyone.
    clear();
    qs.saveQueueSettings({ ...qs.QUEUE_DEFAULTS, firstPickGraceMs: 0 });
    const next = ownerJob();
    const again = worker("fast");
    worker("slow", 1);
    expect(claim(again)?.id).toBe(next);
  });

  it("the grace counts from when its lane's delay ended", () => {
    const id = ownerJob(65_000);
    const fast = worker("fast");
    worker("slow", 1, { delayMs: 60_000 });
    expect(claim(fast)).toBeNull();
    db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock - 80_001, id);
    expect(claim(fast)?.id).toBe(id);
  });

  it("pick order 0 everywhere (the default) is the line as before", () => {
    const id = ownerJob();
    const fast = worker("fast");
    worker("slow");
    expect(claim(fast)?.id).toBe(id);
  });

  it("a person's run left for it asks the other worker's PC for no room", () => {
    accountJob();
    const fast = worker("fast");
    const slow = worker("slow", 1);
    expect(pool.claimableNow(row(fast), clock)).toBe(0);
    pool.patchWorker(slow.id, { paused: true });
    expect(pool.claimableNow(row(fast), clock)).toBe(1);
  });

  it("the worker with the higher order is never held back by one with a lower order", () => {
    const id = ownerJob();
    worker("fast", 0);
    const slow = worker("slow", 1);
    expect(claim(slow)?.id).toBe(id);
  });
});

describe("setting the pick order", () => {
  const ownerCookie = () => `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  const patch = (id: string, body: unknown) =>
    workersRoute.PATCH(new Request(`http://localhost/api/admin/workers/${id}`, { method: "PATCH", headers: { cookie: ownerCookie(), "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    } as never);

  it("the owner sets it through the workers API; the view says it", async () => {
    const w = worker("slow");
    expect(pool.listWorkers(clock).find((v) => v.id === w.id)?.pickOrder).toBe(0);
    const res = await patch(w.id, { pickOrder: 1 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { worker: { pickOrder: number } }).worker.pickOrder).toBe(1);
    expect(row(w).pick_order).toBe(1);
  });

  it("refuses a value that isn't a whole number in range, and changes nothing", async () => {
    const w = worker("slow", 2);
    for (const pickOrder of [1.5, "1", 101, -101, null]) {
      const res = await patch(w.id, { pickOrder });
      expect(res.status, JSON.stringify(pickOrder)).toBe(400);
    }
    expect(row(w).pick_order).toBe(2);
  });
});
