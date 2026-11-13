import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntryLike } from "@/lib/relay";
import { tempDir } from "./helpers/temp-dir";

/**
 * A job a worker took by streaming its weights from RAM that runs out of memory (CUDA out of memory, "Allocation on
 * device", Windows' page file, Python's MemoryError) goes back in line for another worker instead of failing, and that
 * worker no longer takes the workflow by streaming (relay_workers.no_stream_json, listed in Settings → Workers, where the
 * owner clears it). A job taken with every weight on the card, any other error, or no other worker that can run it: it
 * fails as before.
 */

vi.setConfig({ testTimeout: 60_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-stream-oom-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const LIBRARY = path.resolve(__dirname, "..", "workflows/comfyui");
const GB = 2 ** 30;
/** No streaming need of its own: 39.5 GiB of model files, VRAM need 32 GB. */
const FLEX = "minimax-h3-flex-i2v";

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { loadIndex } = await import("@/server/gpu/index-file");

let clock = Date.UTC(2026, 10, 3, 3, 0, 0);
const VERSION = "d".repeat(64);
type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;
const filesOf = (id: string) =>
  loadIndex().workflows[id].files.map((k) => {
    const f = loadIndex().files[k];
    return { folder: f.folder, name: f.file, size: f.sizeBytes, sha256: "a".repeat(64) };
  });
const beat = (w: W) =>
  pool.workerBeat(
    row(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 5, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: VERSION }),
    clock,
  );
function worker(name: string, facts: Record<string, unknown>): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [pool.poolLane(FLEX)]: { delayMs: 0 } }, claimAfterMs: 0 });
  beat(w);
  pool.saveInventory(row(w), { files: filesOf(FLEX), nodePacks: [], media: ["image"] });
  db().prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ? WHERE id = ?").run(JSON.stringify(facts), VERSION, w.id);
  beat(w);
  return w;
}
const STREAMS = { vramBytes: 10 * GB, ramBytes: 31.9 * GB };
const WHOLE = { vramBytes: 32 * GB, ramBytes: 64 * GB };

let gens = 0;
function job(): { task: string; gen: string } {
  const gen = `gen-o-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'video', 'm', 'open', 'comfyui', 'i2v', 'video', 'queued', '{}', '[]', ?, ?)")
    .run(gen, clock, clock);
  const graph = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${FLEX}.json`), "utf8"));
  const task = tasks.createTask({ principal: "owner", generationId: gen, graph, workflowId: FLEX, pool: pool.poolFields(FLEX, {}, clock) }).id;
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock, task);
  return { task, gen };
}
const claim = (w: W) => pool.workerClaim(row(w), [], clock);
const state = (id: string) => tasks.taskById(id)!;

/** A ComfyUI history entry that failed with this execution error. */
const failed = (exception_type: string, exception_message: string): HistoryEntryLike => ({
  status: { status_str: "error", completed: false, messages: [["execution_start", {}], ["execution_error", { node_id: "12", node_type: "KSampler", exception_type, exception_message }]] },
  outputs: {},
});
const CUDA_OOM = failed("torch.OutOfMemoryError", "CUDA out of memory. Tried to allocate 2.00 GiB.");
const PLAN_ERROR = "Your GPU ran out of memory. Try a smaller size or a shorter clip.";

/** The worker took the task: it sends the prompt to its ComfyUI, then reports the entry it finished with. */
function runs(id: string, entry: HistoryEntryLike, why?: string) {
  const promptId = crypto.randomUUID();
  tasks.report(state(id), { event: "sent", promptId }, () => ({ error: "x" }), clock);
  tasks.report(state(id), { event: "running", value: 1, max: 8 }, () => ({ error: "x" }), clock);
  return tasks.report(state(id), { event: "finished", entry, ...(why && { why }) }, () => ({ error: PLAN_ERROR }), clock);
}

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * 60_000;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

describe("the words for running out of memory (ranOutOfMemory)", () => {
  it("reads the failed entry's execution error, and the worker's reason", () => {
    expect(tasks.ranOutOfMemory([CUDA_OOM])).toBe(true);
    expect(tasks.ranOutOfMemory([failed("RuntimeError", "Allocation on device 0 would exceed allowed memory.")])).toBe(true);
    expect(tasks.ranOutOfMemory([failed("OSError", "The paging file is too small for this operation to complete. (os error 1455)")])).toBe(true);
    expect(tasks.ranOutOfMemory([failed("MemoryError", "")])).toBe(true);
    expect(tasks.ranOutOfMemory([failed("RuntimeError", "Not enough memory resources are available to process this command.")])).toBe(true);
    expect(tasks.ranOutOfMemory([failed("ValueError", "bad input")])).toBe(false);
    // The reason the worker gave, for an entry whose messages it didn't keep.
    expect(tasks.ranOutOfMemory([{ status: { status_str: "error" } }], "CUDA out of memory in KSampler (node 12)")).toBe(true);
    // A job that didn't fail never ran out of memory, whatever a reason says.
    expect(tasks.ranOutOfMemory([{ status: { status_str: "success" } }], "CUDA out of memory")).toBe(false);
  });
});

