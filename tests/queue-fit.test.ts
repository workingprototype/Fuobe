/**
 * A waiting job's fit in the owner's queue view (GET /api/admin/queue, `queued[].fit`): which workers of its pools can
 * run it by the claim's own rules (pool.ts runFit over fitSlotWhy), why the others can't, and the state each one is in.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-queue-fit-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { liveQueue } = await import("@/server/computer/queue-live");

const LANE = "aaaaaaaaaaaa";
const MIN = 60_000;
const GB = 2 ** 30;
let clock = Date.now();

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;

function worker(name: string, o: { vramGb: number; workflows?: string[]; lanes?: string[]; pool?: string; allow?: boolean } = { vramGb: 32 }): W {
  const w = pool.addWorker(name, o.pool ?? "pool");
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: o.allow === false ? {} : { [LANE]: { delayMs: 0 } }, claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: o.lanes ?? [LANE], workflows: o.workflows ?? ["wf-a"] }), JSON.stringify({ vramBytes: o.vramGb * GB }), w.id);
  beat(w);
  return w;
}

function beat(w: W, o: { local?: { paused?: boolean; why?: string | null } } = {}) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({
      device: `wkr-${w.id}`,
      protocol: 2,
      version: "1.0.0",
      local: { paused: o.local?.paused ?? false, why: o.local?.why ?? null, until: null },
      gpu: {},
      inventoryHash: null,
      running: [],
      stopped: [],
    }),
    clock,
  );
}

let gens = 0;
function task(o: { needGb?: number; workflowId?: string; account?: string } = {}): { id: string; gid: string } {
  const gid = `fit-gen-${++gens}`;
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, message, request_json, outputs_json, created_at, updated_at) VALUES (?, 'video', 'm-test', 'open', 'comfyui', 'upscale', 'video', 'queued', NULL, ?, '[]', ?, ?)",
    )
    .run(gid, JSON.stringify(o.account ? { account: o.account } : {}), clock, clock);
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, rankAt: clock, lane: LANE, needs: { workflowId: o.workflowId ?? "wf-a", files: [], packs: [], minVramBytes: Math.round((o.needGb ?? 0) * GB * 0.97) } },
  });
  return { id: t.id, gid };
}

const fitOf = (gid: string) => liveQueue(clock).queued.find((q) => q.generationId === gid)!.fit;

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * MIN;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued','running')").run();
});

describe("a waiting job's fit", () => {
  it("names the one worker that can run it, paused here, and why the others can't", () => {
    const big = worker("Big", { vramGb: 32 });
    worker("Mid", { vramGb: 10, workflows: [] });
    worker("Small", { vramGb: 8, workflows: [] });
    beat(big, { local: { paused: true } });
    const { gid } = task({ needGb: 24, account: "acct-1" });
    expect(fitOf(gid)).toEqual({
      needGb: 24,
      workers: [
        { name: "Big", can: true, code: null, words: null, state: "paused", stateCode: "paused", stateWords: "Paused here" },
        { name: "Mid", can: false, code: "files", words: "lacks its model files", state: "idle", stateCode: "idle", stateWords: "Ready" },
        { name: "Small", can: false, code: "files", words: "lacks its model files", state: "idle", stateCode: "idle", stateWords: "Ready" },
      ],
    });
  });

  it("says a worker with the files and too little GPU memory needs more", () => {
    worker("Mid", { vramGb: 10 });
    const { gid } = task({ needGb: 24 });
    expect(fitOf(gid).workers).toEqual([expect.objectContaining({ name: "Mid", can: false, code: "memory", words: "needs more GPU memory", state: "idle" })]);
  });

  it("says a worker that may not take its lane isn't allowed it, and leaves out a worker of another pool", () => {
    worker("Closed", { vramGb: 32, allow: false });
    worker("Elsewhere", { vramGb: 32, pool: "other" });
    const { gid } = task();
    expect(fitOf(gid)).toEqual({ needGb: null, workers: [expect.objectContaining({ name: "Closed", can: false, code: "lane-off", words: "not allowed this kind of job" })] });
  });

  it("says an offline worker is offline, and a worker paused on the website is paused", () => {
    const gone = worker("Gone", { vramGb: 32 });
    const held = worker("Held", { vramGb: 32 });
    pool.patchWorker(held.id, { paused: true });
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(clock - 60 * MIN, gone.id);
    const { gid } = task();
    expect(fitOf(gid).workers).toEqual([
      expect.objectContaining({ name: "Gone", can: true, state: "offline", stateCode: "offline", stateWords: "Offline" }),
      expect.objectContaining({ name: "Held", can: true, state: "paused", stateWords: "Paused on the website" }),
    ]);
  });

  it("agrees with the claim: the worker it says can run the job takes it once it may", () => {
    const big = worker("Big", { vramGb: 32 });
    const mid = worker("Mid", { vramGb: 10 });
    beat(big, { local: { paused: true } });
    const { id, gid } = task({ needGb: 24 });
    expect(fitOf(gid).workers.map((x) => [x.name, x.can])).toEqual([["Big", true], ["Mid", false]]);
    expect(pool.workerClaim(row(mid), [], clock)).toBeNull();
    beat(big);
    expect(pool.workerClaim(row(big), [], clock)?.id).toBe(id);
  });

  it("is quiet about a job with no worker at all", () => {
    const { gid } = task({ needGb: 24 });
    expect(fitOf(gid)).toEqual({ needGb: 24, workers: [] });
  });
});
