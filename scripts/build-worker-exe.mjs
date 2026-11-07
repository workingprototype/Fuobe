#!/usr/bin/env node
// Builds "Fuobe Worker Setup.exe" (docs/gpu-workers.md, "Setup program"): a Node single executable application whose
// start (bin/lib/worker/setup/sea-main.cjs) unpacks a Node runtime and the worker's code, then runs the setup program.
// Windows x64 only; run it on Windows with the Node the exe should carry (Node 25.5 or later has --build-sea).
//
//   node scripts/build-worker-exe.mjs                  # into out/worker-exe/
//   node scripts/build-worker-exe.mjs --out <dir>      # into another folder
//   node scripts/build-worker-exe.mjs --no-build       # use bin/lib/worker/dist as it is (it must match this checkout)
//
// What goes in, all from this checkout: the worker's parts as scripts/build-worker.mjs builds them, every file their
// build stamp reads (so the worker starts: stamp.mjs), the catalog, the 3D finish scripts, the few packages the worker
// loads (sharp, the glTF tools, meshoptimizer, playwright-core) with their dependencies as installed, and this Node.
// The payload is written in a fixed order with fixed bytes, so the same checkout and the same Node give the same exe.
// It prints the exe's SHA-256 and writes it next to the exe, with manifest.json (commit, Node, payload hash).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { composerFiles } from "../bin/lib/worker/composer-files.mjs";
import { distProblem, stampFiles } from "../bin/lib/worker/stamp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXE_NAME = "Fuobe Worker Setup.exe";
export const MAGIC = "FWSP1\n";
/** The packages the worker's code loads at run time (picture.mjs, finish.mjs, scripts/model3d). */
export const RUNTIME_PACKAGES = ["sharp", "@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions", "meshoptimizer", "playwright-core"];
/** Whole folders of the checkout that go in. */
const FOLDERS = ["bin", "workflows/comfyui", "scripts/model3d"];
const FILES = ["package.json", "LICENSE"];

const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__pycache__") continue;
      out.push(...walk(p));
    } else if (e.isFile()) out.push(p);
  }
  return out;
}

/** A package's folder as Node finds it from `fromDir` (node_modules up the tree), its real path. */
function packageDir(name, fromDir) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(p, "package.json"))) return fs.realpathSync(p);
    if (path.dirname(d) === d) return null;
  }
}

/**
 * The packages and everything they need, as installed: [{ name, version, dir }]. Optional dependencies that aren't
 * installed (another platform's sharp build) are left out; a missing required one stops the build. One version of each
 * package: two would need a nested layout, so the build stops and says so.
 */
