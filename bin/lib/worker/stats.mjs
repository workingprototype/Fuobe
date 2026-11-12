// The PC's live hardware stats in the worker's beat (WorkerBeat.stats in src/lib/relay.ts): its GPU (gpu.mjs
// parseGpuStats, from the same nvidia-smi reading as the busy check), its CPU's load from the CPU times between two
// readings, its memory, and, when worker.json names a sensors file, the CPU and motherboard sensors another program on the
// PC writes there. Read every 5 s with the GPU. No extra process and no admin rights.
import fs from "node:fs";
import os from "node:os";

/** A sensors file older than this (its own `at`) says nothing about now: it is left out. */
export const SENSORS_FRESH_MS = 30_000;
/** A beat carries the last stats only while they are at most this old (the studio judges freshness by when it heard them). */
export const STATS_SEND_MS = 30_000;
/** At most this many motherboard temperatures and fans from the sensors file. */
export const BOARD_MAX = 8;

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const within = (v, lo, hi, digits = 0) => {
  const n = finite(v);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.max(lo, Math.min(hi, Math.round(n * f) / f));
};

/**
 * The CPU times of all cores together (os.cpus()): idle and total, in ms, and how many cores.
 *
 * @param {{ times?: { user?: number; nice?: number; sys?: number; idle?: number; irq?: number } }[]} [cpus]
 */
export function cpuTimes(cpus = os.cpus()) {
  let idle = 0;
  let total = 0;
  for (const c of cpus ?? []) {
    const t = c?.times ?? {};
    const parts = [t.user, t.nice, t.sys, t.idle, t.irq].map((x) => finite(x) ?? 0);
    idle += finite(t.idle) ?? 0;
    total += parts.reduce((a, b) => a + b, 0);
  }
  return { idle, total, cores: (cpus ?? []).length };
}

/** How busy the CPU was between two cpuTimes readings (0-100, whole), or null without two readings that moved forward. */
export function cpuBusyPct(prev, next) {
  if (!prev || !next) return null;
  const dt = next.total - prev.total;
  const di = next.idle - prev.idle;
  if (!(dt > 0) || di < 0 || di > dt) return null;
  return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
}

/** Keeps the last CPU times: each read gives the load since the one before (the first one says null). */
export class CpuMeter {
  constructor(read = () => cpuTimes()) {
    this.readTimes = read;
    this.prev = null;
  }

  read() {
    let next;
    try {
      next = this.readTimes();
    } catch {
      return { busyPct: null, cores: null };
    }
    const busyPct = cpuBusyPct(this.prev, next);
    this.prev = next;
    return { busyPct, cores: next?.cores > 0 ? next.cores : null };
  }
}

/** The PC's memory in MB: used (total less free) and total. Null when it can't say. */
export function ramNow(total = os.totalmem(), free = os.freemem()) {
  const t = finite(total);
  const f = finite(free);
  if (t === null || t <= 0 || f === null) return { usedMb: null, totalMb: null };
  const mb = 2 ** 20;
  return { usedMb: Math.round(Math.max(0, Math.min(t, t - f)) / mb), totalMb: Math.round(t / mb) };
}

/** A sensor's name: printable, short, no markup characters. Null when nothing is left. */
export function sensorName(v) {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[^\w .:#()+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return s || null;
}

/**
 * The sensors file's readings worth sending, or null when there is none to send: no file, a file being written (not
 * whole JSON yet), one without a time, or one older than SENSORS_FRESH_MS. A byte order mark at its start is fine.
 * Values are clamped; a missing one is left out.
 *
 * File: { at: ISO time, cpu: { packageC, coreMaxC, powerW, clockMhz, vcoreV, ... }, board: { tempsC: [{ name, c }],
 * fansRpm: [{ name, rpm }] } }.
 */
export function readSensors(file, now = Date.now(), read = (p) => fs.readFileSync(p, "utf8")) {
  if (!file) return null;
  let raw;
  try {
    raw = JSON.parse(String(read(file)).replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const at = typeof raw.at === "string" ? Date.parse(raw.at) : NaN;
  if (!Number.isFinite(at) || Math.abs(now - at) > SENSORS_FRESH_MS) return null;
  const cpu = raw.cpu && typeof raw.cpu === "object" ? raw.cpu : {};
  const board = raw.board && typeof raw.board === "object" ? raw.board : {};
  const out = {};
  const temp = within(cpu.packageC, -50, 150) ?? within(cpu.coreMaxC, -50, 150);
  if (temp !== null) out.cpuTempC = temp;
  const power = within(cpu.powerW, 0, 2000);
  if (power !== null) out.cpuPowerW = power;
  const clock = within(cpu.clockMhz, 0, 20_000);
  if (clock !== null) out.cpuClockMhz = clock;
  const vcore = within(cpu.vcoreV, 0, 3, 3);
  if (vcore !== null) out.vcoreV = vcore;
  const list = (v) => (Array.isArray(v) ? v : []);
  const temps = list(board.tempsC)
    .map((t) => ({ name: sensorName(t?.name), c: within(t?.c, -50, 150) }))
    .filter((t) => t.name && t.c !== null)
    .slice(0, BOARD_MAX);
  const fans = list(board.fansRpm)
    .map((f) => ({ name: sensorName(f?.name), rpm: within(f?.rpm, 0, 30_000) }))
    .filter((f) => f.name && f.rpm !== null)
    .slice(0, BOARD_MAX);
  if (temps.length || fans.length) out.board = { temps, fans };
  return Object.keys(out).length ? out : null;
}

/**
 * The beat's `stats`: when it was read (this PC's clock), the GPU (null: no NVIDIA GPU, or no reading), the CPU's load
 * and cores, the memory, and the sensors file's readings when there are fresh ones.
 */
export function statsOf({ at, gpu, cpu, ram, sensors }) {
  return {
    at,
    gpu: gpu ?? null,
    cpuPct: cpu?.busyPct ?? null,
    cpuCores: cpu?.cores ?? null,
    ramUsedMb: ram?.usedMb ?? null,
    ramTotalMb: ram?.totalMb ?? null,
    ...(sensors ?? {}),
  };
}
