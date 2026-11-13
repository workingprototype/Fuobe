import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex, loadInputs } from "../scripts/comfy/build-requirements.mjs";
import { parseArgv } from "@/lib/gpu/argv";
import { emptyInventory } from "@/lib/gpu/gather";
import { stateLine, toolReadiness, vramFit, workflowReadiness } from "@/lib/gpu/readiness";
import { parseIndex } from "@/lib/gpu/requirements";
import type { GpuInventory, RequirementIndex } from "@/lib/gpu/types";
import { filesBytes, memoryFit, minVramBytesFor, STREAM_MIN_VRAM_GB, STREAM_RESERVE_BYTES, streamFits } from "@/lib/lanes";
import { statsFacts } from "@/lib/local-comfy";
import { tempDir } from "./helpers/temp-dir";

/**
 * Streaming needs (workflows/comfyui/stream-needs.json): a workflow a card can't hold whole still runs on it with part of
 * its weights kept in system RAM and streamed to the card each step (ComfyUI's dynamic VRAM loading). The build checks
 * the file; a worker qualifies on memory with the workflow's VRAM, or with the streaming need's VRAM and RAM (3%
 * allowance on both, never with unknown RAM or dynamic VRAM off); a person's own GPU reads the same rule. A workflow with
 * no streaming need of its own streams by the computed rule (the size of the files it loads against VRAM and RAM, less
 * a reserve), unless it never streams (stream-needs.json noStream, isolated workflows).
 */

