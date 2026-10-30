import "server-only";
import fs from "node:fs";
import { DATA_DIR, db } from "./db";

/**
 * Public sign-up ("Your GPU"): what an account may keep on this server, and how much. An account's uploads and the
 * files of its runs carry its id (assets.account_id); these numbers cap them, and account-sweep.ts removes them in time.
 * The numbers are defaults the owner can change here.
 */

const MB = 2 ** 20;
const GB = 2 ** 30;
const DAY = 24 * 60 * 60_000;

export const ACCOUNT_LIMITS = {
  /** Picture uploads: PNG, JPEG or WebP, up to this size and 40 megapixels. */
  imageBytes: 25 * MB,
  imagePixels: 40_000_000,
  /** Sound uploads: MP3, WAV, OGG, FLAC, M4A or WebM. */
  audioBytes: 50 * MB,
  /** Clips: MP4, MOV, WebM, MKV or AVI (under ComfyUI's 100 MB default and a free tunnel's 100 MB request limit). */
  videoBytes: 95 * MB,
  /** A multipart upload (an old tab) is read in memory: only this small. */
  multipartBytes: 26 * MB,
  /** Live uploads per account, and all its files (uploads and results). */
  uploadsBytes: 1 * GB,
  totalBytes: 3 * GB,
  /** Uploads: per hour, per day, and at once. */
  uploadsPerHour: 60,
  uploadsPerDay: 300,
  uploadsAtOnce: 2,
  /** Retention: uploads (even when a run still names them), and runs with their files. */
  uploadDays: 14,
  runDays: 30,
  /** The disk space the server keeps free: below it, no account uploads or runs. */
  diskFreeBytes: 20 * GB,
  /** Runs: at once (queued or running), per hour, and outputs per run. */
  activeRuns: 4,
  runsPerHour: 60,
  outputsPerRun: 4,
  /** What one run request may weigh (inputs are uploaded first, so a request is only words and file paths). */
  runBodyBytes: 1 * MB,
  /** Outputs kept from one job on the account's ComfyUI. */
  outputsPerJob: 16,
  /** How long a job may wait in the account's ComfyUI's queue. */
  queueMs: 30 * 60_000,
  /** GPU address checks and saves, per minute. */
  gpuChecksPerMinute: 10,
} as const;

export const RETENTION_MS = { upload: ACCOUNT_LIMITS.uploadDays * DAY, run: ACCOUNT_LIMITS.runDays * DAY };

export const ACCOUNT_MESSAGES = {
  imageTooBig: "That picture is over 25 MB. Save it smaller, then try again.",
  imageTooManyPixels: "That picture is over 40 megapixels. Save it smaller, then try again.",
  audioTooBig: "That sound file is over 50 MB. Trim it, then try again.",
  videoTooBig: "That clip is over 95 MB. Trim it or lower its quality, then try again.",
  wrongType: "Fuobe takes PNG, JPEG or WebP pictures, MP4, MOV, WebM, MKV or AVI clips, and MP3, WAV, OGG, FLAC or M4A sound.",
  uploadsFull: "Your uploads have reached 1 GB. Uploads are removed after 14 days.",
  filesFull: "Your files have reached 3 GB. Delete some runs to make room.",
  uploadRate: "That's a lot of uploads at once. Try again in a few minutes.",
  diskLow: "The studio is short of space right now. Try again later.",
  activeRuns: "You have 4 runs going. Start the next one when one finishes.",
  runRate: "That's a lot of runs this hour. Try again later.",
  outputsCapped: "Runs on your GPU make up to 4 at a time.",
  bodyTooBig: "That request is too large.",
  gpuChecks: "Too many checks. Wait a minute.",
  reloadToUpload: "Reload the page, then upload again.",
  lengthNeeded: "Send the file with its size (Content-Length).",
} as const;

/** What an account stores: all its files, its uploads, and how many uploads. */
export function accountUsage(id: string): { total: number; uploads: number; uploadCount: number } {
  const r = db()
    .prepare(
      `SELECT COALESCE(SUM(size), 0) AS total, COALESCE(SUM(CASE WHEN source = 'upload' THEN size ELSE 0 END), 0) AS uploads,
       COALESCE(SUM(CASE WHEN source = 'upload' THEN 1 ELSE 0 END), 0) AS uploadCount FROM assets WHERE account_id = ?`,
    )
    .get(id) as { total: number; uploads: number; uploadCount: number };
  return { total: Number(r.total), uploads: Number(r.uploads), uploadCount: Number(r.uploadCount) };
}

declare global {
  /** Tests only: the free disk space to report. */
  var __fuobeTestDiskFree: number | undefined;
}

/** Free space on the disk that holds the data folder (Infinity when it can't be read: the check never blocks by mistake). */
export function diskFreeBytes(): number {
  if (process.env.VITEST === "true" && typeof globalThis.__fuobeTestDiskFree === "number") return globalThis.__fuobeTestDiskFree;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const s = fs.statfsSync(DATA_DIR);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Infinity;
  }
}

/** Whether the server has room for an account's upload or run. */
export const diskHasRoom = () => diskFreeBytes() >= ACCOUNT_LIMITS.diskFreeBytes;

// ---------------------------------------------------------------------------
// When an account is deleted

declare global {
  var __fuobeAccountDeleted: ((id: string) => void | Promise<void>)[] | undefined;
}

/** Work to do when an account is deleted, after its runs and files are gone (other features register theirs here). */
export function onAccountDeleted(hook: (id: string) => void | Promise<void>): void {
  const hooks = (globalThis.__fuobeAccountDeleted ??= []);
  if (!hooks.includes(hook)) hooks.push(hook);
}

export async function runAccountDeletedHooks(id: string): Promise<void> {
  for (const hook of globalThis.__fuobeAccountDeleted ?? []) {
    try {
      await hook(id);
    } catch (e) {
      console.warn(`[fuobe] cleanup for a deleted account failed: ${(e as Error).message}`);
    }
  }
}
