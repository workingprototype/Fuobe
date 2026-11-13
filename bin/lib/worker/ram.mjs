// The RAM guard (docs/gpu-workers.md "This PC's memory"): for a PC whose owner also works on it. The owner switches it on
// for one worker in Settings → Workers (the beat's answer, `worker.ramGuard`; off by default). worker.json `ramGuard`
// holds only its numbers: { othersGb (12), everyS (10) }. Other programs' RAM is the PC's used memory less what the
// worker's own processes hold: the worker itself, its ComfyUI, its CPU slot's ComfyUI, its text slot's server and
// anything they started. Above `othersGb`:
//
// - its claims ask for no job that streams its weights from RAM (`noStream`). That is a preference: the studio still gives
//   it such a job when no other worker could take that job now, so nobody waits for it;
// - its own ComfyUI lets go of its memory (its /free: models unloaded, caches emptied) before each GPU job and when it
//   goes idle. Nothing pauses or stops: it keeps taking work, its text slot goes on, and a job in hand is never stopped
//   for RAM (the studio's fallback after running out of memory covers a real shortage).
//
// One reading every `everyS` seconds: one PowerShell call on Windows (Win32_Process: each process's id, parent, working
// set, private bytes and name), `ps` elsewhere. No admin rights: a process of another user may read 0, and counts then
// only in the total.
import { execFile } from "node:child_process";

const MB = 2 ** 20;

/** Every process as one line: id, parent id, working set, private bytes, name (tab-separated). No double quotes. */
export const PROCS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,Name | ForEach-Object { ($_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $_.PrivatePageCount, $_.Name) -join [char]9 }",
].join("; ");

/** `ps` elsewhere: id, parent id, resident KB, name. */
export const PS_ARGS = ["-A", "-o", "pid=,ppid=,rss=,comm="];

/** The guard's defaults: other programs' GB of the PC's memory (its line), and seconds between two readings. */
export const RAM_OTHERS_GB = 12;
export const RAM_EVERY_S = 10;

/** A reading that failed: the last good one stands in for this long, then the guard counts the memory as free. */
export const RAM_REUSE_MS = 60_000;

/** The largest other process is named only from this size (MB): smaller ones say "other programs". */
export const NAME_FROM_MB = 256;

/** Windows' own memory, never named as the program that uses the PC's memory. */
const SYSTEM = new Set(["system", "secure system", "registry", "memory compression", "system idle process", "svchost", "msmpeng", "mssense", "csrss", "smss", "wininit", "services", "lsass", "dwm", "wudfhost", "fontdrvhost"]);

const int = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * worker.json's `ramGuard` → its numbers { othersMb, everyMs }. Not set (or null, false): the defaults. `othersGb`: the
 * line (GB, more than 0; 12 by default); `everyS`: seconds between two readings (5 to 60; 10 by default). A value it
 * can't use keeps its default and adds `problem`. Whether the guard runs is the site's switch, never this.
 */
export function ramGuardOf(v) {
  const out = { othersMb: Math.round(RAM_OTHERS_GB * 1024), everyMs: RAM_EVERY_S * 1000 };
  if (v === undefined || v === null || v === false) return out;
  if (typeof v !== "object" || Array.isArray(v)) return { ...out, problem: "ramGuard in worker.json isn't { othersGb, everyS }" };
  const problems = [];
  if (v.othersGb !== undefined) {
    const gb = Number(v.othersGb);
    if (gb > 0 && gb <= 4096) out.othersMb = Math.round(gb * 1024);
    else problems.push("ramGuard.othersGb in worker.json isn't a number of GB above 0");
  }
  if (v.everyS !== undefined) {
    const every = Number(v.everyS);
    if (every >= 5 && every <= 60) out.everyMs = Math.round(every * 1000);
    else problems.push("ramGuard.everyS in worker.json isn't 5 to 60 seconds");
  }
  return problems.length ? { ...out, problem: problems.join("; ") } : out;
}

/**
 * The process list → [{ pid, ppid, mb, name }], or null when it holds none. Windows lines (PROCS_SCRIPT): `mb` is the
 * larger of the working set and the private bytes. `ps` lines: the resident size.
 */
export function parseProcs(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.includes("\t")) {
      const [pid, ppid, ws, priv, ...name] = line.split("\t");
      const p = int(pid);
      if (!p) continue;
      out.push({ pid: p, ppid: int(ppid) ?? 0, mb: Math.max(int(ws) ?? 0, int(priv) ?? 0) / MB, name: name.join("\t").trim().slice(0, 64) || "?" });
      continue;
    }
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), mb: Number(m[3]) / 1024, name: m[4].split("/").pop().slice(0, 64) });
  }
  return out.length ? out : null;
}

const run = (cmd, args, timeout) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * MB }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

/** One reading of every process, or null when it can't be read. `powershell`: worker.json's, as for the port table. */
export async function readProcs(powershell) {
  if (process.platform === "win32" || Array.isArray(powershell)) {
    const list = Array.isArray(powershell) ? powershell : powershell ? [powershell] : ["powershell"];
    return parseProcs(await run(String(list[0]), [...list.slice(1).map(String), "-NoProfile", "-NonInteractive", "-Command", PROCS_SCRIPT], 15_000));
  }
  return parseProcs(await run("ps", PS_ARGS, 10_000));
}

/** The processes in the trees under `roots` (the roots too, when they are listed): the worker's own. */
export function ownPids(procs, roots) {
  const kids = new Map();
  for (const p of procs) {
    if (p.ppid === p.pid) continue;
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  const mine = new Set();
  const todo = roots.filter((r) => Number.isInteger(r) && r > 0);
  while (todo.length) {
    const pid = todo.pop();
    if (mine.has(pid)) continue;
    mine.add(pid);
    for (const k of kids.get(pid) ?? []) todo.push(k);
  }
  return mine;
}

/**
 * Other programs' RAM: { othersMb, ownMb, who }. `usedMb`: the PC's used memory (stats.mjs ramNow); `roots`: the worker's
 * own process ids (itself, its ComfyUIs, its text slot's server). `who`: the largest other process from NAME_FROM_MB,
 * not one of Windows' own, else null.
 */
export function ramSplit(usedMb, procs, roots) {
  const mine = ownPids(procs, roots);
  let ownMb = 0;
  let top = null;
  for (const p of procs) {
    if (mine.has(p.pid)) ownMb += p.mb;
    else if (p.mb >= NAME_FROM_MB && !SYSTEM.has(p.name.toLowerCase().replace(/\.exe$/, "")) && (!top || p.mb > top.mb)) top = p;
  }
  return { othersMb: Math.max(0, Math.round(usedMb - ownMb)), ownMb: Math.round(ownMb), who: top?.name ?? null };
}

/**
 * The guard's state from each reading (`update`): `over` says the last reading was above the line (its claims ask for no
 * streamed job, and its ComfyUI lets go of its memory before each GPU job and when idle); `who`, the largest other
 * program then. A reading of null (none for RAM_REUSE_MS) counts as under the line: a guard that can't read the memory
 * never changes how the worker works.
 */
export class RamWatch {
  constructor(o) {
    this.o = o;
    this.over = false;
    this.who = null;
    this.othersMb = null;
  }

  update(reading) {
    if (reading) this.othersMb = reading.othersMb;
    this.over = !!reading && reading.othersMb > this.o.othersMb;
    this.who = this.over ? (reading.who ?? null) : null;
  }

  /** The site's switch went off: as under the line. */
  clear() {
    this.over = false;
    this.who = null;
  }
}
