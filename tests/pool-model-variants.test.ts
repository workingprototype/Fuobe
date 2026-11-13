import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Model variants on the workers (docs/gpu-workers.md, "Model variants"): a worker qualifies for a workflow with its own
 * files or a variant's; the claim picks the variant made for its card (its gpuGen) when it has those files, and the job
 * it hands out loads them (the owner's graph, swapped; an account's ticket, naming the variant). The task keeps the
 * variant, so a worker that lost track of its task gets the same files again. A worker program older than protocol 5
 * gets the workflow's own files only.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-pool-variants-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { loadIndex } = await import("@/server/gpu/index-file");

const KREA = "krea2-turbo-t2i";
const FP8 = "diffusion_models/krea2_turbo_fp8_scaled.safetensors";
const INT8 = "diffusion_models/krea2_turbo_int8_convrot.safetensors";
const TE_FP8 = "text_encoders/qwen3vl_4b_fp8_scaled.safetensors";
const TE_INT8 = "text_encoders/qwen3vl_4b_int8_convrot.safetensors";
const VAE = "vae/qwen_image_vae.safetensors";
const BASE = [FP8, TE_FP8, VAE];
const VARIANT = [INT8, TE_INT8, VAE];
const BOTH = [...BASE, INT8, TE_INT8];
const GB = 2 ** 30;
const VERSION = "c".repeat(64);
const GRAPH = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui", `${KREA}.json`), "utf8"));
let clock = Date.UTC(2026, 10, 2, 3, 0, 0);

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;

/** The worker's verified files, as its inventory reports them. */
const filesOf = (keys: string[]) =>
  keys.map((k) => {
    const f = loadIndex().files[k as keyof ReturnType<typeof loadIndex>["files"]];
    return { folder: f.folder, name: f.file, size: f.sizeBytes, sha256: "a".repeat(64) };
  });

function beat(w: W, protocol: number) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: VERSION }),
    clock,
  );
}

/** A worker on, all day, allowed Krea 2's lane, with these files, this card generation and this worker program. */
function worker(name: string, o: { files: string[]; gpuGen?: string; protocol?: number; vram?: number }): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [pool.poolLane(KREA)]: { delayMs: 0 } }, claimAfterMs: 0 });
  beat(w, o.protocol ?? 5);
  pool.saveInventory(row(w), { files: filesOf(o.files), nodePacks: [], media: ["image"] });
  db().prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ? WHERE id = ?").run(JSON.stringify({ vramBytes: (o.vram ?? 24) * GB, ...(o.gpuGen && { gpuGen: o.gpuGen }) }), VERSION, w.id);
  beat(w, o.protocol ?? 5);
  return w;
}

