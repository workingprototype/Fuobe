// "Your GPU is busy": the worker pauses itself the moment another program uses the GPU, and (only when its automatic
// resume is on) resumes by itself once the GPU stayed free for the whole cool-down. It reads nvidia-smi and nothing else:
// it never contacts another program's port (not a ComfyUI on 8188, not any ComfyUI it didn't start). A pause by hand
// always wins: the automatic resume never ends it.
import { execFile } from "node:child_process";

/** Memory a ComfyUI's CUDA context takes beyond what torch reports. */
export const CONTEXT_ALLOWANCE_MB = 600;

/** Busy readings during its own job pause it only once they have lasted this long (the job is kept if they end sooner). */
export const MID_JOB_GRACE_MS = 20_000;
/** A pause whose busy readings ended within this time of its start was brief: its cool-down is BRIEF_COOL_DOWN_MS. */
export const BRIEF_PAUSE_MS = 30_000;
export const BRIEF_COOL_DOWN_MS = 2 * 60_000;
/** At most one shortened cool-down in this time (a program that keeps coming back gets the whole one). */
export const BRIEF_EVERY_MS = 60 * 60_000;

const num = (s) => {
  const v = Number(String(s ?? "").trim());
  return Number.isFinite(v) ? v : null;
};

/**
 * `nvidia-smi --query-gpu=memory.used,temperature.gpu,utilization.gpu[,...] --format=csv,noheader,nounits` → the first
 * GPU. Fields after the third are ignored here (parseGpuStats reads them).
 * `busyPct`: how busy it is (0-100), null when nvidia-smi said nothing there ([N/A], or an answer without it).
 */
export function parseGpu(text) {
  const line = String(text ?? "").split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [used, temp, util] = line.split(",");
  const usedMb = num(used);
  const busy = String(util ?? "").trim() ? num(util) : null;
  return usedMb === null ? null : { usedMb, tempC: num(temp), busyPct: busy === null ? null : Math.max(0, Math.min(100, Math.round(busy))) };
}

/** `--query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`; used_memory is often [N/A] on Windows. */
export function parseApps(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(",").map((p) => p.trim());
      const used = parts.at(-1);
      return { pid: num(parts[0]) ?? 0, name: (parts.slice(1, -1).join(",").split(/[\\/]/).pop() || "?").slice(0, 64), usedMb: num(used) };
    })
    .filter((a) => a.pid > 0);
}

/**
 * What one GPU reading asks nvidia-smi for, in this order: the first three are what the busy check reads (parseGpu), the
 * rest are the live hardware stats (parseGpuStats). One process for all of them. No admin rights.
 */
export const GPU_FIELDS = "memory.used,temperature.gpu,utilization.gpu,power.draw,power.limit,clocks.gr,clocks.mem,memory.total,fan.speed,pstate";
/** The busy check's own fields: the fallback for an nvidia-smi that refuses a field of GPU_FIELDS. */
export const GPU_FIELDS_SHORT = "memory.used,temperature.gpu,utilization.gpu";
/** After a refused GPU_FIELDS query, the short one is used for this long before GPU_FIELDS is tried again. */
export const FULL_QUERY_RETRY_MS = 10 * 60_000;
/** Above this many watts while the GPU idles, its power reading is flagged (`powerSuspect`): some cards report far too much. */
export const IDLE_POWER_SUSPECT_W = 150;

// A field nvidia-smi can't give ("[N/A]", "[Not Supported]", nothing): null, never 0.
const field = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const within = (v, lo, hi) => (v === null ? null : Math.max(lo, Math.min(hi, Math.round(v))));

/**
 * The live hardware stats from a GPU_FIELDS line (the first GPU), or null when there is no line or no memory reading.
 * Every number is whole and clamped; a field nvidia-smi didn't give is null. `powerSuspect`: the card idles (P8, or under
 * 5% busy and under 50 °C) yet says it draws over IDLE_POWER_SUSPECT_W. The reading itself is kept as reported.
 */
