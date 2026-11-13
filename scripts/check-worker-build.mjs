#!/usr/bin/env node
// Checks that the worker program's shared parts load (docs/gpu-workers.md): builds them with scripts/build-worker.mjs
// into a new temporary folder (or reads a folder built already), then imports every .mjs file in it and checks the
// exports the worker program reads from them. A built file that imports something the build doesn't include, or that
// fails when it loads, stops a worker at its start; typecheck and the tests run the TypeScript sources, so only this
// finds it. Exit code 1 on any failure, with each one named.
//
//   node scripts/check-worker-build.mjs                # build into a temporary folder, then check it
//   node scripts/check-worker-build.mjs --dir <dir>    # check a folder built already (bin/lib/worker/dist after `pnpm build`)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The exports the worker program (bin/lib/worker/*.mjs) reads from each built file it imports by name. Every
 * `import("./dist/…")` in the worker program names a file here (the tests hold the list to that).
 */
export const WORKER_READS = {
  "computer-runner.mjs": ["ComputerRunner"],
  "engine-error.mjs": ["withoutLocalPaths"],
  "lanes.mjs": ["allLanes"],
  "compose/lib/ticket-compose.mjs": ["composeTicket", "workerFactsFrom"],
};

/** Every .mjs file under `dir`, as paths relative to it with forward slashes, sorted. */
export function builtModules(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mjs")) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Import every .mjs file under `dir`, and check WORKER_READS (`reads`) against what they export. Returns the files it
 * imported and each failure ("file: why"). A folder with no .mjs file fails too.
 */
export async function checkBuilt(dir, reads = WORKER_READS) {
  const files = builtModules(dir);
  const failures = [];
  if (!files.length) failures.push(`${dir}: no built .mjs file`);
  const loaded = new Map();
  for (const f of files) {
    try {
      loaded.set(f, await import(pathToFileURL(path.join(dir, f)).href));
    } catch (e) {
      failures.push(`${f}: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  for (const [f, names] of Object.entries(reads)) {
    if (!files.includes(f)) {
      failures.push(`${f}: not built, and the worker program imports it`);
      continue;
    }
    const m = loaded.get(f);
    if (!m) continue;
    for (const n of names) if (m[n] === undefined) failures.push(`${f}: has no export ${n}, which the worker program reads`);
  }
  return { files, failures };
}

/** Build the worker's parts into a new temporary folder (scripts/build-worker.mjs --out). Returns the folder; throws when the build fails. */
export function buildInto(dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-worker-build-")), root = ROOT) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/build-worker.mjs"), "--out", dir], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`The worker build failed: ${(r.stderr || r.stdout || "").trim() || `exit ${r.status}`}`);
  return dir;
}

async function main(argv) {
  const i = argv.indexOf("--dir");
  const given = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !given) throw new Error("--dir needs a folder");
  const dir = given ? path.resolve(given) : buildInto();
  try {
    const { files, failures } = await checkBuilt(dir);
    if (failures.length) {
      console.error(`The worker's built parts don't load (${failures.length}):\n  ${failures.join("\n  ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`worker build: ${files.length} modules load`);
  } finally {
    if (!given) fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
