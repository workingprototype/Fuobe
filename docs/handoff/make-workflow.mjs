#!/usr/bin/env node
// Writes the build workflow script from docs/handoff/queue.json and workflow.body.js (docs/HANDOFF.md explains it).
// Usage: node docs/handoff/make-workflow.mjs <out.js> --trailer-file <file> [--repo <dir>] [--wt <dir>] [--ext <dir>]
//          [--base <branch>] [--skip key,key] [--only R,O,A] [--done <results.json>] [--remove-worktrees]
//   --trailer-file  the lines every commit message ends with (this session's attribution lines)
//   --repo          the checkout the integrator merges in (default: this repository's top folder)
//   --wt            where package worktrees go (default: <repo>/../wt)
//   --ext           the folder of owner-shared and downloaded inputs that briefs call @EXT@ (default: <repo>/../ext)
//   --skip          packages already merged (left out of their lanes)
//   --only          the lanes to run (default: every lane in the queue)
//   --done          a JSON object { key: { impl?, review?, fix? } } of stages finished since the queue was written
//                   (for example a stopped workflow's results); merged over the queue's own `done`
//   --remove-worktrees  the integrator removes clean worktrees of merged branches (only with the owner's go-ahead)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const out = argv[0];
const trailerFile = opt("--trailer-file");
if (!out || out.startsWith("--") || !trailerFile) {
  console.error("usage: node docs/handoff/make-workflow.mjs <out.js> --trailer-file <file> [options]");
  process.exit(2);
}

const repo = path.resolve(opt("--repo") ?? execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const wt = path.resolve(opt("--wt") ?? path.join(repo, "..", "wt"));
const ext = path.resolve(opt("--ext") ?? path.join(repo, "..", "ext"));
const queue = JSON.parse(fs.readFileSync(path.join(here, "queue.json"), "utf8"));
const base = opt("--base") ?? queue.base;
const trailer = fs.readFileSync(trailerFile, "utf8").trim();
const skip = new Set((opt("--skip") ?? "").split(",").filter(Boolean));
const only = opt("--only")?.split(",").filter(Boolean);
const done = { ...queue.done, ...(opt("--done") ? JSON.parse(fs.readFileSync(opt("--done"), "utf8")) : {}) };

const lanes = {};
for (const [name, keys] of Object.entries(queue.lanes)) {
  if (only && !only.includes(name)) continue;
  const left = keys.filter((k) => !skip.has(k));
  if (left.length) lanes[name] = left;
}
const pkgs = {};
for (const key of Object.values(lanes).flat()) {
  const p = queue.packages[key];
  if (!p) throw new Error(`queue.json has no package ${key}`);
  pkgs[key] = { key, title: p.title, phase: p.phase, brief: p.brief.replaceAll("@EXT@", ext) };
}
const keep = Object.fromEntries(Object.entries(done).filter(([k]) => k in pkgs));
const phases = [...new Set(Object.values(pkgs).map((p) => p.phase))];

const meta = {
  name: "fuobe-continue",
  description: `Continue Fuobe's build queue: lanes ${Object.keys(lanes).join(", ")}, ${Object.keys(pkgs).length} packages, each implement → review → fix → merge into ${base}`,
  phases: phases.map((title) => ({ title })),
};
const j = (v) => JSON.stringify(v);
const script = [
  `export const meta = ${JSON.stringify(meta, null, 2)}`,
  `const REPO = ${j(repo)}`,
  `const WT = ${j(wt)}`,
  `const BASE = ${j(base)}`,
  `const PLAN = 'docs/research/fuobe-originals-recipes-5.md'`,
  `const TRAILER = ${j(trailer)}`,
  `const REMOVE_WORKTREES = ${argv.includes("--remove-worktrees")}`,
  `const LANES = ${j(lanes)}`,
  `const DONE = ${j(keep)}`,
  `const PKGS = ${j(pkgs)}`,
  fs.readFileSync(path.join(here, "workflow.body.js"), "utf8"),
].join("\n");

const bytes = Buffer.byteLength(script);
if (bytes >= 512 * 1024) throw new Error(`the script is ${bytes} bytes; the Workflow tool takes under 512 KB: run fewer lanes (--only) or skip packages`);
fs.writeFileSync(out, script);
console.log(`${out}: ${Object.keys(pkgs).length} packages in lanes ${Object.entries(lanes).map(([n, k]) => `${n} (${k.length}, first ${k[0]})`).join(", ")}; reused stages for ${Object.keys(keep).join(", ") || "none"}; ${bytes} bytes`);