export function parseGpuStats(text) {
  const line = String(text ?? "").split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const f = line.split(",");
  const vramUsedMb = within(field(f[0]), 0, 1_000_000);
  if (vramUsedMb === null) return null;
  const ps = String(f[9] ?? "").trim();
  const pstate = /^P\d{1,2}$/.test(ps) ? ps : null;
  const stats = {
    busyPct: within(field(f[2]), 0, 100),
    tempC: within(field(f[1]), -50, 150),
    powerW: within(field(f[3]), 0, 5000),
    powerLimitW: within(field(f[4]), 0, 5000),
    coreMHz: within(field(f[5]), 0, 20_000),
    memMHz: within(field(f[6]), 0, 50_000),
    vramUsedMb,
    vramTotalMb: within(field(f[7]), 0, 1_000_000),
    fanPct: within(field(f[8]), 0, 100),
    pstate,
  };
  const idle = pstate === "P8" || (stats.busyPct !== null && stats.busyPct < 5 && stats.tempC !== null && stats.tempC < 50);
  return idle && stats.powerW !== null && stats.powerW > IDLE_POWER_SUSPECT_W ? { ...stats, powerSuspect: true } : stats;
}

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

/**
 * One reading of the GPU, or null when nvidia-smi isn't there (no NVIDIA GPU: nothing to watch). `cmd`: its path, or a
 * command and its first arguments (["node", "fake-smi.mjs"] in the tests).
 *
 * @param {string | string[]} [cmd]
 */
export async function readGpu(cmd = "nvidia-smi") {
  const [bin, ...pre] = Array.isArray(cmd) ? cmd : [cmd];
  const call = (args) => run(bin, [...pre, ...args]);
  // One query for the busy check and the live stats. An nvidia-smi that refuses one of its fields answers the short one,
  // and the whole one is tried again after FULL_QUERY_RETRY_MS.
  const key = [bin, ...pre].join("\u0000");
  const full = !((shortUntil.get(key) ?? 0) > Date.now());
  let gpu = full ? await call([`--query-gpu=${GPU_FIELDS}`, "--format=csv,noheader,nounits"]) : null;
  if (gpu === null) {
    gpu = await call([`--query-gpu=${GPU_FIELDS_SHORT}`, "--format=csv,noheader,nounits"]);
    if (gpu !== null && full) shortUntil.set(key, Date.now() + FULL_QUERY_RETRY_MS);
  }
  if (gpu === null) return null;
  const g = parseGpu(gpu);
  if (!g) return null;
  const apps = parseApps((await call(["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"])) ?? "");
  return { ...g, apps, stats: parseGpuStats(gpu) };
}

/** The nvidia-smi commands that refused GPU_FIELDS, and until when they get the short query. */
const shortUntil = new Map();

/** The first GPU's memory in MB (`--query-gpu=memory.total`), or null when nvidia-smi can't say. */
export async function readGpuTotal(cmd = "nvidia-smi") {
  const [bin, ...pre] = Array.isArray(cmd) ? cmd : [cmd];
  const line = String((await run(bin, [...pre, "--query-gpu=memory.total", "--format=csv,noheader,nounits"])) ?? "").split(/\r?\n/).find((l) => l.trim());
  return num(line);
}

/** `nvidia-smi --query-gpu=compute_cap --format=csv,noheader` → the first GPU's generation ("8.9"), or null. */
export function parseGpuGen(text) {
  const line = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line && /^\d{1,2}\.\d{1,2}$/.test(line) ? line : null;
}

/**
 * The GPU's generation (its compute capability), or null when nvidia-smi can't say (an older one, or none).
 *
 * @param {string | string[]} [cmd] its path, or a command and its first arguments (as readGpu takes it)
 */
export async function readGpuGen(cmd = "nvidia-smi") {
  const [bin, ...pre] = Array.isArray(cmd) ? cmd : [cmd];
  return parseGpuGen(await run(bin, [...pre, "--query-gpu=compute_cap", "--format=csv,noheader"]));
}

const DESKTOP = new Set(
  "dwm explorer csrss winlogon shellhost shellexperiencehost startmenuexperiencehost searchhost searchapp textinputhost lockapp applicationframehost systemsettings crossdeviceresume widgets widgetservice phoneexperiencehost msedge msedgewebview2 chrome firefox brave opera code nvcontainer rustdesk anydesk teamviewer teams ms-teams discord slack spotify"
    .split(" ")
    .concat(["nvidia overlay", "nvidia share", "nvidia app"]),
);

/** A desktop or system process (the compositor, the shell, browsers, editors, overlays): never named as the cause. */
export function isDesktop(name) {
  return DESKTOP.has(String(name ?? "").trim().toLowerCase().replace(/\.exe$/i, ""));
}

/**
 * What its own ComfyUI holds: { mb, sure }. nvidia-smi's number for its process when it gives one (sure); else what torch
 * reports plus the context allowance, a lower bound only (not sure): weights that ComfyUI's dynamic VRAM keeps outside
 * torch's allocator aren't in it, and the read gives null when ComfyUI is slow to answer.
 */
