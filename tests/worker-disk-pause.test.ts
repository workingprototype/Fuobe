/**
 * The worker's pause for its worker folder's drive (bin/lib/worker/disk.mjs): its ComfyUI's input, output and temp
 * folders and its kept results are all on that drive. Under worker.json's `minFreeGb` (5 GB by default; 0 turns it off)
 * it takes no new job, and the job in hand goes on to its end. It takes jobs again once the drive has 3 GB more than
 * that. Its parts on their own first (the setting, the drive letter, the reading, the watch and its words, the pause's
 * place among the others), then the worker end to end against the studio's real routes and its own stand-in ComfyUI
 * (tests/helpers/fake-local-comfy.ts). The drive's numbers are stand-ins: never a real full drive.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, loadConfig } from "../bin/lib/worker/config.mjs";
import { DISK_GAP_GB, DiskWatch, driveOf, gbText, MIN_FREE_GB, minFreeOf, readDisk } from "../bin/lib/worker/disk.mjs";
import { levelOf } from "../bin/lib/worker/log-ring.mjs";
import { localPause, runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-disk-pause-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const GB = 2 ** 30;

describe("its setting (minFreeGb)", () => {
  it("5 GB by default from worker.json; 0 turns it off; a value it can't use keeps 5 GB and says so", () => {
    expect(MIN_FREE_GB).toBe(5);
    expect(DEFAULTS.minFreeGb).toBe(5);
    const home = tempDir("fuobe-worker-disk-home-");
    fs.writeFileSync(path.join(home, "worker.json"), "{}");
    expect(loadConfig(home, {} as NodeJS.ProcessEnv).minFreeGb).toBe(5);
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ minFreeGb: 0 }));
    expect(loadConfig(home, {} as NodeJS.ProcessEnv).minFreeGb).toBe(0);
    expect(minFreeOf(5)).toEqual({ gb: 5 });
    expect(minFreeOf(0)).toEqual({ gb: 0 });
    expect(minFreeOf(12.5)).toEqual({ gb: 12.5 });
    // Not read through loadConfig (as tests give their settings): off.
    expect(minFreeOf(undefined)).toEqual({ gb: 0 });
    for (const bad of [null, "10", -1, Number.NaN, Infinity, true, [5]]) {
      const r = minFreeOf(bad);
      expect(r, String(bad)).toMatchObject({ gb: 5, problem: "minFreeGb in worker.json isn't a number of GB" });
    }
  });
});

describe("the reading", () => {
  it("the drive letter on Windows only, never for a network folder", () => {
    expect(driveOf("X:\\fuobe-worker\\work", "win32")).toBe("X");
    expect(driveOf("c:/Users/me/work", "win32")).toBe("C");
    expect(driveOf("\\\\server\\share\\work", "win32")).toBeNull();
    expect(driveOf("/home/me/work", "linux")).toBeNull();
    expect(driveOf("X:\\fuobe-worker\\work", "linux")).toBeNull();
  });

  it("free (what this user may use) and total bytes from one statfs call; null when it can't be read", () => {
    const calls: string[] = [];
    const statfs = (p: string) => {
      calls.push(p);
      return { bsize: 4096, bavail: 1000, bfree: 2000, blocks: 10_000 };
    };
    expect(readDisk("X:\\fuobe-worker\\work", statfs as never, "win32")).toEqual({ drive: "X", freeBytes: 4096 * 1000, totalBytes: 4096 * 10_000 });
    expect(calls).toEqual(["X:\\fuobe-worker\\work"]);
    expect(
      readDisk("/w", (() => {
        throw new Error("ENOENT");
      }) as never, "linux"),
    ).toBeNull();
    expect(readDisk("/w", (() => ({ bsize: 4096, bavail: Number.NaN, blocks: 1 })) as never, "linux")).toBeNull();
    expect(readDisk("/w", (() => ({ bsize: 4096, bavail: 1, blocks: 0 })) as never, "linux")).toBeNull();
    // The real call on this test's own folder works on every system.
    const real = readDisk(dir);
    expect(real?.freeBytes).toBeGreaterThan(0);
    expect(real?.totalBytes).toBeGreaterThanOrEqual(real?.freeBytes ?? 0);
  });

  it("GB in words: at most one decimal, rounded down", () => {
    expect(gbText(3.29 * GB)).toBe("3.2");
    expect(gbText(8 * GB)).toBe("8");
    expect(gbText(0)).toBe("0");
    expect(gbText(1234.56 * GB)).toBe("1234.5");
  });
});

describe("the watch (DiskWatch)", () => {
  const at = (gb: number, drive: string | null = "X") => ({ drive, freeBytes: gb * GB, totalBytes: 2000 * GB });

  it("low under the floor; stays low until the floor plus the gap; then free again", () => {
    expect(DISK_GAP_GB).toBe(3);
    const d = new DiskWatch({ minFreeGb: 5 });
    expect(d.update(at(50))).toBe(false);
    expect(d.why).toBeNull();
    expect(d.update(at(5))).toBe(false); // at the floor is not under it
    expect(d.update(at(3.2))).toBe(true);
    expect(d.why).toBe("disk-low:X:3.2:8");
    expect(d.words("pause")).toBe("Drive X: has only 3.2 GB free: pausing. It takes no new jobs until the drive has 8 GB free. A job in hand goes on.");
    // A warning in the studio's view of its log; the way back is not.
    expect(levelOf(d.words("pause"))).toBe("warn");
    // Over the floor but under the gap: still low (no pausing on and off around the floor).
    expect(d.update(at(6))).toBe(true);
    expect(d.why).toBe("disk-low:X:6:8");
    expect(d.update(at(7.99))).toBe(true);
    expect(d.update(at(8))).toBe(false);
    expect(d.why).toBeNull();
    expect(d.words("back")).toBe("Drive X: has 8 GB free again: it takes jobs again.");
    expect(levelOf(d.words("back"))).toBe("info");
  });

  it("a reading that fails keeps the state it has: it never pauses for no reason, and never lifts a pause by mistake", () => {
    const d = new DiskWatch({ minFreeGb: 5 });
    expect(d.update(null)).toBe(false);
    d.update(at(1));
    expect(d.update(null)).toBe(true);
    expect(d.why).toBe("disk-low:X:1:8");
  });

  it("off at 0; off Windows the drive has no letter", () => {
    const off = new DiskWatch({ minFreeGb: 0 });
    expect(off.update(at(0))).toBe(false);
    expect(off.why).toBeNull();
    const linux = new DiskWatch({ minFreeGb: 2.5 });
    linux.update(at(0.4, null));
    expect(linux.why).toBe("disk-low::0.4:5.5");
    expect(linux.words("pause")).toBe("The drive of its worker folder has only 0.4 GB free: pausing. It takes no new jobs until the drive has 5.5 GB free. A job in hand goes on.");
  });

  it("its place among the pauses: by hand and a busy GPU (both stop the job in hand) win over it; it wins over the rest", () => {
    const free = { paused: false };
    const low = "disk-low:X:3.2:8";
    expect(localPause({ paused: false }, free, null, 0, [], low)).toEqual({ paused: true, why: low, until: null });
    expect(localPause({ paused: true }, free, null, 0, [], low)?.why).toBe("here");
    expect(localPause({ paused: true, now: true }, free, null, 0, [], low)?.why).toBe("here-now");
    expect(localPause({ paused: false }, { paused: true, who: "game.exe" }, null, 0, [], low)?.why).toBe("gpu-busy:game.exe");
    expect(localPause({ paused: false }, free, "port-busy", 0, ["/mnt/models"], low)?.why).toBe(low);
    expect(localPause({ paused: false }, free, null, 0, [], null)).toEqual({ paused: false, why: null, until: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// End to end

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
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
  const w = pool.addWorker(`disk-${Math.random().toString(36).slice(2, 8)}`);
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
  const gid = `disk-gen-${++gens}`;
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
    pool: { pools: ["pool"], account: "disk-account", rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  }).id;
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

interface Started {
  home: string;
  workDir: string;
  logs: string[];
  claims: number;
  /** The drive as the stand-in reads it: change `freeGb` to fill or empty it. */
  disk: { freeGb: number; reads: number };
  /** With spill folders: each one's folder and its drive's free GB (change them to fill or empty a drive). */
  spill: Record<string, { dir: string; freeGb: number | null }>;
}

