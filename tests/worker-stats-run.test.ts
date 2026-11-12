/**
 * The worker PC's live hardware stats end to end: the worker program (bin/lib/worker/run.mjs) reads them with its GPU
 * reading and sends them in its beat, the studio keeps the newest per worker with its own receive time, and the admin
 * workers API shows them. Its readings are stand-ins: never a real GPU, never a real ComfyUI job.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { parseGpuStats } from "../bin/lib/worker/gpu.mjs";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-worker-stats-run-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const admin = await import("@/server/admin-tokens");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { ComputerRunner } = await import("@/lib/computer-runner");
const workersRoute = await import("@/app/api/admin/workers/route");
const beatRoute = await import("@/app/api/gpu/computer/beat/route");

const SITE = "http://127.0.0.1:9";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LINE = "1200, 62, 0, 255.3, 575, 210, 405, 32607, 0, P8";

let routes: ComputerRoutes;
let adminToken = "";
beforeAll(async () => {
  routes = await loadRoutes();
  adminToken = admin.createAdminToken({ name: "stats reader", scopes: ["workers:read"] }).token;
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
});

const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

const adminWorkers = async () => {
  const res = await workersRoute.GET(new NextRequest("http://localhost:3000/api/admin/workers", { headers: { authorization: `Bearer ${adminToken}` } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { workers: { id: string; stats: Record<string, unknown> | null }[] }).workers;
};

async function until<T>(fn: () => T | Promise<T>, ms = 30_000): Promise<Exclude<T, false | null | undefined>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined>;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(50);
  }
}

describe("live hardware stats from the worker to the admin API", () => {
  it("the worker sends them in its beat, the studio keeps them with its receive time, the API shows them", async () => {
    // A worker the owner keeps paused on the website: it only beats.
    const w = pool.addWorker("stats-pc");
    const home = tempDir("fuobe-worker-stats-home-");
    const sensors = path.join(home, "sensors.json");
    fs.writeFileSync(sensors, `﻿${JSON.stringify({ at: new Date().toISOString(), cpu: { packageC: 68.4, powerW: 120, clockMhz: 5300, vcoreV: 1.21 }, board: { tempsC: [{ name: "VRM", c: 49 }], fansRpm: [{ name: "Pump", rpm: 2400 }] } })}`);
    const beats: Record<string, unknown>[] = [];
    const api = apiAs(routes, null);
    let cpuTick = 0;
    const ctrl = new AbortController();
    const done = runWorker(
      { site: SITE, token: w.token, comfyDir: path.join(home, "comfy"), workDir: path.join(home, "work"), modelDirs: [], comfyCommand: [process.execPath, "-e", "setTimeout(()=>{},60000)"], ffmpeg: null, sensorsFile: sensors },
      {
        fetch: async (url: string, init: RequestInit = {}) => {
          const u = new URL(url);
          if (u.pathname === "/api/gpu/computer/beat" && typeof init.body === "string") beats.push(JSON.parse(init.body));
          return api(u.pathname + u.search, init);
        },
        home,
        signal: ctrl.signal,
        requirements: { folders: [], files: {}, packs: {}, workflows: {} },
        ComputerRunner,
        rules: {},
        pins: {},
        allowed: new Set<string>(),
        readGpu: async () => ({ usedMb: 1200, tempC: 62, busyPct: 0, apps: [], stats: parseGpuStats(LINE) }),
        readGpuGen: async () => "12.0",
        gpuEveryMs: 50,
        // Two cores: 40% busy between readings.
        cpuTimes: () => {
          cpuTick++;
          return { idle: cpuTick * 600, total: cpuTick * 1000, cores: 2 };
        },
        ramNow: () => ({ usedMb: 40_000, totalMb: 65_536 }),
        ffmpegVersion: async () => null,
        awake: { set: () => {} },
        sleep: (ms: number) => sleep(Math.min(ms, 50)),
        log: () => {},
        catalogVersion: "0".repeat(64),
        allLanes: () => [],
      },
    );
    running.push({ ctrl, done });

    // A beat with the stats, its CPU load known (the second reading on).
    const sent = await until(() => beats.find((b) => (b.stats as { cpuPct?: number } | undefined)?.cpuPct === 40));
    expect(sent.stats).toMatchObject({
      gpu: { busyPct: 0, tempC: 62, powerW: 255, powerLimitW: 575, powerSuspect: true, coreMHz: 210, memMHz: 405, vramUsedMb: 1200, vramTotalMb: 32607, fanPct: 0, pstate: "P8" },
      cpuPct: 40,
      cpuCores: 2,
      ramUsedMb: 40_000,
      ramTotalMb: 65_536,
      cpuTempC: 68,
      cpuPowerW: 120,
      cpuClockMhz: 5300,
      vcoreV: 1.21,
      board: { temps: [{ name: "VRM", c: 49 }], fans: [{ name: "Pump", rpm: 2400 }] },
    });
    expect(typeof (sent.stats as { at: number }).at).toBe("number");

    // The studio kept the newest, with its own receive time, and the admin API shows them.
    const view = await until(async () => (await adminWorkers()).find((x) => x.id === w.id && (x.stats as { cpuPct?: number } | null)?.cpuPct === 40));
    expect(view.stats).toMatchObject({ gpu: { powerW: 255, powerSuspect: true, pstate: "P8" }, ramTotalMb: 65_536, cpuTempC: 68, board: { fans: [{ name: "Pump", rpm: 2400 }] } });
    expect(Math.abs(Date.now() - (view.stats!.receivedAt as number))).toBeLessThan(30_000);
  });

  it("the studio cleans what a beat says and an older worker's beat leaves none", async () => {
    const w = pool.addWorker("stats-clean");
    const headers = { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" };
    const post = (body: unknown) => beatRoute.POST(new Request("http://localhost:3000/api/gpu/computer/beat", { method: "POST", headers, body: JSON.stringify(body) }));
    const base = { device: `wkr-${w.id}`, protocol: 2, version: "1", local: { paused: false, why: null, until: null }, gpu: { otherApps: [], tempC: 60 }, inventoryHash: null, running: [], stopped: [] };
    const res = await post({
      ...base,
      stats: {
        at: 1234,
        gpu: { busyPct: 250, tempC: 61.4, powerW: "lots", powerLimitW: 575, coreMHz: 2600, memMHz: 13800, vramUsedMb: 900, vramTotalMb: 32607, fanPct: 30, pstate: "<P1>", extra: "dropped" },
        cpuPct: 33,
        cpuCores: 32,
        ramUsedMb: 1000,
        ramTotalMb: 2000,
        cpuTempC: 999,
        vcoreV: 1.23456,
        board: { temps: Array.from({ length: 12 }, (_, i) => ({ name: `T${i}<b>`, c: 40 })), fans: [{ name: "", rpm: 1 }] },
        disks: [{ drive: "C", freeBytes: 5e10, totalBytes: 1e12 }, { drive: "../etc", freeBytes: 1, totalBytes: 1 }],
        secret: "never kept",
      },
    });
    expect(res.status).toBe(200);
    const kept = pool.workerStatsOf(workers.getWorker(w.id)!)!;
    expect(kept).toMatchObject({
      at: 1234,
      gpu: { busyPct: 100, tempC: 61, powerW: null, powerLimitW: 575, pstate: null },
      cpuPct: 33,
      cpuTempC: 150,
      vcoreV: 1.235,
      disks: [{ drive: "C", freeBytes: 5e10, totalBytes: 1e12 }],
    });
    expect(kept.gpu).not.toHaveProperty("extra");
    expect(kept).not.toHaveProperty("secret");
    expect(kept.board?.temps).toHaveLength(8);
    expect(kept.board?.temps[0].name).toBe("T0 b");
    expect(kept.board?.fans).toEqual([]);
    expect(typeof kept.receivedAt).toBe("number");

    // A beat without stats (an older worker program): nothing old stays.
    expect((await post(base)).status).toBe(200);
    expect(pool.workerStatsOf(workers.getWorker(w.id)!)).toBeNull();
    expect((await adminWorkers()).find((x) => x.id === w.id)?.stats).toBeNull();
    // Stats without a reading time are not kept.
    expect(pool.cleanStats({ gpu: null, cpuPct: 1 })).toBeNull();
    expect(pool.cleanBeat({ ...base, stats: "x" })).not.toHaveProperty("stats");
  });
});