describe("a job taken by streaming that runs out of memory", () => {
  it("goes back in line at no cost, the worker no longer streams that workflow, and another worker runs it", () => {
    const { task, gen } = job();
    const small = worker("small", STREAMS);
    const big = worker("big", WHOLE);
    expect(claim(small)?.id).toBe(task);
    expect(JSON.parse(state(task).extra_json ?? "{}").streamed).toBe(true);
    expect(runs(task, CUDA_OOM).ok).toBe(true);
    // Back in line, with its place and its tries as they were; the run itself still waits.
    expect(state(task)).toMatchObject({ state: "waiting", worker_id: null, requeues: 0, comfy_why: null });
    expect(state(task).error ?? null).toBeNull();
    expect((db().prepare("SELECT status FROM generations WHERE id = ?").get(gen) as { status: string }).status).not.toBe("failed");
    // The worker's list, with the time; it takes the workflow no more by streaming.
    expect(pool.noStreamOf(row(small))).toEqual({ [FLEX]: clock });
    expect(pool.workerView(row(small), clock).noStream).toEqual([{ workflowId: FLEX, at: clock }]);
    expect(claim(small)).toBeNull();
    // Another worker, with every weight on its card, takes it.
    expect(claim(big)?.id).toBe(task);
    expect(JSON.parse(state(task).extra_json ?? "{}").streamed).toBeUndefined();
    // Its timeline says so (for the owner).
    const ev = db().prepare("SELECT kind, event, words FROM worker_events WHERE worker_id = ? AND event = 'no-stream'").get(small.id) as { kind: string; words: string } | undefined;
    expect(ev?.kind).toBe("job");
    expect(ev?.words).toContain(FLEX);
  });

  it("the page file running out counts the same", () => {
    const { task } = job();
    const small = worker("small-pf", STREAMS);
    worker("big-pf", WHOLE);
    expect(claim(small)?.id).toBe(task);
    runs(task, failed("OSError", "The paging file is too small for this operation to complete. (os error 1455)"));
    expect(state(task).state).toBe("waiting");
    expect(Object.keys(pool.noStreamOf(row(small)))).toEqual([FLEX]);
  });

  it("with no other worker that can run it: the worker is noted all the same, and the job fails as before", () => {
    const { task } = job();
    const small = worker("alone", STREAMS);
    expect(claim(small)?.id).toBe(task);
    runs(task, CUDA_OOM);
    expect(state(task)).toMatchObject({ state: "failed", error: PLAN_ERROR });
    expect(Object.keys(pool.noStreamOf(row(small)))).toEqual([FLEX]);
    expect(pool.workersCanRun(FLEX)).toBe(false);
  });

  it("taken with every weight on the card, or another error: it fails as before, and nothing is noted", () => {
    const one = job();
    const big = worker("whole", WHOLE);
    worker("other-small", STREAMS);
    expect(claim(big)?.id).toBe(one.task);
    runs(one.task, CUDA_OOM);
    expect(state(one.task).state).toBe("failed");
    expect(pool.noStreamOf(row(big))).toEqual({});
    db().prepare("DELETE FROM relay_workers").run();
    const two = job();
    const small = worker("small-err", STREAMS);
    worker("big-err", WHOLE);
    expect(claim(small)?.id).toBe(two.task);
    runs(two.task, failed("ValueError", "bad input"));
    expect(state(two.task).state).toBe("failed");
    expect(pool.noStreamOf(row(small))).toEqual({});
  });

  it("the owner clears the list: the worker streams the workflow again", () => {
    const small = worker("cleared", STREAMS);
    db().prepare("UPDATE relay_workers SET no_stream_json = ? WHERE id = ?").run(JSON.stringify({ [FLEX]: clock - 1000, "qwen-image-21-t2i": clock - 2000 }), small.id);
    const { task } = job();
    expect(claim(small)).toBeNull();
    expect(pool.workersCanRun(FLEX)).toBe(false);
    expect(() => pool.patchWorker(small.id, { clearNoStream: "all" as unknown as true }, clock)).toThrow(/Say which workflows to clear/);
    const v = pool.patchWorker(small.id, { clearNoStream: [FLEX] }, clock).view!;
    expect(v.noStream).toEqual([{ workflowId: "qwen-image-21-t2i", at: clock - 2000 }]);
    expect(claim(small)?.id).toBe(task);
    expect(pool.patchWorker(small.id, { clearNoStream: true }, clock).view!.noStream).toEqual([]);
    expect(row(small).no_stream_json).toBeNull();
    const ev = db().prepare("SELECT words FROM worker_events WHERE worker_id = ? AND event = 'clear-no-stream' ORDER BY id").all(small.id) as { words: string }[];
    expect(ev.map((e) => e.words)).toEqual([`May stream from RAM again: ${FLEX}`, "May stream from RAM again: qwen-image-21-t2i"]);
  });
});