/**
 * The worker with a 5 GB floor and a stand-in drive X: of 2 TB with `freeGb` free, read every `diskEveryMs`. With
 * `spill` (drive letter to free GB, in order): spill folders on those stand-in drives, each with a 5 GB floor, and its
 * ComfyUI writes each input it is sent into its input folder (as a real one does), so a test sees where it lands.
 */
function start(w: W, o: { freeGb: number; diskEveryMs?: number; stepMs?: number; spill?: Record<string, number> }): Started {
  const base = tempDir("fuobe-worker-disk-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy") };
  for (const d of Object.values(p)) fs.mkdirSync(d, { recursive: true });
  const spill = Object.fromEntries(Object.entries(o.spill ?? {}).map(([l, gb]) => [l, { dir: path.join(base, `${l.toLowerCase()}-spill`), freeGb: gb as number | null }]));
  const s: Started = { home: p.home, workDir: p.workDir, logs: [], claims: 0, disk: { freeGb: o.freeGb, reads: 0 }, spill };
  const api = apiAs(routes, null);
  const ctrl = new AbortController();
  const done = runWorker(
    {
      site: SITE,
      token: w.token,
      comfyDir: p.comfyDir,
      workDir: p.workDir,
      modelDirs: [],
      comfyCommand: [
        process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "4", "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1",
        ...(o.spill ? ["--upload-dir", path.join(p.workDir, "input")] : []),
      ],
      comfyGuard: true,
      ffmpeg: null,
      minFreeGb: 5,
      ...(o.spill && { spillDirs: Object.values(spill).map((x) => ({ dir: x.dir, minFreeGb: 5 })) }),
    },
    {
      fetch: async (url: string, init: RequestInit = {}) => {
        if (!String(url).startsWith(SITE)) return realFetch(url, init);
        const u = new URL(url);
        if (u.pathname === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
        if (u.pathname === "/api/gpu/computer/claim") s.claims++;
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
      readDisk: (folder: string) => {
        expect(folder).toBe(p.workDir);
        s.disk.reads++;
        return { drive: "X", freeBytes: s.disk.freeGb * GB, totalBytes: 2000 * GB };
      },
      ...(o.diskEveryMs !== undefined && { diskEveryMs: o.diskEveryMs }),
      ...(o.spill && {
        readFree: (dir: string) => {
          const [l, x] = Object.entries(spill).find(([, v]) => path.resolve(v.dir) === path.resolve(dir))!;
          return x.freeGb === null ? null : { drive: l, freeBytes: x.freeGb * GB, totalBytes: 2000 * GB };
        },
      }),
    },
  );
  running.push({ ctrl, done });
  return s;
}

const said = (s: Started, re: RegExp) => s.logs.some((l) => re.test(l));
const status = (s: Started) => JSON.parse(fs.readFileSync(path.join(s.home, "status.json"), "utf8")) as { state: string; pause: { paused: boolean; why: string | null } };
const settled = (id: string) => ["done", "failed"].includes(task(id).state) && task(id);

describe("the drive's pause in the worker, end to end", () => {
  it("under the floor: no new job, the owner sees why; over the floor but under the gap: still none; with the gap: it takes the job", async () => {
    const w = addWorker();
    const s = start(w, { freeGb: 50, diskEveryMs: 100 });
    await until(() => s.claims > 0);
    // Its drive's numbers go to the studio with its live stats.
    await until(() => pool.workerStatsOf(workers.getWorker(w.id)!)?.disks?.[0]?.drive === "X");
    expect(pool.workerStatsOf(workers.getWorker(w.id)!)?.disks).toEqual([{ drive: "X", freeBytes: 50 * GB, totalBytes: 2000 * GB }]);
    // The drive fills up.
    s.disk.freeGb = 3.2;
    await until(() => workerRow(w).local_why === "disk-low:X:3.2:8");
    expect(said(s, /^Drive X: has only 3\.2 GB free: pausing\. It takes no new jobs until the drive has 8 GB free\. A job in hand goes on\.$/)).toBe(true);
    expect(workerRow(w).paused_local).toBe(1);
    expect(pool.workerState(workerRow(w))).toEqual({ state: "disk-low", words: "Drive X: is almost full (3.2 GB free): no new jobs until it has 8 GB free" });
    // Its own status (`fuobe worker status`) says it in words that stay the same while the number moves.
    await until(() => status(s).pause.why === "disk-low:X:3.2:8");
    expect(status(s)).toMatchObject({ state: "Paused: the drive of its worker folder is almost full", pause: { paused: true } });
    await sleep(300);
    const claims = s.claims;
    const id = addTask();
    await sleep(1500);
    expect(task(id).state).toBe("waiting");
    expect(s.claims).toBe(claims);
    // Over the floor, under the gap: still paused, with the new number.
    s.disk.freeGb = 6;
    await until(() => workerRow(w).local_why === "disk-low:X:6:8");
    await sleep(1000);
    expect(task(id).state).toBe("waiting");
    expect(s.logs.filter((l) => /GB free/.test(l))).toHaveLength(1);
    // Room again: it says so once and takes the job.
    s.disk.freeGb = 8;
    await until(() => said(s, /^Drive X: has 8 GB free again: it takes jobs again\.$/));
    expect((await until(() => settled(id))).state).toBe("done");
    expect(workerRow(w).paused_local).toBe(0);
    expect(s.logs.filter((l) => /GB free/.test(l))).toHaveLength(2);
  });

  it("a job in hand goes on to its end and is never sent back; no new job after it", async () => {
    const w = addWorker();
    const s = start(w, { freeGb: 50, diskEveryMs: 100, stepMs: 600 });
    await until(() => s.claims > 0);
    const id = addTask();
    await until(() => task(id).state === "running");
    s.disk.freeGb = 1;
    await until(() => workerRow(w).local_why?.startsWith("disk-low:X:1:"));
    // Paused while its job runs: the job stays with it.
    expect(task(id).state).toBe("running");
    expect(task(id).worker_id).toBe(w.id);
    const next = addTask();
    expect((await until(() => settled(id))).state).toBe("done");
    expect(task(id).requeues).toBe(0);
    // Its ComfyUI stops only once the job is done (the pause frees the GPU for the PC's own work).
    await until(() => said(s, /Stopping its own ComfyUI \(paused\)/), 10_000);
    await sleep(1500);
    expect(task(next).state).toBe("waiting");
    expect(pool.workerState(workerRow(w)).state).toBe("disk-low");
  });

  it("the drive is read again after each job: a job that fills it is noticed before the next claim, not a minute later", async () => {
    const w = addWorker();
    // A reading a minute apart (the default): only the start's and the one after the job.
    const s = start(w, { freeGb: 50, stepMs: 600 });
    await until(() => s.claims > 0);
    const first = addTask();
    await until(() => task(first).state === "running");
    const second = addTask();
    const reads = s.disk.reads;
    s.disk.freeGb = 2;
    expect((await until(() => settled(first))).state).toBe("done");
    await until(() => workerRow(w).local_why === "disk-low:X:2:8", 10_000);
    expect(s.disk.reads).toBe(reads + 1);
    await sleep(1500);
    expect(task(second).state).toBe("waiting");
    expect(task(second).worker_id).toBeNull();
  });
});

describe("spill folders in the worker, end to end", () => {
  /** Where a folder of the worker folder points now: a spill folder's drive letter, or "plain". */
  const where = (s: Started, rel: string) => {
    const link = path.join(s.workDir, rel);
    if (!fs.lstatSync(link).isSymbolicLink()) return "plain";
    const target = path.resolve(fs.readlinkSync(link));
    return Object.entries(s.spill).find(([, x]) => target === path.resolve(x.dir, rel))?.[0] ?? target;
  };
  const inputsIn = (s: Started, l: string) => {
    try {
      return fs.readdirSync(path.join(s.spill[l].dir, "input"));
    } catch {
      return [];
    }
  };
  const comfyPid = (s: Started) => (JSON.parse(fs.readFileSync(path.join(s.workDir, "comfyui.pid"), "utf8")) as { pid: number }).pid;

  it("a drive short of room: its folders move to the next spill folder after the job in hand, never during it, and nothing restarts", async () => {
    const w = addWorker();
    const s = start(w, { freeGb: 50, diskEveryMs: 100, stepMs: 1000, spill: { X: 50, S: 100 } });
    await until(() => s.claims > 0);
    expect(["input", "output", "temp", "cache", "hold"].map((rel) => where(s, rel))).toEqual(["X", "X", "X", "X", "X"]);
    expect(said(s, /^Its work folders now use .*x-spill \(50 GB free\)\.$/)).toBe(true);
    const pid = comfyPid(s);
    // A job: its input reaches its ComfyUI's input folder, which is the spill folder on X:.
    const first = addTask();
    await until(() => task(first).state === "running");
    await until(() => inputsIn(s, "X").length > 0, 10_000);
    // X: fills up during the job: the folders stay, and the job goes on.
    s.spill.X.freeGb = 3;
    await sleep(600);
    expect(task(first).state).toBe("running");
    expect(where(s, "input")).toBe("X");
    expect(workerRow(w).paused_local).toBe(0);
    // After it, before the next claim: on S:, said once.
    expect((await until(() => settled(first))).state).toBe("done");
    await until(() => where(s, "input") === "S", 10_000);
    expect(["input", "output", "temp", "cache", "hold"].map((rel) => where(s, rel))).toEqual(["S", "S", "S", "S", "S"]);
    expect(s.logs.filter((l) => /now use .*s-spill/.test(l))).toEqual([`Drive X: has only 3 GB free: its work folders now use ${path.resolve(s.spill.S.dir)} (100 GB free).`]);
    // The next job runs there, on the same ComfyUI.
    const second = addTask();
    await until(() => inputsIn(s, "S").length > 0, 30_000);
    expect((await until(() => settled(second))).state).toBe("done");
    expect(comfyPid(s)).toBe(pid);
    expect([task(first).requeues, task(second).requeues]).toEqual([0, 0]);
    expect(workerRow(w).paused_local).toBe(0);
    // Its drives go to the studio with its live stats.
    await until(() => (pool.workerStatsOf(workers.getWorker(w.id)!)?.disks ?? []).map((d) => d.drive).join() === "X,S");
  });

  it("every spill folder's drive short of room: it pauses with words that name the drives; with room on one, it takes the job there", async () => {
    const w = addWorker();
    const s = start(w, { freeGb: 50, diskEveryMs: 100, spill: { X: 3, S: 2 } });
    await until(() => workerRow(w).local_why === "disk-low:XS:3:8");
    expect(pool.workerState(workerRow(w))).toEqual({ state: "disk-low", words: "Drives X: and S: are almost full: no new jobs until one of them has room" });
    expect(said(s, /^Drives X: and S: are all almost full: pausing\./)).toBe(true);
    await until(() => status(s).state === "Paused: every drive for its work folders is almost full");
    const id = addTask();
    await sleep(1500);
    expect(task(id).state).toBe("waiting");
    s.spill.S.freeGb = 9;
    expect((await until(() => settled(id))).state).toBe("done");
    expect(where(s, "output")).toBe("S");
    expect(said(s, /^Drive S: has room again \(9 GB free\): it takes jobs again\.$/)).toBe(true);
  });
});
