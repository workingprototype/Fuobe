// The start of "Fuobe Worker Setup.exe" (a Node single executable application, scripts/build-worker-exe.mjs). The exe
// carries two files: manifest.json and payload.bin (a gzip of a Node runtime and the worker's code). This unpacks the
// payload once, after checking its SHA-256 against the manifest, into %LOCALAPPDATA%\Fuobe\worker\versions\<id>, and
// runs the setup program (setup/main.mjs) there with the Node it carries. With --check it unpacks into a temporary
// folder and removes it after. CommonJS with built-in modules only: the exe has nothing else.
/* eslint-disable @typescript-eslint/no-require-imports -- the exe starts as CommonJS with Node's own modules only */
"use strict";
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const MAGIC = "FWSP1\n";

/** The entries of an unpacked payload: [{ p (a path with /), s (bytes) }, data] in order. Pure (tests use it). */
function readPayload(raw) {
  const out = [];
  if (raw.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) throw new Error("The setup's files are damaged (no payload header).");
  let at = MAGIC.length;
  while (at < raw.length) {
    const len = raw.readUInt32LE(at);
    at += 4;
    const head = JSON.parse(raw.subarray(at, at + len).toString("utf8"));
    at += len;
    if (typeof head.p !== "string" || !Number.isSafeInteger(head.s) || head.s < 0 || at + head.s > raw.length) throw new Error("The setup's files are damaged (a bad entry).");
    const parts = head.p.split("/");
    if (!head.p || head.p.startsWith("/") || /^[A-Za-z]:/.test(head.p) || parts.some((x) => x === ".." || x === "." || x === "" || /[\\:*?"<>|]/.test(x))) throw new Error(`The setup's files are damaged (a bad path: ${head.p}).`);
    out.push({ path: head.p, data: raw.subarray(at, at + head.s) });
    at += head.s;
  }
  return out;
}

/** Writes the payload's entries into `dir` (a new folder next to it first, then renamed into place). */
function unpackInto(entries, dir) {
  const tmp = `${dir}.part-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const e of entries) {
    const file = path.join(tmp, ...e.path.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, e.data);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(tmp, dir);
}

function pauseThenExit(code) {
  if (process.stdin.isTTY && !process.argv.includes("--no-pause")) {
    process.stdout.write("\nPress Enter to close this window.");
    try {
      fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    } catch {}
  }
  process.exit(code);
}

function main() {
  const sea = require("node:sea");
  const manifest = JSON.parse(sea.getAsset("manifest.json", "utf8"));
  const args = process.argv.slice(2);
  // --code-dir <dir>: unpack into <dir>\<id> instead (a test that leaves this PC's own folders alone).
  const at = args.indexOf("--code-dir");
  const codeBase = at >= 0 ? args.splice(at, 2)[1] : null;
  if (at >= 0 && !codeBase) throw new Error("--code-dir needs a folder");
  if (args.includes("--version")) {
    process.stdout.write(`Fuobe Worker Setup ${manifest.id} (commit ${manifest.git?.commit ?? "unknown"}, Node ${manifest.node?.version})\n`);
    return 0;
  }
  const check = args.includes("--check");
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const dir = check ? path.join(os.tmpdir(), `fuobe-worker-setup-${manifest.id}-${process.pid}`) : path.join(codeBase ? path.resolve(codeBase) : path.join(base, "Fuobe", "worker", "versions"), manifest.id);
  const done = path.join(dir, ".complete");
  let whole = false;
  try {
    whole = fs.readFileSync(done, "utf8").trim() === manifest.payloadSha256;
  } catch {}
  if (!whole) {
    process.stdout.write("Unpacking the worker...\n");
    const packed = Buffer.from(sea.getRawAsset ? sea.getRawAsset("payload.bin") : sea.getAsset("payload.bin"));
    if (crypto.createHash("sha256").update(packed).digest("hex") !== manifest.payloadSha256) throw new Error("The setup's files are damaged (their SHA-256 doesn't match). Get the setup again.");
    unpackInto(readPayload(zlib.gunzipSync(packed)), dir);
    fs.writeFileSync(done, `${manifest.payloadSha256}\n`);
  }
  try {
    const node = path.join(dir, "node", "node.exe");
    const program = path.join(dir, "app", "bin", "lib", "worker", "setup", "main.mjs");
    const r = spawnSync(node, [program, ...args, "--no-pause"], { stdio: "inherit" });
    return r.status ?? 1;
  } finally {
    if (check) fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  let code;
  try {
    code = main();
  } catch (e) {
    process.stdout.write(`\nSetup stopped: ${e.message}\n`);
    code = 1;
  }
  pauseThenExit(code);
}

module.exports = { readPayload, MAGIC };
