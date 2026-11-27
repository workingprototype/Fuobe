// The drive that holds the worker folder (docs/gpu-workers.md, "Pauses"). Its ComfyUI's input, output and temp folders
// and the kept results are all in the worker folder, so a job on an almost full drive can fail, or fill the drive for
// every other program on the PC. With less free space than `minFreeGb` (worker.json, 5 GB by default; 0 turns it off),
// the worker pauses by itself: it takes no new job, and the job in hand goes on. Once the drive has DISK_GAP_GB more
// than that, it takes jobs again. One statfs call about once a minute (and after each job): no extra process, no admin
// rights.
import fs from "node:fs";
import path from "node:path";

const GB = 2 ** 30;

/** The free space the worker keeps on its worker folder's drive when worker.json doesn't say (GB). */
export const MIN_FREE_GB = 5;
/** Above the floor by this much again (GB), the pause ends: a drive just over the floor doesn't pause it on and off. */
export const DISK_GAP_GB = 3;
/** How often it reads the drive (ms). */
export const DISK_EVERY_MS = 60_000;
/** The start of the pause's `why`: "disk-low:<drive letter>:<GB free>:<GB it waits for>" (no letter off Windows). */
export const DISK_LOW = "disk-low";

/**
 * The floor from worker.json's `minFreeGb`: { gb } (0: off), with a `problem` for a value it can't use (it keeps
 * MIN_FREE_GB then). Absent (a setting that didn't come through loadConfig, as tests give): off.
 */
export function minFreeOf(v) {
  if (v === undefined) return { gb: 0 };
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return { gb: v };
  return { gb: MIN_FREE_GB, problem: "minFreeGb in worker.json isn't a number of GB" };
}

/** The drive letter of a folder on Windows ("X"), else null (another system, or a network folder). */
export function driveOf(dir, platform = process.platform) {
  if (platform !== "win32") return null;
  const m = /^([a-z]):/i.exec(path.win32.resolve(String(dir)));
  return m ? m[1].toUpperCase() : null;
}

/** The drive that holds `dir`: { drive, freeBytes, totalBytes } (free: what this user may use), or null when it can't be read. */
export function readDisk(dir, statfs = fs.statfsSync, platform = process.platform) {
  try {
    const s = statfs(dir);
    const size = Number(s.bsize);
    const freeBytes = Number(s.bavail) * size;
    const totalBytes = Number(s.blocks) * size;
    if (!Number.isFinite(freeBytes) || freeBytes < 0 || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return { drive: driveOf(dir, platform), freeBytes, totalBytes };
  } catch {
    return null;
  }
}

/** GB with at most one decimal, rounded down (it never says more room than there is): "3.2", "8". */
export const gbText = (bytes) => String(Math.max(0, Math.floor((bytes / GB) * 10) / 10));

/** "Drive X:", or "The drive of its worker folder" where there is no letter. */
export const driveName = (drive) => (drive ? `Drive ${drive}:` : "The drive of its worker folder");

/**
 * The worker folder's drive against its floor. `update(reading)` takes a reading (null: it failed, and the state stays
 * as it was) and says whether it is low now: under the floor it is low, and it stays low until the drive has
 * DISK_GAP_GB more than the floor. `why` is the pause's code while it is low (else null).
 */
export class DiskWatch {
  /** `o`: { minFreeGb } (0: off, never low). */
  constructor(o) {
    this.floorBytes = Math.max(0, Number(o?.minFreeGb) || 0) * GB;
    this.backBytes = this.floorBytes + DISK_GAP_GB * GB;
    this.low = false;
    this.last = null;
  }

  update(reading) {
    if (!(this.floorBytes > 0)) {
      this.low = false;
      return false;
    }
    if (!reading) return this.low;
    this.last = reading;
    if (!this.low && reading.freeBytes < this.floorBytes) this.low = true;
    else if (this.low && reading.freeBytes >= this.backBytes) this.low = false;
    return this.low;
  }

  get why() {
    if (!this.low || !this.last) return null;
    return `${DISK_LOW}:${this.last.drive ?? ""}:${gbText(this.last.freeBytes)}:${gbText(this.backBytes)}`;
  }

  /** Its log line when it goes low ("pause": a warning in the studio's view, log-ring.mjs levelOf) or has room again ("back"). */
  words(change) {
    const r = this.last;
    const name = driveName(r?.drive);
    if (change === "pause") return `${name} has only ${gbText(r?.freeBytes ?? 0)} GB free: pausing. It takes no new jobs until the drive has ${gbText(this.backBytes)} GB free. A job in hand goes on.`;
    return `${name} has ${gbText(r?.freeBytes ?? 0)} GB free again: it takes jobs again.`;
  }
}
