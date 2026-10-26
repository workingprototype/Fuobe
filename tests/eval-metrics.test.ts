import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The evaluation harness's metric tests (scripts/eval/metrics/tests, pytest). They run in the
 * metrics venv when pnpm eval:setup made one, else through uv with the small test requirements;
 * with neither (or no network for uv's first install) they are skipped, not failed.
 */

const METRICS = path.join(process.cwd(), "scripts/eval/metrics");
const VENV = path.join(METRICS, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");

function python(): { cmd: string; args: string[] } | null {
  if (fs.existsSync(VENV)) return { cmd: VENV, args: [] };
  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (uv.status !== 0) return null;
  return { cmd: "uv", args: ["run", "--no-project", "--with-requirements", path.join(METRICS, "requirements-test.txt"), "python"] };
}

const py = python();
// Can that Python import what the maths tests need? (uv's first run downloads them; offline it can't.)
const ready = py && spawnSync(py.cmd, [...py.args, "-c", "import numpy, PIL, pytest"], { cwd: METRICS, encoding: "utf8", timeout: 300_000 }).status === 0;

describe.skipIf(!ready)("metric maths and media (pytest)", () => {
  it("passes", () => {
    const r = spawnSync(py!.cmd, [...py!.args, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], { cwd: METRICS, encoding: "utf8", timeout: 600_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/\d+ passed/);
  }, 600_000);
});
