/**
 * The worker's face self-check in its run (bin/lib/worker/run.mjs), end to end against the studio's real routes and its
 * own stand-in ComfyUI (tests/helpers/fake-local-comfy.ts, a process of its own). The check itself is a stand-in
 * (deps.selfCheck), so each test says what it reads; the detector's own check is in tests/worker-self-check.test.ts.
 *
 * - The check after its ComfyUI starts runs before its first claim.
 * - Its ComfyUI stops under a running job and comes back: no check (and no restart) under that job, and the job ends;
 *   the check it owes runs between jobs.
 * - A check before a face job fails: that job goes back in line (never failed), its ComfyUI starts again with no job in
 *   hand, and the job then runs.
 * - A check that times out just after a job is "not checked yet": no restart, no 5-minute hold.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-face-run-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { ComputerRunner } = await import("@/lib/computer-runner");

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
const SITE = "http://127.0.0.1:9";
const RULES = inputRules(readCatalog(ROOT));
const ALLOWED = new Set(["LoadImage", "KSampler", "SaveImage", "H3FaceTrackCrop"]);
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

function addWorker(): W {
  const w = pool.addWorker(`face-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

let gens = 0;
/** A job that loads a picture and saves one; `face`: it detects faces too (a face job). */
function addTask(o: { face?: boolean } = {}): string {
  const gid = `face-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  return tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: {
      "1": { class_type: "LoadImage", inputs: { image: input } },
      ...(o.face && { "2": { class_type: "H3FaceTrackCrop", inputs: { images: ["1", 0], detector: "bbox\\face_yolov8m.pt", fallback_detector: "none" } } }),
      "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } },
    },
    pool: { pools: ["pool"], rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  }).id;
}

type Check = { ok: boolean; height: number | null; why?: string };
const PASS: Check = { ok: true, height: 168 };

interface Pc {
  workDir: string;
  logs: string[];
  /** When each claim went to the studio. */
  claims: number[];
  reports: Record<string, unknown>[];
  /** Each face check the worker ran: when it began and ended. */
  checks: { from: number; to: number; read: Check }[];
}

/** Start `fuobe worker run` here; `read(n)` says what its n-th face check (from 1) reads, after `checkMs`. */
function start(w: W, o: { read: (n: number) => Check; checkMs?: number; steps?: number; stepMs?: number; faceSettleMs?: number }): Pc {
  const base = tempDir("fuobe-worker-face-pc-");
  const dirs = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy") };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const p: Pc = { workDir: dirs.workDir, logs: [], claims: [], reports: [], checks: [] };
  const api = apiAs(routes, null);
  const ctrl = new AbortController();
  const done = runWorker(
    {
      site: SITE,
      token: w.token,
      comfyDir: dirs.comfyDir,
      workDir: dirs.workDir,
      modelDirs: [],
      comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", String(o.steps ?? 4), "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1"],
      comfyGuard: true,
      ffmpeg: null,
    },
    {
      fetch: async (url: string, init: RequestInit = {}) => {
        if (!String(url).startsWith(SITE)) return realFetch(url, init);
        const u = new URL(url);
        if (u.pathname === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
        if (u.pathname === "/api/gpu/computer/claim") p.claims.push(Date.now());
        if (u.pathname.endsWith("/report")) p.reports.push(JSON.parse(String(init.body)));
        return api(u.pathname + u.search, init);
      },
      home: dirs.home,
      signal: ctrl.signal,
      requirements: { folders: [], files: {}, packs: {}, workflows: {} },
      ComputerRunner,
      rules: RULES,
      pins: {},
      allowed: ALLOWED,
      ffmpegVersion: async () => null,
      awake: { set: () => {} },
      sleep: (ms: number) => sleep(Math.min(ms, 50)),
      log: (line: string) => void p.logs.push(line),
      readGpu: async () => null,
      idleClaimMs: 200,
      faceNodes: true,
      ...(o.faceSettleMs !== undefined && { faceSettleMs: o.faceSettleMs }),
      selfCheck: async () => {
        const from = Date.now();
        await sleep(o.checkMs ?? 20);
        const read = o.read(p.checks.length + 1);
        p.checks.push({ from, to: Date.now(), read });
        return read;
      },
    },
  );
  running.push({ ctrl, done });
  return p;
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
const ended = (id: string) => until(() => ["done", "failed", "canceled"].includes(task(id).state) && task(id), 90_000);
const comfyOf = (p: Pc) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(p.workDir, "comfyui.pid"), "utf8")) as { pid: number; port: number };
  } catch {
    return null;
  }
};
const fakeStats = async (port: number) => (await realFetch(`http://127.0.0.1:${port}/__fake/stats`)).json() as Promise<{ step: number | null }>;
const starts = (p: Pc) => p.logs.filter((l) => /^Starting its own ComfyUI/.test(l)).length;
const faceRestarts = (p: Pc) => p.logs.filter((l) => /Its face check .*: starting its ComfyUI again/.test(l)).length;

describe("the face self-check in the worker's run", () => {
  it("the check after its ComfyUI starts runs before its first claim, with a job already waiting", async () => {
    const w = addWorker();
    const id = addTask();
    const p = start(w, { read: () => PASS, checkMs: 1500 });
    expect((await ended(id)).state).toBe("done");
    expect(p.checks.length).toBeGreaterThanOrEqual(1);
    expect(p.claims.length).toBeGreaterThanOrEqual(1);
    expect(p.claims[0]).toBeGreaterThanOrEqual(p.checks[0].to);
  });

  it("its ComfyUI stops under a running job: no check and no restart under that job, the job ends, and the owed check runs between jobs", async () => {
    const w = addWorker();
    const id = addTask();
    // Any check while the job is in the studio's hands would only time out (the GPU is busy with it).
    const p = start(w, { read: () => (["sending", "queued", "running", "collecting"].includes(task(id).state) ? { ok: false, height: null, why: "timeout" } : PASS), steps: 10, stepMs: 150, faceSettleMs: 500 });
    const comfy = await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 3 ? c : null;
    });
    const checksBefore = p.checks.length;
    process.kill(comfy.pid, "SIGKILL");
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(t.requeues).toBe(0);
    expect(starts(p)).toBe(2);
    expect(p.logs.some((l) => /Its face check after its start waits: a job is in hand/.test(l))).toBe(true);
    // No check ran while the job was in hand, so none timed out and none started its ComfyUI again.
    expect(p.checks.slice(checksBefore).every((c) => c.read.ok)).toBe(true);
    expect(faceRestarts(p)).toBe(0);
    // Between jobs, once its GPU settled: the check it owed.
    await until(() => p.checks.length > checksBefore && p.checks.at(-1)!.read.ok, 10_000);
    expect(starts(p)).toBe(2);
  });

  it("a check before a face job fails: the job goes back in line (not failed), its ComfyUI starts again with no job in hand, then the job runs", async () => {
    const w = addWorker();
    // 1: after its start (passes). 2: before the face job (reads a wrong face). 3, 4: between jobs, then after the restart.
    const p = start(w, { read: (n) => (n === 2 ? { ok: false, height: 90, why: "height" } : n === 3 ? { ok: false, height: 90, why: "height" } : PASS) });
    await until(() => p.checks.length >= 1 && p.claims.length >= 1);
    const id = addTask({ face: true });
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(t.requeues).toBe(0);
    expect(p.reports.some((r) => r.event === "give-back" && r.why === "self-check")).toBe(true);
    expect(p.reports.some((r) => r.event === "failed")).toBe(false);
    expect(p.logs.some((l) => /Its face check before a face job read 90 px \(height\): this job goes back in line, and its ComfyUI starts again once no job is in hand/.test(l))).toBe(true);
    // Its ComfyUI started again once, between jobs (never under the job), and the check passed after it.
    expect(p.logs.some((l) => /Its face check between jobs read 90 px \(height\): starting its ComfyUI again/.test(l))).toBe(true);
    expect(faceRestarts(p)).toBe(1);
    expect(p.logs.some((l) => /Its face check passed after the restart/.test(l))).toBe(true);
    expect(p.logs.some((l) => /face jobs go back in line for 5 minutes/.test(l))).toBe(false);
  });

  it("a check that times out just after a job is 'not checked yet': no restart and no hold; checked again between jobs", async () => {
    const w = addWorker();
    let firstFaceCheck = 0;
    const p = start(w, {
      // Before the first face job (just after the other job): a timeout. Every other check passes.
      read: (n) => {
        if (firstFaceCheck === 0 && p.logs.some((l) => /Job .* done/i.test(l))) firstFaceCheck = n;
        return n === firstFaceCheck ? { ok: false, height: null, why: "timeout" } : PASS;
      },
      faceSettleMs: 3000,
    });
    await until(() => p.checks.length >= 1 && p.claims.length >= 1);
    const plain = addTask();
    expect((await ended(plain)).state).toBe("done");
    const face = addTask({ face: true });
    const t = await ended(face);
    expect(t.state).toBe("done");
    expect(t.requeues).toBe(0);
    expect(p.logs.some((l) => /Its face check before a face job timed out while its GPU was busy: not checked yet/.test(l))).toBe(true);
    expect(faceRestarts(p)).toBe(0);
    expect(starts(p)).toBe(1);
    expect(p.logs.some((l) => /face jobs go back in line for 5 minutes/.test(l))).toBe(false);
  });
});
