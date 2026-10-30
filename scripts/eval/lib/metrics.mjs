// The bridge to the Python metrics (scripts/eval/metrics): find the venv pnpm eval:setup made (or
// uv), run the scorer on a run folder and read metrics.json back. With no Python, a run still gets
// its timing and cost; the scores say they were skipped and why.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { METRICS_DIR } from "./paths.mjs";
import { readJson } from "./store.mjs";

const VENV_PY = process.platform === "win32" ? path.join(METRICS_DIR, ".venv", "Scripts", "python.exe") : path.join(METRICS_DIR, ".venv", "bin", "python");

/** How to start the scorer: the venv's Python, else `uv run` with the pinned requirements, else null (with why). */
export function pythonCommand(env = process.env) {
  if (env.FUOBE_EVAL_PYTHON) return { cmd: env.FUOBE_EVAL_PYTHON, args: [], how: "FUOBE_EVAL_PYTHON" };
  if (fs.existsSync(VENV_PY)) return { cmd: VENV_PY, args: [], how: "scripts/eval/metrics/.venv" };
  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (uv.status === 0) return { cmd: "uv", args: ["run", "--no-project", "--with-requirements", path.join(METRICS_DIR, "requirements.txt"), "python"], how: "uv run (first use downloads the pinned packages)" };
  return null;
}

/** Score a run folder; resolves with {ok, file, doc, skipped} and streams the scorer's progress to `log`. */
export function scoreRun(dir, { metrics, device, clipModel, styleModel, identityModel, faceDetector, commercialOnly, force, log = () => {}, env = process.env } = {}) {
  const py = pythonCommand(env);
  if (!py) return Promise.resolve({ ok: false, reason: "No Python for the metrics: run pnpm eval:setup (needs uv), or set FUOBE_EVAL_PYTHON" });
  const args = [
    ...py.args,
    "-m",
    "fuobe_metrics.score",
    dir,
    ...(metrics ? ["--metrics", metrics] : []),
    ...(device ? ["--device", device] : []),
    ...(clipModel ? ["--clip-model", clipModel] : []),
    ...(styleModel ? ["--style-model", styleModel] : []),
    ...(identityModel ? ["--identity-model", identityModel] : []),
    ...(faceDetector ? ["--face-detector", faceDetector] : []),
    ...(commercialOnly ? ["--commercial-only"] : []),
    ...(force ? ["--force"] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn(py.cmd, args, { cwd: METRICS_DIR, env: { ...env, PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (d) => {
      const text = d.toString();
      tail = (tail + text).slice(-4000);
      for (const line of text.split("\n")) if (line.trim()) log(`  ${line.trim()}`);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => resolve({ ok: false, reason: `Couldn't start ${py.cmd}: ${e.message}` }));
    child.on("close", (code) => {
      const file = path.join(dir, "metrics.json");
      if (code !== 0) return resolve({ ok: false, reason: `the scorer stopped (exit ${code}): ${tail.trim().split("\n").at(-1) ?? ""}` });
      const doc = readJson(file);
      resolve({ ok: !!doc, file, doc, skipped: doc?.skipped ?? {}, how: py.how });
    });
  });
}