let gens = 0;
function generation() {
  const gid = `gen-v-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  return gid;
}

/** The owner's own Krea 2 job: its catalog graph. */
const ownerJob = () => placed(tasks.createTask({ principal: "owner", generationId: generation(), graph: GRAPH, workflowId: KREA, pool: pool.poolFields(KREA, {}, clock) }).id);

/** A task made at the test's clock. */
function placed(id: string) {
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock, id);
  return id;
}

/** An account's Krea 2 run: a job ticket for this catalog. */
const accountJob = () =>
  placed(tasks.createTask({
    principal: "acct:a1",
    generationId: generation(),
    graph: {},
    ticket: { v: 1, workflowId: KREA, catalogVersion: VERSION, op: "t2i", settings: { prompt: "a portrait", seed: 1, numOutputs: 1 }, inputs: [], outputs: { count: 1, kind: "image" }, size: { megapixels: 1, seconds: 0, outputs: 1 } },
    workflowId: KREA,
    pool: pool.poolFields(KREA, { account: "a1", catalogVersion: VERSION }, clock),
  }).id);

const claim = (w: W, running: string[] = []) => pool.workerClaim(row(w), running, clock);
const loads = (graph: unknown) => JSON.stringify(graph);
const extraOf = (id: string) => JSON.parse((db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(id) as { extra_json: string }).extra_json);

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * 60_000;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

describe("the files a worker gets a job with", () => {
  it("a card the variant is made for runs it when it has its files: the owner's graph loads them", () => {
    const id = ownerJob();
    const w = worker("ampere", { files: BOTH, gpuGen: "8.6" });
    const c = claim(w)!;
    expect(c.id).toBe(id);
    expect(c.variant).toBe("int8");
    expect(loads(c.graph)).toContain("krea2_turbo_int8_convrot.safetensors");
    expect(loads(c.graph)).toContain("qwen3vl_4b_int8_convrot.safetensors");
    expect(loads(c.graph)).not.toContain("_fp8_scaled.safetensors");
    expect(c.models?.map((m) => `${m.folder}/${m.name}`).sort()).toEqual([...VARIANT].sort());
    // The task keeps the variant, and the workers' timeline says it.
    expect(extraOf(id).variant).toBe("int8");
    const ev = db().prepare("SELECT detail_json FROM worker_events WHERE worker_id = ? AND kind = 'job' ORDER BY id DESC LIMIT 1").get(w.id) as { detail_json: string } | undefined;
    expect(JSON.parse(ev?.detail_json ?? "{}").variant).toBe("int8");
  });

  it("another card runs the workflow's own files when it has them", () => {
    ownerJob();
    const c = claim(worker("blackwell", { files: BOTH, gpuGen: "12.0" }))!;
    expect(c.variant).toBeUndefined();
    expect(c.graph).toEqual(GRAPH);
    expect(c.models?.map((m) => `${m.folder}/${m.name}`).sort()).toEqual([...BASE].sort());
  });

  it("a worker with only a variant's files qualifies, and runs the variant whatever its card", () => {
    const id = ownerJob();
    expect(pool.workersCanRun(KREA)).toBe(false);
    const w = worker("int8-only", { files: VARIANT, gpuGen: "12.0" });
    expect(pool.workersCanRun(KREA)).toBe(true);
    const c = claim(w)!;
    expect(c.id).toBe(id);
    expect(c.variant).toBe("int8");
    expect(loads(c.graph)).toContain("krea2_turbo_int8_convrot.safetensors");
  });

  it("part of a variant's files is not enough", () => {
    ownerJob();
    expect(claim(worker("part", { files: [INT8, TE_FP8, VAE], gpuGen: "8.6" }))).toBeNull();
  });

  it("an account's ticket names the variant and its files; the workflow's own files name none", () => {
    const id = accountJob();
    const c = claim(worker("ampere-t", { files: BOTH, gpuGen: "8.6" }))!;
    expect(c.id).toBe(id);
    expect(c.ticket?.variant).toEqual({ id: "int8", files: { [FP8]: INT8, [TE_FP8]: TE_INT8 } });
    expect(c.graph).toBeUndefined();
    accountJob();
    const other = claim(worker("ada-t", { files: BOTH, gpuGen: "8.9" }))!;
    expect(other.ticket).toBeDefined();
    expect("variant" in other.ticket!).toBe(false);
  });

  it("a worker that lost track of its task gets the same files again", () => {
    const id = ownerJob();
    const w = worker("lost", { files: BOTH, gpuGen: "8.6" });
    expect(claim(w)?.variant).toBe("int8");
    // Its files change meanwhile; the task it holds keeps the files it was taken with.
    pool.saveInventory(row(w), { files: filesOf(BASE), nodePacks: [], media: ["image"] });
    const again = claim(w, [])!;
    expect(again.id).toBe(id);
    expect(again.variant).toBe("int8");
    expect(loads(again.graph)).toContain("krea2_turbo_int8_convrot.safetensors");
  });
});

describe("an older worker program (before protocol 5)", () => {
  it("gets the workflow's own files, even on the variant's card", () => {
    ownerJob();
    const c = claim(worker("older", { files: BOTH, gpuGen: "8.6", protocol: 4 }))!;
    expect(c.variant).toBeUndefined();
    expect(c.graph).toEqual(GRAPH);
    accountJob();
    const t = claim(worker("older-t", { files: BOTH, gpuGen: "8.6", protocol: 4 }))!;
    expect("variant" in t.ticket!).toBe(false);
  });

  it("takes no job it has only a variant's files for, and no run counts it", () => {
    ownerJob();
    const w = worker("older-int8", { files: VARIANT, gpuGen: "8.6", protocol: 4 });
    expect(claim(w)).toBeNull();
    expect(pool.workersCanRun(KREA)).toBe(false);
  });

  it("a worker that doesn't say its card's generation gets the workflow's own files when it has them", () => {
    ownerJob();
    const c = claim(worker("no-gen", { files: BOTH }))!;
    expect(c.variant).toBeUndefined();
    expect(c.graph).toEqual(GRAPH);
  });
});

describe("lanes worked out before model variants", () => {
  it("count the workflow's own files only", () => {
    ownerJob();
    const w = worker("before", { files: BOTH, gpuGen: "8.6" });
    const cap = JSON.parse(row(w).lanes_json!);
    delete cap.sets;
    db().prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?").run(JSON.stringify(cap), w.id);
    const c = claim(w)!;
    expect(c.variant).toBeUndefined();
    expect(c.graph).toEqual(GRAPH);
  });
});

describe("VRAM", () => {
  it("a card with too little memory takes neither", () => {
    ownerJob();
    expect(claim(worker("small", { files: BOTH, gpuGen: "8.6", vram: 8 }))).toBeNull();
  });
});