export function ownOf(own, apps = []) {
  // The text slot's server (text.mjs) is the worker's own too: its own number when nvidia-smi gives one, else what it said.
  const extra = (own.extraPids ?? []).reduce((n, pid) => n + (apps.find((a) => a.pid === pid && a.usedMb !== null)?.usedMb ?? 0), 0) || (own.extraMb ?? 0);
  if (!own.running) return { mb: extra, sure: true };
  const app = own.pid ? apps.find((a) => a.pid === own.pid && a.usedMb !== null) : null;
  if (app) return { mb: app.usedMb + extra, sure: true };
  return { mb: (own.mb ?? 0) + CONTEXT_ALLOWANCE_MB + extra, sure: false };
}

/**
 * Is another program using the GPU? Others' VRAM is the GPU's used memory minus what the worker's own ComfyUI holds
 * (ownOf). Busy above `busyVramMb`, or when another process (not a desktop one) shows its own use above it. The total
 * rule always works, also when per-process memory reads [N/A]. `unsure`: busy only by the total rule while its own job runs (`own.job`)
 * and its own share isn't known per process; GpuWatch skips such a reading.
 */
export function othersOf(reading, own, busyVramMb) {
  const mine = ownOf(own, reading.apps);
  const othersMb = Math.max(0, reading.usedMb - mine.mb);
  const others = reading.apps.filter((a) => a.pid !== own.pid && !(own.extraPids ?? []).includes(a.pid) && !isDesktop(a.name));
  const loud = others.find((a) => a.usedMb !== null && a.usedMb > busyVramMb);
  const busy = othersMb > busyVramMb || !!loud;
  const who = loud?.name ?? others.find((a) => a.usedMb === null || a.usedMb > 0)?.name ?? (busy ? "another program" : null);
  return { busy, othersMb, who, unsure: busy && !loud && !!own.job && !mine.sure };
}

/**
 * The automatic pause and resume. `update` takes each reading's verdict; `paused` says whether the GPU keeps the worker
 * paused now. Busy pauses after `busyReadings` busy readings in a row (1, the default: at once), and during its own job
 * (`verdict.job`) only once they have lasted `graceMs`; an unsure verdict is skipped. With `autoResume`, it resumes
 * once the GPU stayed free for `resumeAfterMs` in a row and is cooler than `resumeBelowC` (`briefResumeMs` after a
 * pause whose busy readings ended within `briefMs`, at most once per `briefEveryMs`). Any busy reading starts the
 * cool-down again. Without autoResume, only `clear()` (a resume by hand) ends it.
 */
export class GpuWatch {
  constructor(o) {
    this.o = o;
    this.paused = false;
    this.who = null;
    this.freeSince = null;
    this.busyInARow = 0;
    this.busySince = null;
    this.pausedAt = null;
    this.lastBusyAt = null;
    this.briefAt = null;
    /** What the last busy reading saw: "work" for local ComfyUI work only (studio jobs first), else null. */
    this.cause = null;
  }

  update(verdict, tempC, now) {
    if (verdict.unsure) return;
    if (verdict.busy) {
      this.busyInARow++;
      this.busySince ??= now;
      this.lastBusyAt = now;
      this.freeSince = null;
      const wait = verdict.job ? (this.o.graceMs ?? 0) : 0;
      if (this.paused || (this.busyInARow >= (this.o.busyReadings ?? 1) && now - this.busySince >= wait)) {
        if (!this.paused) this.pausedAt = now;
        this.paused = true;
        this.who = verdict.who;
        this.cause = verdict.cause ?? null;
      }
      return;
    }
    this.busyInARow = 0;
    this.busySince = null;
    this.freeSince ??= now;
    const brief = !!this.o.briefMs && this.lastBusyAt - this.pausedAt <= this.o.briefMs && (this.briefAt === null || now - this.briefAt >= (this.o.briefEveryMs ?? 0));
    const coolMs = brief ? Math.min(this.o.briefResumeMs ?? this.o.resumeAfterMs, this.o.resumeAfterMs) : this.o.resumeAfterMs;
    if (this.paused && this.o.autoResume && now - this.freeSince >= coolMs && (tempC === null || tempC === undefined || tempC < this.o.resumeBelowC)) {
      this.paused = false;
      this.who = null;
      if (brief && coolMs < this.o.resumeAfterMs) this.briefAt = now;
    }
  }

  /** A resume by hand clears a GPU pause too. */
  clear() {
    this.paused = false;
    this.who = null;
    this.busyInARow = 0;
    this.busySince = null;
    this.cause = null;
  }
}
