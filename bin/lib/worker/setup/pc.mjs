// What this PC has, for the setup program (setup/main.mjs): the graphics card and its driver, the memory, the free
// space of each drive and the Windows version. The parsers are pure; readPc() runs nvidia-smi and reads the drives.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const GB = 2 ** 30;

/** `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits` → [{ name, vramMb, driver }]. */
export function parseGpuQuery(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((s) => s.trim()))
    .filter((cols) => cols.length >= 3 && cols[0])
    .map(([name, mb, driver]) => ({ name, vramMb: Number(mb) || 0, driver }));
}

/** The "CUDA Version: 13.0" (newer drivers: "CUDA UMD Version") of nvidia-smi's header: the newest CUDA the driver runs, or null. */
export function parseCudaVersion(text) {
  return /CUDA (?:UMD )?Version:\s*([0-9]+\.[0-9]+)/i.exec(String(text ?? ""))?.[1] ?? null;
}

/** "13.0" ≥ "12.6"? */
export function versionAtLeast(have, want) {
  if (!have) return false;
  const [a, b] = String(have).split(".").map(Number);
  const [c, d] = String(want).split(".").map(Number);
  return a > c || (a === c && (b || 0) >= (d || 0));
}

/** Windows' name from its build number: 22000 and later is Windows 11. */
export function windowsName(release = os.release(), version = os.version?.() ?? "") {
  const build = Number(String(release).split(".")[2]) || 0;
  const edition = /\b(Home|Pro|Enterprise|Education)\b/i.exec(version)?.[1];
  if (!/^10\./.test(String(release))) return { name: version || `Windows ${release}`, build };
  return { name: `Windows ${build >= 22000 ? 11 : 10}${edition ? ` ${edition}` : ""}`, build };
}

/** The drives with their space: [{ drive: "C:", freeBytes, totalBytes }]. `statfs` is fs.statfsSync (tests pass their own). */
/** @param {(p: string) => { bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }} [statfs] @param {string} [letters] */
export function readDisks(statfs = fs.statfsSync, letters = "CDEFGHIJKLMNOPQRSTUVWXYZ") {
  const out = [];
  for (const l of letters) {
    try {
      const s = statfs(`${l}:\\`);
      const total = Number(s.blocks) * Number(s.bsize);
      if (!total) continue;
      out.push({ drive: `${l}:`, freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: total });
    } catch {}
  }
  return out;
}

const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 20_000, windowsHide: true }, (err, out) => resolve(err ? null : String(out))));

/** Everything the setup shows about this PC. `o`: { exec (cmd, args) → stdout or null, statfs, nvidiaSmi }. */
export async function readPc(o = {}) {
  const exec = o.exec ?? run;
  const smi = o.nvidiaSmi ?? "nvidia-smi";
  const query = await exec(smi, ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]);
  const header = query ? await exec(smi, []) : null;
  const gpus = parseGpuQuery(query);
  return {
    gpus,
    driver: gpus[0]?.driver ?? null,
    cuda: parseCudaVersion(header),
    ramBytes: o.ramBytes ?? os.totalmem(),
    disks: readDisks(o.statfs),
    windows: windowsName(o.release, o.version),
  };
}

export const gb = (bytes) => `${(bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1)} GB`;

/** The PC in plain lines, with the problems that stop a worker (no NVIDIA card) or slow it (little memory). */
export function pcLines(pc) {
  const lines = [];
  const problems = [];
  if (!pc.gpus.length) {
    lines.push("Graphics card: no NVIDIA card found (nvidia-smi didn't answer).");
    problems.push("This PC needs an NVIDIA graphics card with its driver installed.");
  }
  for (const g of pc.gpus) lines.push(`Graphics card: ${g.name}, ${(g.vramMb / 1024).toFixed(0)} GB of video memory`);
  if (pc.gpus.length) lines.push(`Driver: ${pc.driver ?? "unknown"}${pc.cuda ? `, runs CUDA up to ${pc.cuda}` : ""}`);
  lines.push(`Memory: ${gb(pc.ramBytes)}`);
  for (const d of pc.disks) lines.push(`Drive ${d.drive} ${gb(d.freeBytes)} free of ${gb(d.totalBytes)}`);
  lines.push(`System: ${pc.windows.name} (build ${pc.windows.build})`);
  if (pc.ramBytes < 15 * GB) problems.push("This PC has less than 16 GB of memory: big models may not load.");
  if (pc.windows.build && pc.windows.build < 17763) problems.push("This Windows is too old. Windows 10 (1809 or newer) or Windows 11 is needed.");
  return { lines, problems };
}