vi.setConfig({ testTimeout: 60_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-stream-needs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const ROOT = path.resolve(__dirname, "..");
const LIBRARY = path.join(ROOT, "workflows/comfyui");
const idx: RequirementIndex = parseIndex(JSON.parse(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8")));
const GB = 2 ** 30;

const H3 = "minimax-h3-image-t2i";
/** No streaming need of its own: 39.5 GiB of model files, VRAM need 32 GB. */
const FLEX = "minimax-h3-flex-i2v";
/** Never streams: its node pack (ComfyUI-WanVideoWrapper) loads its models itself. */
const WRAPPED = "lipsync-v2v-infinitetalk";
const KREA = "krea2-turbo-t2i";
const STREAMED = [
  "minimax-h3-image-t2i",
  "minimax-h3-image-edit",
  "minimax-h3-fast-t2v",
  "minimax-h3-fast-i2v",
  "minimax-h3-fast-flf2v",
  "minimax-h3-flash-t2v",
  "minimax-h3-flash-i2v",
  "minimax-h3-flash-flf2v",
  "krea2-turbo-t2i",
  "flux3-klein-t2i",
  "minimax-h3-i2v",
  "minimax-h3-flex-ref2va",
  "qwen-image-21-relight",
  "fibo2-dev-t2i",
  "ltx25-t2v",
  "video-character-swap-h3",
  "video-fix-faces-h3",
  "video-group-swap-h3",
  "video-h3-t2v-2k",
  "video-motion-transfer-h3",
  "video-scene-edit-h3",
  "z-image-turbo-t2i",
];

/** The committed inputs with stream-needs.json replaced. */
const build = (streams: object[], noStream?: unknown) => buildIndex({ ...loadInputs(LIBRARY), streams: { streams, ...(noStream !== undefined && { noStream }) } as { streams: object[] } });
const entry = (o: Record<string, unknown> = {}) => ({ workflows: [H3], vramGb: 10, ramGb: 32, ...o });

describe("the catalog's streaming needs (build-requirements.mjs)", () => {
  it("puts each workflow's streaming need in requirements.json", () => {
    for (const id of STREAMED) expect(idx.workflows[id].stream, id).toEqual({ vramGb: 10, ramGb: 32 });
    // A workflow with none keeps no field.
    expect("stream" in idx.workflows["sdxl-t2i"]).toBe(false);
  });

  it("refuses numbers that aren't above 0, VRAM that isn't below the workflow's, and unknown or repeated workflows", () => {
    expect(() => build([entry({ vramGb: 0 })])).toThrow(/vramGb must be a number of GB above 0/);
    expect(() => build([entry({ ramGb: -1 })])).toThrow(/ramGb must be a number of GB above 0/);
    expect(() => build([entry({ ramGb: "32" })])).toThrow(/ramGb must be a number of GB above 0/);
    expect(() => build([entry({ vramGb: 32 })])).toThrow(`${H3} needs 32 GB of VRAM, so its streaming need must be below that (not 32 GB)`);
    expect(() => build([entry({ workflows: ["no-such-workflow"] })])).toThrow("no-such-workflow isn't a workflow of the manifest");
    expect(() => build([entry({ workflows: [] })])).toThrow(/workflows must name at least one workflow/);
    expect(() => build([entry(), entry({ ramGb: 64 })])).toThrow(`${H3} has a streaming need already`);
    expect(() => build([entry({ note: "x" })])).toThrow(/unknown field note/);
    expect(() => buildIndex({ ...loadInputs(LIBRARY), streams: {} as { streams: object[] } })).toThrow(/"streams" must be a list/);
    // A good one builds.
    expect(build([entry({ vramGb: 12, ramGb: 48 })]).workflows[H3].stream).toEqual({ vramGb: 12, ramGb: 48 });
  });

  it("marks the workflows that never stream: noStream's packs and workflows, and isolated workflows", () => {
    for (const id of ["infinitetalk-wanwrapper", WRAPPED, "sfx-hunyuan-foley", "sfx-mmaudio-t2a", "video-upscale-kandinsky6-vsr"]) expect(idx.workflows[id].stream, id).toBe(false);
    const isolated = Object.keys(idx.workflows).filter((x) => idx.workflows[x].isolated);
    expect(isolated.length).toBeGreaterThan(0);
    for (const id of isolated) expect(idx.workflows[id].stream, id).toBe(false);
    // The others have their streaming need, or no field (the computed rule).
    expect("stream" in idx.workflows[FLEX]).toBe(false);
    expect(build([], { packs: [], workflows: [FLEX] }).workflows[FLEX].stream).toBe(false);
    expect("stream" in build([], { packs: [], workflows: [] }).workflows[WRAPPED]).toBe(false);
  });

  it("refuses names the catalog doesn't have, unknown fields, and a workflow that has a streaming need and never streams", () => {
    expect(() => build([], { packs: ["No-Such-Pack"] })).toThrow("No-Such-Pack isn't a node pack of packs.json");
    expect(() => build([], { workflows: ["no-such-workflow"] })).toThrow("no-such-workflow isn't a workflow of the manifest");
    expect(() => build([], { packs: "ComfyUI-WanVideoWrapper" })).toThrow(/packs must be a list of node pack names/);
    expect(() => build([], { workflows: [1] })).toThrow(/workflows must be a list of workflow ids/);
    expect(() => build([], { note: "x" })).toThrow(/noStream: unknown field note/);
    expect(() => build([], [])).toThrow(/"noStream" must be an object/);
    expect(() => buildIndex({ ...loadInputs(LIBRARY), streams: { streams: [], other: 1 } as { streams: object[] } })).toThrow(/stream-needs.json: unknown field other/);
    expect(() => build([entry({ workflows: [WRAPPED] })], { packs: ["ComfyUI-WanVideoWrapper"] })).toThrow(`${WRAPPED} has a streaming need, but it never streams (it uses ComfyUI-WanVideoWrapper)`);
    expect(() => build([entry({ workflows: [FLEX] })], { workflows: [FLEX] })).toThrow(`${FLEX} has a streaming need, but it never streams (noStream names it)`);
    expect(() => build([entry({ workflows: ["lipsync-latentsync16"] })])).toThrow("lipsync-latentsync16 has a streaming need, but it never streams (it runs isolated)");
  });
});

describe("the memory rule (memoryFit, streamFits)", () => {
  const stream = { vramGb: 10, ramGb: 32 };
  it("VRAM alone, as before", () => {
    expect(memoryFit(32, stream, { vramBytes: 32 * GB })).toBe("vram");
    expect(memoryFit(32, undefined, { vramBytes: 24 * GB, ramBytes: 64 * GB })).toBeNull();
  });

  it("the streaming need's VRAM and RAM", () => {
    expect(memoryFit(32, stream, { vramBytes: 10 * GB, ramBytes: 32 * GB })).toBe("stream");
    expect(memoryFit(32, stream, { vramBytes: 8 * GB, ramBytes: 64 * GB })).toBeNull();
    expect(memoryFit(32, stream, { vramBytes: 12 * GB, ramBytes: 16 * GB })).toBeNull();
  });

  it("never with unknown RAM, unknown VRAM, or dynamic VRAM off", () => {
    expect(memoryFit(32, stream, { vramBytes: 10 * GB })).toBeNull();
    expect(streamFits(stream, { ramBytes: 64 * GB })).toBe(false);
    expect(memoryFit(32, stream, { vramBytes: 10 * GB, ramBytes: 64 * GB, dynamicVramOff: true })).toBeNull();
  });

  it("allows 3% under the whole GB for both, as the VRAM test does", () => {
    // A 32 GB PC reports about 31.9 GiB of RAM; a 10 GB card a little under 10 GiB.
    expect(memoryFit(32, stream, { vramBytes: 9.8 * GB, ramBytes: 31.9 * GB })).toBe("stream");
    expect(streamFits(stream, { vramBytes: minVramBytesFor(10), ramBytes: minVramBytesFor(32) })).toBe(true);
    expect(streamFits(stream, { vramBytes: minVramBytesFor(10) - 1, ramBytes: 64 * GB })).toBe(false);
    expect(streamFits(stream, { vramBytes: 12 * GB, ramBytes: minVramBytesFor(32) - 1 })).toBe(false);
  });

  it("a streaming need of its own decides, whatever the computed rule would say", () => {
    const have = { vramBytes: 8 * GB, ramBytes: 64 * GB };
    expect(memoryFit(32, undefined, have, { fileBytes: 30 * GB })).toBe("stream");
    expect(memoryFit(32, stream, have, { fileBytes: 30 * GB })).toBeNull();
  });

  it("a ComfyUI's facts say when its dynamic VRAM is off", () => {
    const stats = (argv: string[]) => statsFacts({ system: { argv, ram_total: 32 * GB }, devices: [] }, "https://studio.test");
    expect(stats(["main.py"]).dynamicVramOff).toBeUndefined();
    expect(stats(["main.py", "--disable-dynamic-vram"]).dynamicVramOff).toBe(true);
    expect(stats(["main.py", "--highvram"]).dynamicVramOff).toBe(true);
  });
});

describe("the computed rule (a workflow with no streaming need of its own)", () => {
  /** A 10 GB card and a PC with 32 GB of RAM, as they report themselves. */
  const small = { vramBytes: 9.99 * GB, ramBytes: 31.9 * GB };
  const fit = (needGb: number, fileGb: number, have: Parameters<typeof memoryFit>[2], extraGb = 0) => memoryFit(needGb, undefined, have, { fileBytes: fileGb * GB, extraBytes: extraGb * GB });

  it("keeps a 2 GiB reserve and an 8 GB smallest card", () => {
    expect(STREAM_RESERVE_BYTES).toBe(2 * GB);
    expect(STREAM_MIN_VRAM_GB).toBe(8);
  });

  it("the files fit in VRAM and RAM with the reserve to spare: the measured workflows run on a 10 GB card with 32 GB of RAM", () => {
    expect(fit(32, 39.5, small)).toBe("stream");
    expect(fit(32, 39.5, { ...small, ramBytes: 31.8 * GB })).toBe("stream");
    for (const id of ["minimax-h3-fast-t2v", "minimax-h3-i2v", "minimax-h3-flex-ref2va", "qwen-image-21-relight", FLEX]) {
      const wf = idx.workflows[id];
      expect(streamFits(undefined, small, { fileBytes: filesBytes(idx, wf.files) }, wf.vramGb), id).toBe(true);
    }
    // More than the room: no.
    expect(fit(32, 40, small)).toBeNull();
    expect(fit(32, 39.5, { ...small, ramBytes: 16 * GB })).toBeNull();
    // The run-time files (a look's LoRAs) count too.
    expect(fit(32, 39.5, small, 1)).toBeNull();
  });

  it("never on a card under 8 GB (3% allowed), with no files, or for a workflow that never streams", () => {
    expect(fit(24, 20, { vramBytes: minVramBytesFor(8), ramBytes: 64 * GB })).toBe("stream");
    expect(fit(24, 20, { vramBytes: minVramBytesFor(8) - 1, ramBytes: 64 * GB })).toBeNull();
    expect(fit(24, 20, { vramBytes: 6 * GB, ramBytes: 128 * GB })).toBeNull();
    expect(fit(24, 0, { vramBytes: 10 * GB, ramBytes: 64 * GB })).toBeNull();
    expect(memoryFit(32, false, small, { fileBytes: 20 * GB })).toBeNull();
  });

  it("the part of the VRAM need that isn't model files stays on the card", () => {
    // 24 GB for 4 GiB of files: about 19 GiB of activations and other weights, more than a 10 GB card holds.
    expect(fit(24, 4, { vramBytes: 10 * GB, ramBytes: 64 * GB })).toBeNull();
    expect(fit(24, 4, { vramBytes: 20 * GB, ramBytes: 64 * GB })).toBe("stream");
    // 16 GB for 3.7 GiB: about 11.8 GiB stays on the card.
    expect(fit(16, 3.7, { vramBytes: 11.5 * GB, ramBytes: 64 * GB })).toBeNull();
    expect(fit(16, 3.7, { vramBytes: 12 * GB, ramBytes: 64 * GB })).toBe("stream");
  });

  it("never with unknown RAM, unknown VRAM, or dynamic VRAM off", () => {
    expect(fit(32, 20, { vramBytes: 10 * GB })).toBeNull();
    expect(streamFits(undefined, { ramBytes: 64 * GB }, { fileBytes: 20 * GB }, 32)).toBe(false);
    expect(fit(32, 20, { ...small, dynamicVramOff: true })).toBeNull();
  });
});

/** A person's ComfyUI with every file and node of the index, this card's VRAM and this RAM (none: not read). */
function comfy(vramGb: number, ramGb?: number, argv: string[] = ["main.py"]): GpuInventory {
  const inv = emptyInventory("server", 1);
  inv.reachable = true;
  inv.comfy = { version: "0.44.0", os: "posix", embeddedPython: false, deployEnv: "local-git", flags: parseArgv(argv) };
  inv.devices = [{ name: "cuda:0 NVIDIA GeForce RTX 3080 : cudaMallocAsync", type: "cuda", index: 0, vramTotal: vramGb * GB, vramFree: 0 }];
  if (ramGb) inv.ram = { total: ramGb * GB, free: 0 };
  inv.manager = { api: "none" };
  inv.nodes = { have: [], missing: [], total: 0, readAt: 1, how: "object_info" };
  for (const folder of idx.folders) inv.models[folder] = { have: {}, total: 0 };
  for (const f of Object.values(idx.files)) {
    inv.models[f.folder] ??= { have: {}, total: 0 };
    inv.models[f.folder].have[f.file] = f.sizeBytes;
    for (const [cls, input] of f.loaders ?? []) (inv.combos[`${cls}.${input}`] ??= []).push(f.file);
  }
  return inv;
}

describe("a person's own GPU (readiness)", () => {
  it("a smaller card with the RAM is ready, slower, in plain words", () => {
    const r = workflowReadiness(H3, comfy(10, 31.9), idx, { account: true });
    expect(r.state).toBe("ready");
    expect(r.vram).toMatchObject({ needGb: 32, fit: "tight", stream: true });
    const t = toolReadiness(`workflow:${H3}`, "H3 Image", [H3], [], comfy(10, 32), idx, { account: true });
    expect(t.state).toBe("ready");
    expect(t.vram.stream).toBe(true);
    expect(stateLine(t)).toBe("Ready · uses system RAM, slower");
  });

  it("too little RAM, RAM not read, or dynamic VRAM off: it needs the bigger card, as before", () => {
    expect(workflowReadiness(H3, comfy(10, 16), idx, { account: true }).state).toBe("gpu");
    expect(workflowReadiness(H3, comfy(10), idx, { account: true }).state).toBe("gpu");
    expect(workflowReadiness(H3, comfy(10, 64, ["main.py", "--disable-dynamic-vram"]), idx, { account: true }).state).toBe("gpu");
    expect(workflowReadiness(H3, comfy(8, 64), idx, { account: true }).state).toBe("gpu");
  });

  it("a card that holds it whole says nothing of RAM; a workflow with no streaming need is as before", () => {
    expect(vramFit(32, comfy(32, 64), { vramGb: 10, ramGb: 32 })).toEqual({ needGb: 32, haveGb: 32, fit: "fits" });
    expect(vramFit(32, comfy(10, 64))).toEqual({ needGb: 32, haveGb: 10, fit: "no" });
    expect(stateLine(toolReadiness(`workflow:${H3}`, "H3 Image", [H3], [], comfy(24, 16), idx, { account: true }))).toBe("Ready · slow on your GPU");
  });

  it("a workflow with no streaming need of its own: the size of its files decides; one that never streams needs the bigger card", () => {
    const r = workflowReadiness(FLEX, comfy(10, 31.9), idx, { account: true });
    expect(r.state).toBe("ready");
    expect(r.vram).toMatchObject({ needGb: 32, fit: "tight", stream: true });
    expect(stateLine(toolReadiness(`workflow:${FLEX}`, "H3 Flex", [FLEX], [], comfy(10, 32), idx, { account: true }))).toBe("Ready · uses system RAM, slower");
    expect(workflowReadiness(FLEX, comfy(10, 16), idx, { account: true }).state).toBe("gpu");
    expect(workflowReadiness(WRAPPED, comfy(10, 128), idx, { account: true }).vram).toEqual({ needGb: 24, haveGb: 10, fit: "no" });
  });

  it("a tool whose other part can't stream needs the bigger card", () => {
    const noStream = WRAPPED;
    expect(idx.workflows[noStream].stream).toBe(false);
    const t = toolReadiness(`workflow:${H3}`, "Two", [H3, noStream], [], comfy(10, 64), idx, { account: true });
    expect(t.state).toBe("gpu");
    expect(t.vram.stream).toBeUndefined();
  });
});

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { loadIndex } = await import("@/server/gpu/index-file");

describe("which workers qualify on memory (the claim)", () => {
  let clock = Date.UTC(2026, 10, 3, 3, 0, 0);
  const VERSION = "d".repeat(64);
  type W = { id: string; token: string };
  const row = (w: W) => workers.getWorker(w.id)!;
  const filesOf = (id: string) =>
    [...loadIndex().workflows[id].files, ...(loadIndex().workflows[id].variants ?? []).flatMap((v) => Object.values(v.files))].map((k) => {
      const f = loadIndex().files[k];
      return { folder: f.folder, name: f.file, size: f.sizeBytes, sha256: "a".repeat(64) };
    });
  const beat = (w: W) =>
    pool.workerBeat(
      row(w),
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 5, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: VERSION }),
      clock,
    );
  function worker(name: string, id: string, facts: Record<string, unknown>): W {
    const w = pool.addWorker(name);
    pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [pool.poolLane(id)]: { delayMs: 0 } }, claimAfterMs: 0 });
    beat(w);
    pool.saveInventory(row(w), { files: filesOf(id), nodePacks: [], media: ["image"] });
    db().prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ? WHERE id = ?").run(JSON.stringify(facts), VERSION, w.id);
    beat(w);
    return w;
  }
  let gens = 0;
  function job(id: string): string {
    const gid = `gen-s-${++gens}`;
    db()
      .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
      .run(gid, clock, clock);
    const graph = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${id}.json`), "utf8"));
    const t = tasks.createTask({ principal: "owner", generationId: gid, graph, workflowId: id, pool: pool.poolFields(id, {}, clock) }).id;
    db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock, t);
    return t;
  }
  const claim = (w: W) => pool.workerClaim(row(w), [], clock);

  beforeAll(() => setSetting("comfyWhere", "workers"));
  beforeEach(() => {
    resetRates();
    clock += 60 * 60_000;
    db().prepare("DELETE FROM relay_workers").run();
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  });

  it("VRAM only: a card that holds it whole, as before", () => {
    const id = job(H3);
    expect(claim(worker("big", H3, { vramBytes: 32 * GB }))?.id).toBe(id);
  });

  it("VRAM and RAM: a 10 GB card with 32 GB of RAM takes it, and a run counts it", () => {
    const id = job(H3);
    const w = worker("small", H3, { vramBytes: 9.8 * GB, ramBytes: 31.9 * GB });
    expect(pool.workersCanRun(H3)).toBe(true);
    expect(claim(w)?.id).toBe(id);
  });

  it("unknown RAM, too little RAM, too small a card, or dynamic VRAM off: it takes nothing", () => {
    job(H3);
    expect(claim(worker("no-ram", H3, { vramBytes: 10 * GB }))).toBeNull();
    expect(claim(worker("little-ram", H3, { vramBytes: 10 * GB, ramBytes: 16 * GB }))).toBeNull();
    expect(claim(worker("small-card", H3, { vramBytes: 8 * GB, ramBytes: 64 * GB }))).toBeNull();
    expect(claim(worker("dyn-off", H3, { vramBytes: 10 * GB, ramBytes: 64 * GB, dynamicVramOff: true }))).toBeNull();
    expect(pool.workersCanRun(H3)).toBe(false);
  });

  it("no streaming need of its own: a 10 GB card with 32 GB of RAM takes a workflow of 39.5 GiB of files, and the claim notes it streams", () => {
    const id = job(FLEX);
    expect(claim(worker("flex-low-ram", FLEX, { vramBytes: 10 * GB, ramBytes: 16 * GB }))).toBeNull();
    expect(claim(worker("flex", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB }))?.id).toBe(id);
    expect(JSON.parse(tasks.taskById(id)!.extra_json ?? "{}").streamed).toBe(true);
    const whole = job(FLEX);
    expect(claim(worker("flex-big", FLEX, { vramBytes: 32 * GB, ramBytes: 16 * GB }))?.id).toBe(whole);
    expect(JSON.parse(tasks.taskById(whole)!.extra_json ?? "{}").streamed).toBeUndefined();
  });

  it("a workflow with model variants: the streaming need counts for the files the worker runs", () => {
    const id = job(KREA);
    const c = claim(worker("ampere", KREA, { vramBytes: 10 * GB, ramBytes: 32 * GB, gpuGen: "8.6" }))!;
    expect(c.id).toBe(id);
    expect(c.variant).toBe("int8");
    job(KREA);
    expect(claim(worker("ampere-low-ram", KREA, { vramBytes: 10 * GB, ramBytes: 16 * GB, gpuGen: "8.6" }))).toBeNull();
  });

  // A claim with noStream (the worker's RAM guard): a preference, never a wait.
  const noStream = (w: W) => pool.workerClaim(row(w), [], clock, "gpu", { noStream: true });
  const streamedOf = (id: string) => JSON.parse(tasks.taskById(id)!.extra_json ?? "{}").streamed;

  it("no streaming asked, and no other worker could take the job now: it takes it streamed all the same, said in its claim's words", () => {
    const id = job(FLEX);
    const small = worker("flex-shared-pc", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    expect(noStream(small)?.id).toBe(id);
    // Marked streamed: the fallback after running out of memory applies.
    expect(streamedOf(id)).toBe(true);
    expect(row(small).asked_words).toMatch(/its PC's memory is in use: no other worker could take this job now/);
    // Its facts are as they were.
    expect(JSON.parse(row(small).facts_json ?? "{}").ramBytes).toBe(31.9 * GB);
    // A card that holds it whole takes it whatever the claim says, not streamed.
    const whole = job(FLEX);
    expect(noStream(worker("flex-whole", FLEX, { vramBytes: 32 * GB, ramBytes: 16 * GB }))?.id).toBe(whole);
    expect(streamedOf(whole)).toBeUndefined();
  });

  it("no streaming asked, and another free worker takes that job next: it leaves the job for it", () => {
    const id = job(FLEX);
    const small = worker("flex-shared-pc", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    const big = worker("flex-whole", FLEX, { vramBytes: 32 * GB, ramBytes: 16 * GB });
    expect(noStream(small)).toBeNull();
    expect(row(small).asked_words).toMatch(/its PC's memory is in use: it prefers jobs that fit whole on its card/);
    expect(tasks.taskById(id)!.state).toBe("waiting");
    expect(claim(big)?.id).toBe(id);
    expect(streamedOf(id)).toBeUndefined();
    // Another worker that streams it too counts: it is free, and the job is its next.
    const next = job(FLEX);
    const other = worker("flex-other", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    expect(noStream(small)).toBeNull();
    expect(claim(other)?.id).toBe(next);
  });

  it("a worker that isn't free now doesn't count: paused, or busy with a job (as for first pick)", () => {
    const first = job(FLEX);
    const small = worker("flex-shared-pc", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    const big = worker("flex-whole", FLEX, { vramBytes: 32 * GB, ramBytes: 16 * GB });
    pool.patchWorker(big.id, { paused: true }, clock);
    expect(noStream(small)?.id).toBe(first);
    // Busy: its GPU's slot holds a job.
    pool.patchWorker(big.id, { paused: false }, clock);
    const busy = job(FLEX);
    expect(claim(big)?.id).toBe(busy);
    const third = job(FLEX);
    const small2 = worker("flex-shared-pc-2", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    expect(noStream(small2)?.id).toBe(third);
    expect(streamedOf(third)).toBe(true);
  });

  it("two workers that both ask for no streaming never leave a job to each other", () => {
    const id = job(FLEX);
    const a = worker("flex-a", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    const b = worker("flex-b", FLEX, { vramBytes: 10 * GB, ramBytes: 31.9 * GB });
    // b's claim: a's last claim asked for nothing, so a could stream it: b leaves it.
    expect(noStream(b)).toBeNull();
    expect(row(b).asked_no_stream).toBe(1);
    // a's claim: b asks for no streaming too, so b counts only with what fits whole on its card: a takes it.
    expect(noStream(a)?.id).toBe(id);
    expect(streamedOf(id)).toBe(true);
    // A claim without it clears the mark.
    expect(claim(b)).toBeNull();
    expect(row(b).asked_no_stream).toBe(0);
  });
});
