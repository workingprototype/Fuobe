/**
 * The worker PC's live hardware stats (bin/lib/worker/gpu.mjs parseGpuStats, bin/lib/worker/stats.mjs): the GPU line from
 * nvidia-smi, the CPU's load from CPU times, the memory, and the optional sensors file. Never a real GPU.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GPU_FIELDS, parseGpu, parseGpuStats, readGpu } from "../bin/lib/worker/gpu.mjs";
import { CpuMeter, cpuBusyPct, cpuTimes, ramNow, readSensors, sensorName, SENSORS_FRESH_MS, statsOf } from "../bin/lib/worker/stats.mjs";
import { tempDir } from "./helpers/temp-dir";

const FAKE_SMI = path.resolve(__dirname, "helpers/fake-nvidia-smi.mjs");

describe("the GPU's live stats from nvidia-smi", () => {
  it("asks for every field in one query, the busy check's three first", () => {
    expect(GPU_FIELDS.split(",")).toEqual(["memory.used", "temperature.gpu", "utilization.gpu", "power.draw", "power.limit", "clocks.gr", "clocks.mem", "memory.total", "fan.speed", "pstate"]);
  });

  it("reads a whole line, whole numbers", () => {
    const line = "19714, 40.04, 100, 566.97, 575.00, 2602, 13801, 32607, 30, P1\n";
    expect(parseGpuStats(line)).toEqual({ busyPct: 100, tempC: 40, powerW: 567, powerLimitW: 575, coreMHz: 2602, memMHz: 13801, vramUsedMb: 19714, vramTotalMb: 32607, fanPct: 30, pstate: "P1" });
    // The busy check reads the same line as before.
    expect(parseGpu(line)).toEqual({ usedMb: 19714, tempC: 40.04, busyPct: 100 });
  });

  it("[N/A] and [Not Supported] fields are null, never 0", () => {
    expect(parseGpuStats("6144, 61, 12, [N/A], [Not Supported], 1800, , 24576, [N/A], [N/A]")).toEqual({
      busyPct: 12,
      tempC: 61,
      powerW: null,
      powerLimitW: null,
      coreMHz: 1800,
      memMHz: null,
      vramUsedMb: 6144,
      vramTotalMb: 24576,
      fanPct: null,
      pstate: null,
    });
    // A line from an older query (three fields): the rest are null.
    expect(parseGpuStats("900, 50, 97")).toMatchObject({ vramUsedMb: 900, busyPct: 97, powerW: null, pstate: null });
    // No memory reading, no line: nothing.
    expect(parseGpuStats("[N/A], 50, 97")).toBeNull();
    expect(parseGpuStats("")).toBeNull();
  });

  it("clamps what is out of range", () => {
    expect(parseGpuStats("-5, 400, 180, 99999, -3, 1e9, 70000, 2e7, 140, P99")).toEqual({
      busyPct: 100,
      tempC: 150,
      powerW: 5000,
      powerLimitW: 0,
      coreMHz: 20000,
      memMHz: 50000,
      vramUsedMb: 0,
      vramTotalMb: 1000000,
      fanPct: 100,
      pstate: "P99",
    });
    expect(parseGpuStats("1, 1, 1, 1, 1, 1, 1, 1, 1, <b>")?.pstate).toBeNull();
  });

  it("flags a high power reading while the card idles, and keeps the reading", () => {
    // P8 with 255 W: an idle card that reports far too much.
    expect(parseGpuStats("1200, 62, 0, 255.3, 575, 210, 405, 32607, 0, P8")).toMatchObject({ powerW: 255, powerSuspect: true });
    // Not P8, but under 5% busy and under 50 °C.
    expect(parseGpuStats("1200, 41, 3, 160, 575, 210, 405, 32607, 0, P2")).toMatchObject({ powerW: 160, powerSuspect: true });
    // Busy, or warm, or a plausible draw: no flag.
    expect(parseGpuStats("1200, 41, 90, 560, 575, 2600, 13801, 32607, 30, P1")).not.toHaveProperty("powerSuspect");
    expect(parseGpuStats("1200, 55, 2, 160, 575, 210, 405, 32607, 0, P2")).not.toHaveProperty("powerSuspect");
    expect(parseGpuStats("1200, 30, 0, 30, 575, 210, 405, 32607, 0, P8")).not.toHaveProperty("powerSuspect");
    expect(parseGpuStats("1200, 30, 0, 150, 575, 210, 405, 32607, 0, P8")).not.toHaveProperty("powerSuspect");
  });

  it("readGpu gives the stats beside the busy check's reading", async () => {
    const dir = tempDir("fuobe-worker-stats-smi-");
    const state = path.join(dir, "state.json");
    fs.writeFileSync(state, JSON.stringify({ usedMb: 19714, tempC: 40, busyPct: 100, statsLine: "19714, 40, 100, 566.97, 575.00, 2602, 13801, 32607, 30, P1", apps: [{ pid: 7, name: "python.exe", usedMb: null }] }));
    const r = await readGpu([process.execPath, FAKE_SMI, state]);
    expect(r).toMatchObject({ usedMb: 19714, busyPct: 100, apps: [{ pid: 7, name: "python.exe", usedMb: null }] });
    expect(r?.stats).toMatchObject({ powerW: 567, powerLimitW: 575, coreMHz: 2602, memMHz: 13801, vramTotalMb: 32607, fanPct: 30, pstate: "P1" });
  });

  it("an nvidia-smi that refuses a field: the short query keeps the busy check working", async () => {
    const dir = tempDir("fuobe-worker-stats-smi-old-");
    const state = path.join(dir, "state.json");
    fs.writeFileSync(state, JSON.stringify({ usedMb: 5000, tempC: 60, busyPct: 40, refuseFull: true }));
    const r = await readGpu([process.execPath, FAKE_SMI, state]);
    expect(r).toMatchObject({ usedMb: 5000, tempC: 60, busyPct: 40, apps: [] });
    expect(r?.stats).toMatchObject({ vramUsedMb: 5000, busyPct: 40, tempC: 60, powerW: null });
    // The next reading asks the short query at once.
    const again = await readGpu([process.execPath, FAKE_SMI, state]);
    expect(again?.usedMb).toBe(5000);
  });
});

describe("the CPU's load and the memory", () => {
  const cpu = (user: number, idle: number) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });

  it("CPU load is the busy share of the CPU time between two readings", () => {
    const a = cpuTimes([cpu(1000, 9000), cpu(1000, 9000)]);
    expect(a).toEqual({ idle: 18000, total: 20000, cores: 2 });
    // 1000 ms more busy and 3000 ms more idle in all: 25% busy.
    const b = cpuTimes([cpu(1500, 10500), cpu(1500, 10500)]);
    expect(cpuBusyPct(a, b)).toBe(25);
    // Nothing moved, a counter that went back, no first reading: unknown.
    expect(cpuBusyPct(a, a)).toBeNull();
    expect(cpuBusyPct(b, a)).toBeNull();
    expect(cpuBusyPct(null, a)).toBeNull();
    // All busy, all idle.
    expect(cpuBusyPct(a, cpuTimes([cpu(2000, 9000), cpu(2000, 9000)]))).toBe(100);
    expect(cpuBusyPct(a, cpuTimes([cpu(1000, 10000), cpu(1000, 10000)]))).toBe(0);
  });

  it("the meter says null first, then the load since its last reading", () => {
    const readings = [cpuTimes([cpu(0, 0)]), cpuTimes([cpu(600, 400)]), cpuTimes([cpu(700, 1300)])];
    const m = new CpuMeter(() => readings.shift()!);
    expect(m.read()).toEqual({ busyPct: null, cores: 1 });
    expect(m.read()).toEqual({ busyPct: 60, cores: 1 });
    expect(m.read()).toEqual({ busyPct: 10, cores: 1 });
    // A failing read says unknown and doesn't throw.
    expect(new CpuMeter(() => { throw new Error("no"); }).read()).toEqual({ busyPct: null, cores: null });
    // The real one works here.
    const real = new CpuMeter();
    expect(real.read().cores).toBeGreaterThan(0);
  });

  it("memory used is total less free, in MB", () => {
    expect(ramNow(32 * 2 ** 30, 8 * 2 ** 30)).toEqual({ usedMb: 24576, totalMb: 32768 });
    expect(ramNow(0, 0)).toEqual({ usedMb: null, totalMb: null });
    expect(ramNow(2 ** 30, 2 * 2 ** 30)).toEqual({ usedMb: 0, totalMb: 1024 });
    expect(ramNow().totalMb).toBeGreaterThan(0);
  });
});

describe("the sensors file", () => {
  const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const FULL = {
    at: iso(NOW - 4000),
    cpu: { name: "AMD Ryzen 9 9950X3D", packageC: 71.6, coreMaxC: 78, coreAvgC: 66, powerW: 142.4, loadPct: 37, clockMhz: 5420.5, vcoreV: 1.2345 },
    board: {
      name: "X870E",
      tempsC: [{ name: "System", c: 38.2 }, { name: "VRM MOS", c: 51 }, { name: "<script>", c: 40 }, { name: "Chipset", c: null }],
      fansRpm: [{ name: "CPU Fan", rpm: 1180.4 }, { name: "Pump", rpm: 2400 }],
    },
  };
  const from = (v: unknown) => () => (typeof v === "string" ? v : JSON.stringify(v));

  it("a fresh file gives the CPU temperature, power, clock, Vcore and the board's sensors", () => {
    expect(readSensors("C:/x/sensors.json", NOW, from(FULL))).toEqual({
      cpuTempC: 72,
      cpuPowerW: 142,
      cpuClockMhz: 5421,
      vcoreV: 1.235,
      board: { temps: [{ name: "System", c: 38 }, { name: "VRM MOS", c: 51 }, { name: "script", c: 40 }], fans: [{ name: "CPU Fan", rpm: 1180 }, { name: "Pump", rpm: 2400 }] },
    });
  });

  it("the hottest core when there is no package temperature", () => {
    expect(readSensors("f", NOW, from({ at: iso(NOW), cpu: { coreMaxC: 81 } }))).toEqual({ cpuTempC: 81 });
  });

  it("a stale file, a file with no time, or nothing worth sending: nothing", () => {
    expect(readSensors("f", NOW, from({ ...FULL, at: iso(NOW - SENSORS_FRESH_MS - 1000) }))).toBeNull();
    expect(readSensors("f", NOW, from({ ...FULL, at: iso(NOW + SENSORS_FRESH_MS + 1000) }))).toBeNull();
    expect(readSensors("f", NOW, from({ ...FULL, at: undefined }))).toBeNull();
    expect(readSensors("f", NOW, from({ ...FULL, at: "yesterday" }))).toBeNull();
    expect(readSensors("f", NOW, from({ at: iso(NOW), cpu: { packageC: null } }))).toBeNull();
    expect(readSensors("f", NOW, from([1, 2]))).toBeNull();
  });

  it("no file named, a missing file, a half-written one: nothing, and no error", () => {
    expect(readSensors(null, NOW)).toBeNull();
    expect(readSensors(path.join(tempDir("fuobe-sensors-none-"), "sensors.json"), NOW)).toBeNull();
    const half = JSON.stringify(FULL).slice(0, 60);
    expect(readSensors("f", NOW, from(half))).toBeNull();
    expect(readSensors("f", NOW, from(""))).toBeNull();
  });

  it("a byte order mark at the start is fine (a real file on disk)", () => {
    const file = path.join(tempDir("fuobe-sensors-bom-"), "sensors.json");
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ ...FULL, at: new Date().toISOString() })}`, "utf8");
    expect(readSensors(file)).toMatchObject({ cpuTempC: 72, vcoreV: 1.235 });
  });

  it("clamps values and keeps at most 8 temperatures and 8 fans with short names", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Sensor ${i} ${"x".repeat(60)}`, c: 500, rpm: -10 }));
    const r = readSensors("f", NOW, from({ at: iso(NOW), cpu: { packageC: -400, powerW: 1e9, clockMhz: -1, vcoreV: 9 }, board: { tempsC: many, fansRpm: many } }));
    expect(r).toMatchObject({ cpuTempC: -50, cpuPowerW: 2000, cpuClockMhz: 0, vcoreV: 3 });
    expect(r?.board?.temps).toHaveLength(8);
    expect(r?.board?.fans).toHaveLength(8);
    expect(r?.board?.temps[0]).toEqual({ name: expect.stringMatching(/^Sensor 0 x+$/), c: 150 });
    expect(r?.board?.temps[0]?.name?.length).toBeLessThanOrEqual(32);
    expect(r?.board?.fans[0].rpm).toBe(0);
    expect(sensorName("  \u0000\u001b[31mCPU ")).toBe("31mCPU");
    expect(sensorName(" \u0000\u001b<> ")).toBeNull();
    expect(sensorName(42)).toBeNull();
  });
});

describe("the beat's stats", () => {
  it("puts the GPU, CPU, memory and sensors together", () => {
    const gpu = parseGpuStats("1200, 62, 0, 255, 575, 210, 405, 32607, 0, P8");
    expect(statsOf({ at: 5, gpu, cpu: { busyPct: 12, cores: 32 }, ram: { usedMb: 20000, totalMb: 65536 }, sensors: { cpuTempC: 70 } })).toEqual({
      at: 5,
      gpu,
      cpuPct: 12,
      cpuCores: 32,
      ramUsedMb: 20000,
      ramTotalMb: 65536,
      cpuTempC: 70,
    });
    // No GPU, no sensors: the rest still goes.
    expect(statsOf({ at: 5, gpu: null, cpu: { busyPct: null, cores: 8 }, ram: { usedMb: 1, totalMb: 2 }, sensors: null })).toEqual({ at: 5, gpu: null, cpuPct: null, cpuCores: 8, ramUsedMb: 1, ramTotalMb: 2 });
  });
});
