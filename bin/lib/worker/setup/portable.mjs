// A fresh ComfyUI for a PC that has none (setup/main.mjs): the official Windows portable build, pinned by its release,
// download address, size and SHA-256. The download is checked whole before anything is unpacked; a file that differs
// is deleted and never opened.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { versionAtLeast } from "./pc.mjs";

const RELEASE = "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.44.0";

/**
 * The pinned builds, best first. `cuda`: the CUDA its PyTorch is built for, which the graphics driver must run
 * (nvidia-smi's "CUDA Version"). Sizes and SHA-256 are the release's own (GitHub's asset digests).
 */
export const PORTABLES = [
  {
    name: "ComfyUI portable v0.44.0 (NVIDIA, CUDA 13.0)",
    cuda: "13.0",
    url: `${RELEASE}/ComfyUI_windows_portable_nvidia.7z`,
    sizeBytes: 2054382457,
    sha256: "7170c2db49c182a81adcc051e80234f99dd891656fb200737f87797876348f96",
  },
  {
    name: "ComfyUI portable v0.44.0 (NVIDIA, CUDA 12.6)",
    cuda: "12.6",
    url: `${RELEASE}/ComfyUI_windows_portable_nvidia_cu126.7z`,
    sizeBytes: 1945636677,
    sha256: "a26cf84f043b3d9fbf0d53296f57d7190482c339caf1b3b5cfda5149d454be9f",
  },
];

/** The build this driver runs (its CUDA version from nvidia-smi), or null when the driver is too old for both. */
export const pickPortable = (cuda, list = PORTABLES) => list.find((p) => versionAtLeast(cuda, p.cuda)) ?? null;

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Is `file` exactly the pinned build (size, then SHA-256)? */
export async function matchesPin(file, pin) {
  try {
    if (fs.statSync(file).size !== pin.sizeBytes) return false;
  } catch {
    return false;
  }
  return (await sha256File(file)) === pin.sha256;
}

/** Downloads `pin` to `file` (a part file first), reusing a whole copy already there. `onProgress(done, total)`. */
export async function download(pin, file, { fetch = globalThis.fetch, onProgress = () => {} } = {}) {
  if (await matchesPin(file, pin)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  const res = await fetch(pin.url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`The download didn't start (HTTP ${res.status}).`);
  const out = fs.createWriteStream(part);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      if (done > pin.sizeBytes) throw new Error("The download is bigger than the pinned file.");
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      onProgress(done, pin.sizeBytes);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (!(await matchesPin(part, pin))) {
    fs.rmSync(part, { force: true });
    throw new Error("The downloaded file isn't the pinned one (its size or SHA-256 differs). It was deleted.");
  }
  fs.renameSync(part, file);
  return file;
}

/** The programs that unpack a .7z: Windows' own tar (Windows 10 1803 and later), then 7-Zip when it is installed. */
export function unpackers(env = process.env) {
  const sys = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  const pf = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  return [
    { cmd: path.join(sys, "System32", "tar.exe"), args: (file, dest) => ["-xf", file, "-C", dest] },
    ...pf.map((p) => ({ cmd: path.join(p, "7-Zip", "7z.exe"), args: (file, dest) => ["x", "-y", `-o${dest}`, file] })),
  ];
}

/**
 * Checks `file` against `pin`, then unpacks it into `dest`. Returns the ComfyUI folder (the one with main.py). Throws
 * with plain words when the file isn't the pinned one or nothing here can unpack it.
 */
export async function unpack(pin, file, dest, { env = process.env, run = spawnSync } = {}) {
  if (!(await matchesPin(file, pin))) throw new Error("The file isn't the pinned ComfyUI build, so it wasn't unpacked.");
  fs.mkdirSync(dest, { recursive: true });
  for (const u of unpackers(env)) {
    if (!fs.existsSync(u.cmd)) continue;
    const r = run(u.cmd, u.args(file, dest), { stdio: "ignore", windowsHide: true });
    if (r.status === 0) {
      const found = [path.join(dest, "ComfyUI_windows_portable", "ComfyUI"), path.join(dest, "ComfyUI")].find((d) => fs.existsSync(path.join(d, "main.py")));
      if (found) return found;
    }
  }
  throw new Error("Couldn't unpack the ComfyUI download. Install 7-Zip (7-zip.org), then run this setup again.");
}
