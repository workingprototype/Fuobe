// The RAM guard (worker.json `ramGuard`, docs/gpu-workers.md "This PC's memory"): for a PC whose owner also works on
// it. Off unless worker.json sets it. Other programs' RAM is the PC's used memory less what the worker's own processes
// hold: the worker itself, its ComfyUI, its CPU slot's ComfyUI, its text slot's server and anything they started. Above
// the guard's line:
//
// - its claims ask for no job that streams its weights from RAM (`noStream`): the studio offers it only jobs whose
//   weights fit whole on its card, and leaves the others for another worker;
// - after `afterS` seconds above the line with no GPU job of its own, it pauses ("ram-busy:<program>"), as for a busy
//   GPU, and resumes by the same automatic resume (`autoResume`, `resumeAfterMin`). A job it runs is never stopped for
//   RAM alone: the studio's fallback after running out of memory covers a real shortage.
//
// One reading every `everyS` seconds (10): one PowerShell call on Windows (Win32_Process: each process's id, parent,
// working set, private bytes and name), `ps` elsewhere. No admin rights: a process of another user may read 0, and
// counts then only in the total.
import { execFile } from "node:child_process";

const MB = 2 ** 20;

/** Every process as one line: id, parent id, working set, private bytes, name (tab-separated). No double quotes. */
export const PROCS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,Name | ForEach-Object { ($_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $_.PrivatePageCount, $_.Name) -join [char]9 }",
].join("; ");

/** `ps` elsewhere: id, parent id, resident KB, name. */
export const PS_ARGS = ["-A", "-o", "pid=,ppid=,rss=,comm="];

/** The guard's defaults: seconds above the line before it pauses, and seconds between two readings. */
export const RAM_AFTER_S = 60;
export const RAM_EVERY_S = 10;

/** A reading that failed: the last good one stands in for this long, then the guard says nothing (never a pause). */
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
 * worker.json's `ramGuard` → { othersMb, afterMs, everyMs }, null when it is off (not set, null or false), or
 * { problem } when it can't be used. `othersGb`: the line (GB, more than 0); `afterS` (10 to 3600, 60 by default);
 * `everyS` (5 to 60, 10 by default).
 */
export function ramGuardOf(v) {
  if (v === undefined || v === null || v === false) return null;
  if (typeof v !== "object" || Array.isArray(v)) return { problem: "ramGuard in worker.json isn't { othersGb, afterS }" };
  const gb = Number(v.othersGb);
  if (!(gb > 0) || gb > 4096) return { problem: "ramGuard.othersGb in worker.json isn't a number of GB above 0" };
  const after = v.afterS === undefined ? RAM_AFTER_S : Number(v.afterS);
  if (!(after >= 10 && after <= 3600)) return { problem: "ramGuard.afterS in worker.json isn't 10 to 3600 seconds" };
  const every = v.everyS === undefined ? RAM_EVERY_S : Number(v.everyS);
  if (!(every >= 5 && every <= 60)) return { problem: "ramGuard.everyS in worker.json isn't 5 to 60 seconds" };
  return { othersMb: Math.round(gb * 1024), afterMs: Math.round(after * 1000), everyMs: Math.round(every * 1000) };
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
 * The guard's pause and resume. `update` takes each reading: `over` says the last reading was above the line (its
 * claims ask for no streamed job), and `paused` whether the guard keeps the worker paused. It pauses once readings stayed
 * above the line for `afterMs` with no GPU job of its own (`job`: the time above the line counts from its job's end).
 * With `autoResume`, it resumes once readings stayed under the line for `resumeAfterMs`; without it, only `clear()` (a
 * resume by hand) ends it. A reading of null (none for RAM_REUSE_MS) counts as under the line: a guard that can't read
 * the memory never keeps the worker from people's jobs.
 */
export class RamWatch {
  constructor(o) {
    this.o = o;
    this.over = false;
    this.paused = false;
    this.who = null;
    this.othersMb = null;
    this.overSince = null;
    this.freeSince = null;
  }

  update(reading, job, now) {
    if (reading) this.othersMb = reading.othersMb;
    if (reading && reading.othersMb > this.o.othersMb) {
      this.over = true;
      this.freeSince = null;
      this.overSince = job ? null : (this.overSince ?? now);
      if (this.paused || (this.overSince !== null && now - this.overSince >= this.o.afterMs)) {
        this.paused = true;
        this.who = reading.who ?? this.who;
      }
      return;
    }
    this.over = false;
    this.overSince = null;
    this.freeSince ??= now;
    if (this.paused && this.o.autoResume && now - this.freeSince >= this.o.resumeAfterMs) {
      this.paused = false;
      this.who = null;
    }
  }

  /** A resume by hand clears it too. */
  clear() {
    this.paused = false;
    this.who = null;
    this.overSince = null;
  }
}
