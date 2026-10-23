// A run's folder (results/<runId>/): run.json (what ran, where, with which settings), jobs.jsonl
// (one line per job as it finishes, so a run can resume), outputs/, metrics.json, summary.json,
// the review page and its ratings. results/history.jsonl keeps every run's per-case scores.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const runDir = (root, runId) => path.join(root, runId);

/** 20261023-224501-soul-open-a1b2 */
export function newRunId(suite, engine, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${suite}-${engine}-${crypto.randomBytes(2).toString("hex")}`;
}

export const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/** The latest line per job id (a resumed run appends a new line for a job it retried). */
export function latestJobs(dir) {
  const byId = new Map();
  for (const row of readJsonl(path.join(dir, "jobs.jsonl"))) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * A run by id, by a path, or "latest" / "latest~1" (the newest run, the one before…). `name:variant` keeps
 * one variant's jobs (compare two variants of the same run).
 */
export function resolveRun(root, ref) {
  const [name, variant] = String(ref).split(/:(?=[^/\\]*$)/);
  let dir;
  const latest = /^latest(?:~(\d+))?$/.exec(name);
  if (latest) {
    const runs = listRuns(root);
    const pick = runs[Number(latest[1] ?? 0)];
    if (!pick) throw new Error(`No runs in ${root} yet`);
    dir = pick.dir;
  } else if (fs.existsSync(path.join(root, name, "run.json"))) dir = path.join(root, name);
  else if (fs.existsSync(path.join(name, "run.json"))) dir = path.resolve(name);
  else throw new Error(`There's no run “${name}” in ${root} (pnpm eval:history lists them)`);
  return { dir, runId: path.basename(dir), variant: variant || null };
}

/** Runs newest first: {runId, dir, run}. */
export function listRuns(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "run.json")))
    .map((d) => ({ runId: d.name, dir: path.join(root, d.name), run: readJson(path.join(root, d.name, "run.json"), {}) }))
    .sort((a, b) => (b.run.startedAt ?? 0) - (a.run.startedAt ?? 0) || b.runId.localeCompare(a.runId));
}

/** Replace a run's lines in results/history.jsonl with `rows` (a report run again doesn't count twice). */
export function writeHistory(root, runId, rows) {
  const file = path.join(root, "history.jsonl");
  const kept = readJsonl(file).filter((r) => r.runId !== runId);
  fs.mkdirSync(root, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, [...kept, ...rows].map((r) => JSON.stringify(r)).join("\n") + (kept.length + rows.length ? "\n" : ""));
  fs.renameSync(tmp, file);
  return file;
}
