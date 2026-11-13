/**
 * The worker's RAM guard (bin/lib/worker/ram.mjs, worker.json `ramGuard`), for a PC its owner also works on. Its parts
 * on their own (the setting, the process list, the worker's own processes, the pause and resume), then the worker end to
 * end against the studio's real routes and its own stand-in ComfyUI (tests/helpers/fake-local-comfy.ts): the process
 * list and the PC's memory are stand-ins, never a real PowerShell or ps.
 *
 * - Above the line: its claims ask for no streamed job; with no job in hand for `afterS`, it pauses ("ram-busy"), and the
 *   studio says "This PC's memory is in use"; under the line for the cool-down, it resumes by itself.
 * - A job in hand goes on to its end: the pause comes after it.
 * - Off (no `ramGuard`): it never reads the process list, and its claims are as before.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ownPids, parseProcs, RamWatch, ramGuardOf, ramSplit, PROCS_SCRIPT } from "../bin/lib/worker/ram.mjs";
import { localPause, runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-ram-guard-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const GB = 1024;

describe("the setting (ramGuardOf)", () => {
  it("off unless set; the defaults; what it refuses", () => {
    expect(ramGuardOf(undefined)).toBeNull();
    expect(ramGuardOf(null)).toBeNull();
    expect(ramGuardOf(false)).toBeNull();
    expect(ramGuardOf({ othersGb: 12 })).toEqual({ othersMb: 12 * GB, afterMs: 60_000, everyMs: 10_000 });
    expect(ramGuardOf({ othersGb: 10.5, afterS: 30, everyS: 5 })).toEqual({ othersMb: 10752, afterMs: 30_000, everyMs: 5000 });
    for (const bad of [{}, { othersGb: 0 }, { othersGb: "x" }, { othersGb: 12, afterS: 5 }, { othersGb: 12, everyS: 120 }, [12], 12, true]) {
      expect(ramGuardOf(bad)).toHaveProperty("problem");
    }
  });
});

describe("the process list", () => {
  it("reads Windows' lines (the larger of working set and private bytes) and ps lines", () => {
    const win = ["4\t0\t4931584\t200704\tSystem", "100\t4\t1073741824\t2147483648\tgame.exe", "200\t100\t0\t0\tC:\\odd name.exe", "x\ty\tz\tw\tbad"].join("\r\n");
    expect(parseProcs(win)).toEqual([
      { pid: 4, ppid: 0, mb: 4931584 / 2 ** 20, name: "System" },
      { pid: 100, ppid: 4, mb: 2048, name: "game.exe" },
      { pid: 200, ppid: 100, mb: 0, name: "C:\\odd name.exe" },
    ]);
    expect(parseProcs("  1     0  2048 /sbin/init\n 77    1 1048576 python3\n")).toEqual([
      { pid: 1, ppid: 0, mb: 2, name: "init" },
      { pid: 77, ppid: 1, mb: 1024, name: "python3" },
    ]);
    expect(parseProcs("")).toBeNull();
    expect(parseProcs("nothing here")).toBeNull();
    // The script passes through a Windows command line: no double quotes in it.
    expect(PROCS_SCRIPT).not.toContain('"');
  });

  it("the worker's own: the trees under its roots, safe from loops and from roots that aren't listed", () => {
    const procs = [
      { pid: 10, ppid: 1, mb: 100, name: "node" },
      { pid: 11, ppid: 10, mb: 5000, name: "python" },
      { pid: 12, ppid: 11, mb: 50, name: "conhost" },
      { pid: 20, ppid: 1, mb: 900, name: "llama-server" },
      { pid: 30, ppid: 31, mb: 1, name: "a" },
      { pid: 31, ppid: 30, mb: 1, name: "b" },
      { pid: 40, ppid: 40, mb: 1, name: "self" },
    ];
    expect([...ownPids(procs, [10, 20, null as never, 99])].sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 99]);
    expect([...ownPids(procs, [30])].sort()).toEqual([30, 31]);
    expect([...ownPids(procs, [40])]).toEqual([40]);
  });

  it("others = used less its own; the largest other program is named, never Windows' own or a small one", () => {
    const procs = [
      { pid: 10, ppid: 1, mb: 1000, name: "node.exe" },
      { pid: 11, ppid: 10, mb: 9000, name: "python.exe" },
      { pid: 50, ppid: 1, mb: 6000, name: "Memory Compression" },
      { pid: 60, ppid: 1, mb: 4000, name: "game.exe" },
      { pid: 61, ppid: 1, mb: 3000, name: "editor.exe" },
    ];
    expect(ramSplit(25_000, procs, [10])).toEqual({ othersMb: 15_000, ownMb: 10_000, who: "game.exe" });
    expect(ramSplit(9_000, procs, [10])).toMatchObject({ othersMb: 0 });
    expect(ramSplit(12_000, [{ pid: 60, ppid: 1, mb: 100, name: "small.exe" }], [10]).who).toBeNull();
  });
});

describe("the pause and resume (RamWatch)", () => {
  const o = { othersMb: 10 * GB, afterMs: 60_000, autoResume: true, resumeAfterMs: 600_000 };
  const high = { othersMb: 14 * GB, who: "game.exe" };
  const low = { othersMb: 6 * GB, who: null };

  it("above the line its claims stream nothing at once; it pauses only after afterMs with no job in hand", () => {
    const r = new RamWatch(o);
    r.update(high, false, 0);
    expect(r.over).toBe(true);
    expect(r.paused).toBe(false);
    r.update(high, false, 59_999);
    expect(r.paused).toBe(false);
    r.update(high, false, 60_000);
    expect(r).toMatchObject({ paused: true, who: "game.exe" });
    expect(localPause({ paused: false }, { paused: false }, null, 0, [], r)).toEqual({ paused: true, why: "ram-busy:game.exe", until: null });
  });

  it("its own job: the time above the line counts from the job's end, and the job is never stopped for it", () => {
    const r = new RamWatch(o);
    r.update(high, true, 0);
    r.update(high, true, 300_000);
    expect(r).toMatchObject({ over: true, paused: false });
    r.update(high, false, 310_000);
    expect(r.paused).toBe(false);
    r.update(high, false, 370_000);
    expect(r.paused).toBe(true);
  });

  it("resumes by itself only with the automatic resume, after the whole cool-down under the line; a spike starts it again", () => {
    const r = new RamWatch(o);
    r.update(high, false, 0);
    r.update(high, false, 60_000);
    r.update(low, false, 100_000);
    expect(r).toMatchObject({ over: false, paused: true });
    r.update(high, false, 500_000);
    r.update(low, false, 510_000);
    r.update(low, false, 1_109_999);
    expect(r.paused).toBe(true);
    r.update(low, false, 1_110_000);
    expect(r.paused).toBe(false);

    const off = new RamWatch({ ...o, autoResume: false });
    off.update(high, false, 0);
    off.update(high, false, 60_000);
    off.update(low, false, 10_000_000);
    expect(off.paused).toBe(true);
    // A resume by hand.
    off.clear();
    expect(off.paused).toBe(false);
  });

  it("no reading counts as under the line: a guard that can't read never keeps it from people's jobs", () => {
    const r = new RamWatch(o);
    r.update(high, false, 0);
    r.update(null, false, 1000);
    expect(r.over).toBe(false);
    r.update(high, false, 2000);
    r.update(high, false, 61_999);
    expect(r.paused).toBe(false);
  });

  it("a pause by hand and a busy GPU win over it", () => {
    const r = new RamWatch(o);
    r.update(high, false, 0);
    r.update(high, false, 60_000);
    expect(localPause({ paused: true }, { paused: false }, null, 0, [], r)?.why).toBe("here");
    expect(localPause({ paused: false }, { paused: true, who: "game.exe" }, null, 0, [], r)?.why).toBe("gpu-busy:game.exe");
    expect(localPause({ paused: false }, { paused: false }, null, 0, [], null)).toEqual({ paused: false, why: null, until: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// End to end

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { ComputerRunner } = await import("@/lib/computer-runner");

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
const SITE = "http://127.0.0.1:9";
const RULES = inputRules(readCatalog(ROOT));
const ALLOWED = new Set(["LoadImage", "KSampler", "SaveImage"]);
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let routes: ComputerRoutes;
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});
const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

type W = { id: string; token: string };
const task = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
const workerRow = (w: W) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as import("@/server/computer/workers").WorkerRow;

function addWorker(): W {
  const w = pool.addWorker(`ram-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

const ticketGraphs = new Map<string, Record<string, unknown>>();
const composer = {
  workerFactsFrom: () => ({}),
  composeTicket: async (job: { generationId: string }) => ({ ok: true, graph: ticketGraphs.get(job.generationId), workflowId: "wf-test", size: { megapixels: 0, seconds: 0, outputs: 1 }, made: [] }),
};

let gens = 0;
function addTask(): string {
  const gid = `ram-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const graph = { "1": { class_type: "LoadImage", inputs: { image: input } }, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } } };
  ticketGraphs.set(gid, graph);
  return tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph,
    ticket: { catalogVersion: catalogVersion(), inputs: [{ slot: "images.0", name: input }] } as never,
    pool: { pools: ["pool"], account: "ram-account", rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  }).id;
}

/** The PC's memory as the stand-ins show it: the worker's own (itself and a child), the desktop, and a game of `gameMb`. */
function fakeRam(o: { gameMb: number }) {
  const reads = { n: 0 };
  const procs = () => [
    { pid: process.pid, ppid: 1, mb: 800, name: "node.exe" },
    { pid: 987_654, ppid: process.pid, mb: 7000, name: "python.exe" },
    { pid: 77, ppid: 1, mb: 4000, name: "explorer.exe" },
    { pid: 5555, ppid: 1, mb: o.gameMb, name: "game.exe" },
  ];
  return {
    reads,
    o,
    readProcs: async () => {
      reads.n++;
      return procs();
    },
    ramNow: () => ({ usedMb: procs().reduce((n, p) => n + p.mb, 0), totalMb: 32 * GB }),
  };
}

