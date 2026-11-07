// Finding ComfyUI on this PC for the setup program (setup/main.mjs): the usual places of a portable or a manual install,
// the folders of ComfyUI processes that run now, and ComfyUI Desktop's own settings. Then its model folders: its own
// models folder and the ones its extra_model_paths.yaml adds, with their sizes. Reads only; it never starts anything.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pythonFor } from "../comfy.mjs";
import { twinFolders, yamlModelDirs } from "../inventory.mjs";

const win = path.win32;
const SKIP_TOP = new Set(["windows", "$recycle.bin", "system volume information", "recovery", "perflogs", "program files", "program files (x86)", "programdata", "users", "$windows.~bt", "$windows.~ws", "msocache"]);

/** The real file-system functions (tests pass their own). */
export const realFs = {
  exists: (p) => fs.existsSync(p),
  readdir: (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  read: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

const key = (p) => win.resolve(p).toLowerCase();

/** The folders worth a look for a ComfyUI folder (the one with main.py): by name, two levels into each drive and the home folders. */
/** @param {{ drives?: string[]; home?: string; fsx?: { exists: (p: string) => boolean; readdir: (p: string) => string[]; read: (p: string) => string | null } }} [o] @returns {string[]} */
export function placesToLook({ drives = [], home = os.homedir(), fsx = realFs } = {}) {
  const out = [];
  const comfyish = (name) => /comfy/i.test(name);
  const add = (dir) => out.push(dir, win.join(dir, "ComfyUI"));
  for (const d of drives) {
    const root = `${d.replace(/[\\/:]+$/, "")}:\\`;
    for (const top of fsx.readdir(root)) {
      if (SKIP_TOP.has(top.toLowerCase()) || top.startsWith(".")) continue;
      const dir = win.join(root, top);
      if (comfyish(top)) add(dir);
      for (const sub of fsx.readdir(dir)) if (comfyish(sub)) add(win.join(dir, sub));
    }
  }
  for (const base of [home, win.join(home, "Documents"), win.join(home, "Desktop"), win.join(home, "Downloads"), win.join(home, "AppData", "Local", "Programs")]) {
    for (const sub of fsx.readdir(base)) if (comfyish(sub)) add(win.join(base, sub));
  }
  return out;
}

/** Splits a Windows command line into its words (quotes kept together). */
export function commandWords(line) {
  return [...String(line ?? "").matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/**
 * The folders a running Python may run ComfyUI from, from its program path and command line: the folder of the main.py it
 * runs. Windows doesn't say a process's working folder, so a relative main.py (a portable's run_nvidia_gpu.bat runs
 * `python_embeded\python.exe ComfyUI\main.py` from its own folder; others run `main.py` inside the ComfyUI folder) gives
 * both places next to its Python. []: it isn't ComfyUI (or its command line can't be read).
 */
export function comfyFromProcess({ executablePath, commandLine }) {
  const main = commandWords(commandLine).find((w) => /(^|[\\/])main\.py$/i.test(w));
  if (!main) return [];
  if (win.isAbsolute(main)) return [win.dirname(main)];
  const exeDir = executablePath ? win.dirname(executablePath) : null;
  if (!exeDir) return [];
  let base = /python_embed(d)?ed$/i.test(exeDir) || /^(Scripts|bin)$/i.test(win.basename(exeDir)) ? win.dirname(exeDir) : exeDir;
  // A venv's python (ComfyUI\venv\Scripts\python.exe): the folder the venv is in.
  if (/^\.?venv$/i.test(win.basename(base))) base = win.dirname(base);
  return [...new Set([win.dirname(win.resolve(base, main)), win.dirname(win.resolve(base, "ComfyUI", main))])];
}

/** The Python processes that run now: [{ executablePath, commandLine }] (PowerShell's process list). */
export async function runningPythons(exec = runPs) {
  const out = await exec("Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress");
  if (!out) return [];
  try {
    const v = JSON.parse(out);
    return (Array.isArray(v) ? v : [v]).map((p) => ({ executablePath: p.ExecutablePath ?? null, commandLine: p.CommandLine ?? "" }));
  } catch {
    return [];
  }
}

function runPs(command) {
  return new Promise((resolve) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout: 30_000, windowsHide: true, maxBuffer: 8 * 2 ** 20 }, (err, out) => resolve(err ? null : String(out).trim())),
  );
}

/**
 * ComfyUI Desktop: its settings (%APPDATA%\ComfyUI\config.json) name the folder with its models and node packs. Its
 * ComfyUI code sits in its program folder. Null: no Desktop here.
 */
/** @param {{ env?: Record<string, string | undefined>; fsx?: { exists: (p: string) => boolean; readdir: (p: string) => string[]; read: (p: string) => string | null } }} [o] @returns {{ basePath: string; codeDir: string | null; yaml: string } | null} */
export function desktopInstall({ env = process.env, fsx = realFs } = {}) {
  const appData = env.APPDATA;
  if (!appData) return null;
  const text = fsx.read(win.join(appData, "ComfyUI", "config.json"));
  if (!text) return null;
  let basePath = null;
  try {
    basePath = JSON.parse(text)?.basePath ?? null;
  } catch {}
  if (!basePath) return null;
  const programs = env.LOCALAPPDATA ? [win.join(env.LOCALAPPDATA, "Programs", "ComfyUI", "resources", "ComfyUI"), win.join(env.LOCALAPPDATA, "Programs", "@comfyorgcomfyui-electron", "resources", "ComfyUI")] : [];
  return { basePath, codeDir: programs.find((p) => fsx.exists(win.join(p, "main.py"))) ?? null, yaml: win.join(appData, "ComfyUI", "extra_models_config.yaml") };
}

/**
 * The worker's model folders from an extra_model_paths.yaml's folders ({ folder name → [paths] }, inventory.mjs
 * yamlModelDirs): a path that ends in its folder's name (or its older twin, clip for text_encoders) gives its parent as a
 * model folder. Others use another layout (an A1111 "Stable-diffusion" folder): the worker can't read those.
 * Returns { roots: [path], other: [path] }, in the file's order, each once.
 */
export function rootsFromYaml(map) {
  const roots = [];
  const other = [];
  const seen = new Set();
  for (const [name, dirs] of Object.entries(map ?? {})) {
    const names = twinFolders(name).map((n) => n.toLowerCase());
    for (const p of dirs) {
      const fits = names.includes(win.basename(p).toLowerCase());
      const dir = fits ? win.dirname(p) : p;
      if (seen.has(key(dir))) continue;
      seen.add(key(dir));
      (fits ? roots : other).push(dir);
    }
  }
  return { roots, other };
}

/** The model folders of a ComfyUI folder, in the order ComfyUI looks: its own models folder, then its yaml's. */
/** @param {string} comfyDir @param {{ env?: Record<string, string | undefined>; home?: string; fsx?: { exists: (p: string) => boolean; readdir: (p: string) => string[]; read: (p: string) => string | null }; yamlFile?: string }} [o] @returns {{ roots: string[]; other: string[] }} */
export function modelRootsOf(comfyDir, { env = process.env, home = os.homedir(), fsx = realFs, yamlFile } = {}) {
  const own = win.join(comfyDir, "models");
  const text = fsx.read(yamlFile ?? win.join(comfyDir, "extra_model_paths.yaml"));
  const { roots, other } = text ? rootsFromYaml(yamlModelDirs(text, yamlFile ? win.dirname(yamlFile) : comfyDir, env, home)) : { roots: [], other: [] };
  const all = [];
  const seen = new Set();
  for (const r of [...(fsx.exists(own) ? [own] : []), ...roots]) {
    if (seen.has(key(r))) continue;
    seen.add(key(r));
    all.push(r);
  }
  return { roots: all, other };
}

/** The kind of ComfyUI folder: "portable" (python_embeded beside it), "venv", "desktop" or "other". */
export function comfyKind(dir, fsx = realFs) {
  if (fsx.exists(win.join(dir, "..", "python_embeded", "python.exe"))) return "portable";
  if (fsx.exists(win.join(dir, "venv", "Scripts", "python.exe")) || fsx.exists(win.join(dir, ".venv", "Scripts", "python.exe"))) return "venv";
  if (/[\\/]resources[\\/]ComfyUI$/i.test(dir)) return "desktop";
  return "other";
}

/** ComfyUI's version from comfyui_version.py, or null. */
export function comfyVersion(dir, fsx = realFs) {
  return /__version__\s*=\s*["']([^"']+)["']/.exec(fsx.read(win.join(dir, "comfyui_version.py")) ?? "")?.[1] ?? null;
}

/**
 * Every ComfyUI found: [{ dir, kind, version, python, running, usable, why, modelRoots, otherFolders, nodePacks }].
 * `usable` false names why the worker can't start that one (`why`): ComfyUI Desktop keeps its Python and node packs
 * outside its ComfyUI folder, and a folder with no Python of its own would use whatever Python is on the PATH.
 */
/**
 * @param {{ dirs?: string[]; running?: string[]; desktop?: { basePath: string; codeDir: string | null; yaml: string } | null; env?: Record<string, string | undefined>; home?: string; fsx?: { exists: (p: string) => boolean; readdir: (p: string) => string[]; read: (p: string) => string | null } }} [o]
 * @returns {any[]}
 */
export function describeComfys({ dirs = [], running = [], desktop = null, env = process.env, home = os.homedir(), fsx = realFs } = {}) {
  const out = [];
  const seen = new Set();
  const runningKeys = new Set(running.map(key));
  const consider = (dir, extra = {}) => {
    if (!dir || seen.has(key(dir)) || !fsx.exists(win.join(dir, "main.py"))) return;
    seen.add(key(dir));
    const kind = extra.kind ?? comfyKind(dir, fsx);
    const python = kind === "desktop" ? null : pythonFor(dir);
    const ownPython = python && win.isAbsolute(python);
    const models = extra.models ?? modelRootsOf(dir, { env, home, fsx });
    const usable = kind !== "desktop" && !!ownPython;
    out.push({
      dir,
      kind,
      version: comfyVersion(dir, fsx),
      python: ownPython ? python : null,
      running: runningKeys.has(key(dir)),
      usable,
      why: usable ? null : kind === "desktop" ? "ComfyUI Desktop keeps its parts apart, so the worker can't start it. Its model folders can still be used." : "No Python of its own next to it.",
      modelRoots: models.roots,
      otherFolders: models.other,
      nodePacks: fsx.readdir(win.join(dir, "custom_nodes")).filter((n) => !n.startsWith(".") && n !== "__pycache__").length,
    });
  };
  for (const d of running) consider(d);
  for (const d of dirs) consider(d);
  if (desktop?.codeDir) {
    const own = win.join(desktop.basePath, "models");
    const fromYaml = modelRootsOf(desktop.codeDir, { env, home, fsx, yamlFile: desktop.yaml });
    consider(desktop.codeDir, { kind: "desktop", models: { roots: [...(fsx.exists(own) ? [own] : []), ...fromYaml.roots.filter((r) => key(r) !== key(own))], other: fromYaml.other } });
  }
  // Usable ones first, a running one first among them.
  return out.sort((a, b) => Number(b.usable) - Number(a.usable) || Number(b.running) - Number(a.running));
}

/** The size of a folder's files, counted up to `maxFiles` files (then `partial`). */
export function folderSize(dir, maxFiles = 200_000) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        if (++files > maxFiles) return { bytes, files, partial: true };
        try {
          bytes += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return { bytes, files, partial: false };
}

/** Everything found on this PC (reads only). `o`: { drives, env, home, exec, fsx }. */
export async function findComfys(o = {}) {
  const fsx = o.fsx ?? realFs;
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const procs = await runningPythons(o.exec);
  const running = procs.flatMap(comfyFromProcess);
  const dirs = placesToLook({ drives: o.drives ?? [], home, fsx });
  return describeComfys({ dirs, running, desktop: desktopInstall({ env, fsx }), env, home, fsx });
}