export function packageClosure(names, root = ROOT) {
  const found = new Map();
  const queue = names.map((name) => ({ name, from: root, optional: false }));
  while (queue.length) {
    const { name, from, optional } = queue.shift();
    const dir = packageDir(name, from);
    if (!dir) {
      if (optional) continue;
      throw new Error(`The package ${name} isn't installed. Run pnpm install first.`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const had = found.get(name);
    if (had) {
      if (had.version !== pkg.version) throw new Error(`Two versions of ${name} are needed (${had.version} and ${pkg.version}).`);
      continue;
    }
    found.set(name, { name, version: pkg.version, dir });
    for (const d of Object.keys(pkg.dependencies ?? {})) queue.push({ name: d, from: dir, optional: false });
    for (const d of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: d, from: dir, optional: true });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every file of the payload: [{ path (in the payload, with /), source }], sorted by path, each once. */
export function payloadFiles({ root = ROOT, node = process.execPath, packages = packageClosure(RUNTIME_PACKAGES, root) } = {}) {
  const map = new Map();
  const add = (p, source) => map.set(p, source);
  add("node/node.exe", node);
  for (const f of FILES) if (fs.existsSync(path.join(root, f))) add(`app/${f}`, path.join(root, f));
  for (const d of FOLDERS) for (const f of walk(path.join(root, d))) add(`app/${path.relative(root, f).split(path.sep).join("/")}`, f);
  for (const [name, file] of stampFiles(root)) if (fs.existsSync(file)) add(`app/${name}`, file);
  // The composer's own files, its JSON too: the stamp follows its imports, and a missing one changes the stamp.
  for (const name of composerFiles(root)) add(`app/${name}`, path.join(root, name));
  for (const p of packages) for (const f of walk(p.dir)) add(`app/node_modules/${p.name}/${path.relative(p.dir, f).split(path.sep).join("/")}`, f);
  return [...map].map(([p, source]) => ({ path: p, source })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The payload's bytes before gzip: MAGIC, then for each file its header's length, its header ({ p, s }) and its bytes. */
export function packPayload(files, read = (f) => fs.readFileSync(f)) {
  const parts = [Buffer.from(MAGIC, "latin1")];
  for (const f of files) {
    const data = read(f.source);
    const head = Buffer.from(JSON.stringify({ p: f.path, s: data.length }), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(head.length);
    parts.push(len, head, data);
  }
  return Buffer.concat(parts);
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main(argv) {
  if (process.platform !== "win32") throw new Error("Build the worker setup on Windows: the exe carries this Node, which must be the Windows x64 one.");
  const at = argv.indexOf("--out");
  const out = path.resolve(at >= 0 ? argv[at + 1] : path.join(ROOT, "out", "worker-exe"));
  if (!argv.includes("--no-build")) {
    const b = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-worker.mjs")], { cwd: ROOT, stdio: "inherit" });
    if (b.status !== 0) throw new Error("The worker's parts didn't build.");
  }
  if (distProblem(ROOT, path.join(ROOT, "bin", "lib", "worker", "dist"))) throw new Error("bin/lib/worker/dist doesn't match this checkout. Run without --no-build.");

  const node = process.execPath;
  const files = payloadFiles({ node });
  const raw = packPayload(files);
  // The worker starts only when its parts match its code: check that on a copy of the payload's app, as it unpacks.
  const trial = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-worker-exe-"));
  try {
    for (const f of files.filter((x) => x.path.startsWith("app/"))) {
      const to = path.join(trial, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(f.source, to);
    }
    const why = distProblem(path.join(trial, "app"), path.join(trial, "app", "bin", "lib", "worker", "dist"));
    if (why) throw new Error(`The payload's worker wouldn't start: its parts are ${why} for its code. A file the build stamp reads is missing from payloadFiles().`);
  } finally {
    fs.rmSync(trial, { recursive: true, force: true });
  }
  const packed = zlib.gzipSync(raw, { level: 9 });
  const payloadSha256 = sha256(packed);
  const status = git(["status", "--porcelain"]);
  const manifest = {
    format: 1,
    id: payloadSha256.slice(0, 12),
    payloadSha256,
    payloadBytes: packed.length,
    unpackedBytes: raw.length,
    files: files.length,
    git: { commit: git(["rev-parse", "HEAD"]), changedFiles: status === null ? null : status.split("\n").filter(Boolean).length },
    node: { version: process.versions.node, sha256: sha256(fs.readFileSync(node)) },
    packages: packageClosure(RUNTIME_PACKAGES).map((p) => `${p.name}@${p.version}`),
  };

  fs.mkdirSync(out, { recursive: true });
  const work = path.join(out, "sea");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "payload.bin"), packed);
  fs.writeFileSync(path.join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.copyFileSync(path.join(ROOT, "bin", "lib", "worker", "setup", "sea-main.cjs"), path.join(work, "sea-main.cjs"));
  const exe = path.join(out, EXE_NAME);
  fs.rmSync(exe, { force: true });
  fs.writeFileSync(
    path.join(work, "sea-config.json"),
    JSON.stringify({ main: "sea-main.cjs", output: exe, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets: { "payload.bin": "payload.bin", "manifest.json": "manifest.json" } }, null, 2),
  );
  const r = spawnSync(node, ["--build-sea", "sea-config.json"], { cwd: work, stdio: "inherit" });
  if (r.status !== 0 || !fs.existsSync(exe)) throw new Error("node --build-sea didn't make the exe (Node 25.5 or later is needed).");
  const exeSha = sha256(fs.readFileSync(exe));
  fs.writeFileSync(`${exe}.sha256`, `${exeSha}  ${EXE_NAME}\n`);
  fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify({ ...manifest, exe: { name: EXE_NAME, sha256: exeSha, bytes: fs.statSync(exe).size } }, null, 2)}\n`);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`${files.length} files, payload ${(packed.length / 2 ** 20).toFixed(1)} MB (id ${manifest.id}), Node ${manifest.node.version}, commit ${manifest.git.commit?.slice(0, 9)}${manifest.git.changedFiles ? ` with ${manifest.git.changedFiles} changed files` : ""}`);
  console.log(`${rel(exe).startsWith("..") ? exe : rel(exe)}`);
  console.log(`SHA-256 ${exeSha}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