interface Started {
  logs: string[];
  claims: Record<string, unknown>[];
}

function start(w: W, ram: ReturnType<typeof fakeRam> | null, o: { guard?: boolean; stepMs?: number; afterMs?: number } = {}): Started {
  const base = tempDir("fuobe-worker-ram-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy") };
  for (const d of Object.values(p)) fs.mkdirSync(d, { recursive: true });
  const s: Started = { logs: [], claims: [] };
  const api = apiAs(routes, null);
  const ctrl = new AbortController();
  const done = runWorker(
    {
      site: SITE,
      token: w.token,
      comfyDir: p.comfyDir,
      workDir: p.workDir,
      modelDirs: [],
      comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "4", "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1"],
      comfyGuard: true,
      ffmpeg: null,
      autoResume: true,
      // 1.2 s of cool-down.
      resumeAfterMin: 0.02,
    },
    {
      fetch: async (url: string, init: RequestInit = {}) => {
        if (!String(url).startsWith(SITE)) return realFetch(url, init);
        const u = new URL(url);
        if (u.pathname === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
        if (u.pathname === "/api/gpu/computer/claim" && typeof init.body === "string") s.claims.push(JSON.parse(init.body));
        return api(u.pathname + u.search, init);
      },
      home: p.home,
      signal: ctrl.signal,
      requirements: { folders: [], files: {}, packs: {}, workflows: {} },
      ComputerRunner,
      rules: RULES,
      pins: {},
      allowed: ALLOWED,
      ffmpegVersion: async () => null,
      awake: { set: () => {} },
      sleep: (ms: number) => sleep(Math.min(ms, 50)),
      log: (line: string) => void s.logs.push(line),
      composer,
      catalogVersion: "a".repeat(64),
      gpuEveryMs: 200,
      idleClaimMs: 200,
      readGpu: async () => ({ usedMb: 300, tempC: 40, apps: [] }),
      ...(ram && { readProcs: ram.readProcs, ramNow: ram.ramNow }),
      ...(o.guard !== false && { ramGuard: { othersMb: 10 * GB, afterMs: o.afterMs ?? 800, everyMs: 100 } }),
    },
  );
  running.push({ ctrl, done });
  return s;
}

