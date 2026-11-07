// The setup program's answers to `fuobe worker setup` (index.mjs): the person gives only the site and the token, and
// the rest comes from what the setup found on this PC. The existing setup asks its questions as always; answerSetup()
// answers each one it knows and stops at any other, so a new question in setup is never answered by guess.
import net from "node:net";
import path from "node:path";
import { syncedFolder } from "../config.mjs";

export const DEFAULT_SITE = "https://fuobe.com";

/** A question setup asked that the setup program has no answer for. */
export class UnknownQuestion extends Error {}

/**
 * The answer to each of setup's questions, by what it asks. "" takes setup's own default, which is the value saved by an
 * earlier setup when there is one. `a`: { site, token ("" keeps the saved one), comfyDir, modelDirs, workDir, ffmpeg
 * (a path, or null for pictures only) }.
 */
export function setupAnswers(a) {
  return [
    { what: "site", test: /^The studio's address/, value: a.site },
    { what: "token", test: /^The worker's token/, value: a.token ?? "", hidden: true },
    { what: "comfyDir", test: /^ComfyUI's folder/, value: a.comfyDir },
    { what: "modelDirs", test: /^Model folders/, value: (a.modelDirs ?? []).join(";") },
    { what: "workDir", test: /^A worker folder/, value: a.workDir },
    { what: "ffmpeg", test: /^ffmpeg's path/, value: a.ffmpeg ? a.ffmpeg : "-" },
    { what: "autoResume", test: /^Resume by itself/, value: "" },
    { what: "lanes", test: /^Which lanes or workflows/, value: "" },
    { what: "megapixels", test: /^The largest picture/, value: "" },
    { what: "seconds", test: /^The longest clip/, value: "" },
    { what: "outputs", test: /^The most results/, value: "" },
    { what: "acceptGraphs", test: /^Also run the studio owner's own jobs/, value: "" },
    { what: "cpuSlot", test: /^Also run light CPU work/, value: "" },
  ];
}

/**
 * An `ask` for setup's io: it answers from setupAnswers(a) and records which questions it answered (never the token's
 * value). The token goes only to the hidden question.
 */
export function answerSetup(a) {
  const table = setupAnswers(a);
  const asked = [];
  const ask = async (question, o = {}) => {
    const row = table.find((r) => r.test.test(String(question)));
    if (!row) throw new UnknownQuestion(`Setup asked something this program doesn't know: "${String(question).trim()}"`);
    if (row.hidden && !o.hidden) throw new UnknownQuestion("Setup asked for the token without hiding it.");
    asked.push(row.what);
    return String(row.value ?? "");
  };
  return { ask, asked };
}

/** Is `site` an address the setup takes: https, or http only for this PC itself (tests). Returns a problem or null. */
export function siteWords(site) {
  let u;
  try {
    u = new URL(site);
  } catch {
    return "That isn't a web address. It looks like https://fuobe.com";
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
  return "The address must start with https://";
}

/**
 * The worker's root folder: on the drive of the chosen ComfyUI when it has room, else the drive with the most free
 * space, preferring one that isn't the system drive. `disks`: pc.mjs readDisks. Null: no drive has `minFree` bytes free.
 */
export function chooseRoot(disks, comfyDir, { minFree = 20 * 2 ** 30, systemDrive = "C:" } = {}) {
  const room = disks.filter((d) => d.freeBytes >= minFree);
  if (!room.length) return null;
  const comfyDrive = comfyDir ? path.win32.parse(path.win32.resolve(comfyDir)).root.slice(0, 2).toUpperCase() : null;
  const pick =
    room.find((d) => d.drive.toUpperCase() === comfyDrive) ??
    [...room].sort((a, b) => Number(a.drive.toUpperCase() === systemDrive.toUpperCase()) - Number(b.drive.toUpperCase() === systemDrive.toUpperCase()) || b.freeBytes - a.freeBytes)[0];
  return `${pick.drive}\\FuobeWorker`;
}

/** Whether nothing listens on 127.0.0.1:`port` now (a bind that works is released at once). */
export function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ port, host: "127.0.0.1", exclusive: true }, () => s.close(() => resolve(true)));
  });
}

/**
 * The problems with a folder or a saved port, in plain words: a folder a cloud drive syncs, and a pinned port that is
 * 8188 (a person's own ComfyUI) or busy. `o`: { folders: [path], port, isFree (async port → bool) }.
 */
/**
 * @param {{ folders?: (string | null | undefined)[]; port?: number | string | null; isFree?: (port: number) => Promise<boolean> }} [o]
 * @returns {Promise<string[]>}
 */
export async function setupProblems({ folders = [], port = null, isFree = portFree } = {}) {
  const out = [];
  for (const f of folders) if (f && syncedFolder(f)) out.push(`${f} is synced to a cloud drive. Pick a folder outside OneDrive, Dropbox and the like.`);
  if (port != null && port !== "") {
    const n = Number(port);
    if (n === 8188) out.push("worker.json pins port 8188, which ComfyUI itself uses. Remove \"port\" from worker.json.");
    else if (!Number.isInteger(n) || n < 1024 || n > 65535) out.push(`worker.json pins port ${port}, which isn't a port the worker can use. Remove "port" from worker.json.`);
    else if (!(await isFree(n))) out.push(`worker.json pins port ${n}, and another program uses it now. Remove "port" from worker.json or close that program.`);
  }
  return out;
}

/** Where ffmpeg may be, in order: the PATH, then usual folders, then the copy a ComfyUI portable's video nodes bring. */
/**
 * @param {{ env?: Record<string, string | undefined>; comfyDir?: string | null; readdir?: (dir: string) => string[] }} [o]
 * @returns {string[]}
 */
export function ffmpegPlaces({ env = process.env, comfyDir = null, readdir = () => [] } = {}) {
  const out = ["ffmpeg"];
  const sys = env.SystemDrive ?? env.SYSTEMDRIVE ?? "C:";
  if (env.LOCALAPPDATA) out.push(path.win32.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
  if (env.ProgramFiles) out.push(path.win32.join(env.ProgramFiles, "ffmpeg", "bin", "ffmpeg.exe"));
  out.push(path.win32.join(`${sys}\\`, "ffmpeg", "bin", "ffmpeg.exe"));
  if (comfyDir) {
    const bin = path.win32.join(comfyDir, "..", "python_embeded", "Lib", "site-packages", "imageio_ffmpeg", "binaries");
    for (const f of readdir(bin)) if (/^ffmpeg.*\.exe$/i.test(f)) out.push(path.win32.join(bin, f));
  }
  return out;
}