async function until<T>(fn: () => T | Promise<T>, ms = 60_000, every = 50): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | "">;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(every);
  }
}

describe("the RAM guard in the worker, end to end", () => {
  it("above the line: claims stream nothing, then a pause the studio names; under it for the cool-down: back to work", async () => {
    const w = addWorker();
    const ram = fakeRam({ gameMb: 0 });
    const s = start(w, ram, { afterMs: 1500 });
    await until(() => s.claims.length > 0);
    expect(s.claims[0]).not.toHaveProperty("noStream");
    // A game starts. Others: the desktop and the game (15.9 GB), not its own 7.8 GB.
    ram.o.gameMb = 12 * GB;
    await until(() => s.claims.some((c) => c.noStream === true), 1500);
    expect(s.logs.some((l) => /Other programs use 15\.9 GB of this PC's memory/.test(l))).toBe(true);
    expect(workerRow(w).paused_local).toBe(0);
    await until(() => workerRow(w).local_why === "ram-busy:game.exe");
    expect(workerRow(w).paused_local).toBe(1);
    expect(pool.workerState(workerRow(w))).toEqual({ state: "gpu-busy", words: "This PC's memory is in use (game.exe)" });
    // The game ends: after the cool-down it resumes and claims as before.
    ram.o.gameMb = 0;
    await until(() => workerRow(w).paused_local === 0 && workerRow(w).local_why === null, 20_000);
    expect(s.logs.some((l) => /stayed free for the whole cool-down: resuming/.test(l))).toBe(true);
    const before = s.claims.length;
    await until(() => s.claims.length > before);
    expect(s.claims.at(-1)).not.toHaveProperty("noStream");
    const id = addTask();
    expect((await until(() => ["done", "failed"].includes(task(id).state) && task(id))).state).toBe("done");
  });

  it("a job in hand goes on to its end; the pause comes after it", async () => {
    const w = addWorker();
    const ram = fakeRam({ gameMb: 0 });
    const s = start(w, ram, { stepMs: 600 });
    const id = addTask();
    await until(() => task(id).state === "running");
    ram.o.gameMb = 12 * GB;
    await sleep(1500);
    // Over afterMs above the line, but its job runs: no pause, the job isn't sent back.
    expect(workerRow(w).paused_local).toBe(0);
    expect(task(id).worker_id).toBe(w.id);
    expect((await until(() => ["done", "failed"].includes(task(id).state) && task(id))).state).toBe("done");
    await until(() => workerRow(w).local_why === "ram-busy:game.exe");
    expect(s.logs.some((l) => /This PC's memory is in use \(game\.exe, 15\.9 GB not its own\): pausing/.test(l))).toBe(true);
  });

  it("off (no ramGuard): it never reads the process list, and its claims are as before", async () => {
    const w = addWorker();
    const ram = fakeRam({ gameMb: 20 * GB });
    const s = start(w, ram, { guard: false });
    await until(() => s.claims.length >= 2);
    await sleep(1000);
    expect(ram.reads.n).toBe(0);
    expect(s.claims.every((c) => !("noStream" in c))).toBe(true);
    expect(workerRow(w).paused_local).toBe(0);
  });
});
