import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_READS } from "../scripts/check-worker-build.mjs";
import { tempDir } from "./helpers/temp-dir";

/**
 * The worker program's built parts load as a worker loads them (scripts/check-worker-build.mjs, also a step of the
 * deploy workflow): the build into a fresh folder, then every built .mjs file imported by Node itself (a child process,
 * not this test runner's module loader, which would find files Node doesn't), and the exports the worker program reads
 * from them. Typecheck and the other tests run the TypeScript sources, so a built file that imports a file the build
 * doesn't include passes them and stops every worker at its start; this test fails on it.
 */

const ROOT = path.resolve(__dirname, "..");
const check = (...args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts/check-worker-build.mjs"), ...args], { cwd: ROOT, encoding: "utf8" });

describe("the worker's built parts", () => {
  it("build and load: every built module imports in Node, with the exports the worker program reads", () => {
    const r = check();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^worker build: \d+ modules load\n$/);
    expect(Number(/(\d+) modules/.exec(r.stdout)![1])).toBeGreaterThan(100);
  }, 120_000);

  it("names every built file the worker program imports by name", () => {
    const dir = path.join(ROOT, "bin/lib/worker");
    const named = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
      for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/import\(\s*"\.\/dist\/([^"]+\.mjs)"\s*\)/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(0);
    expect([...named].sort()).toEqual(Object.keys(WORKER_READS).sort());
  });

  it("fails on an import the build doesn't include, one with no extension, an export the worker reads that is gone, or a part not built", () => {
    const dir = tempDir("fuobe-worker-broken-");
    fs.mkdirSync(path.join(dir, "compose/lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "local-comfy.mjs"), 'import { parseArgv } from "./gpu/argv.mjs";\nexport const x = parseArgv;\n');
    fs.writeFileSync(path.join(dir, "relay.mjs"), 'import { other } from "./lanes";\nexport const y = other;\n');
    fs.writeFileSync(path.join(dir, "lanes.mjs"), "export const other = 1;\n");
    fs.writeFileSync(path.join(dir, "engine-error.mjs"), "export const withoutLocalPaths = (s) => s;\n");
    fs.writeFileSync(path.join(dir, "compose/lib/ticket-compose.mjs"), "export const composeTicket = () => null;\nexport const workerFactsFrom = () => null;\n");
    const r = check("--dir", dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    const lines = r.stderr.trim().split("\n").slice(1).map((l) => l.trim());
    expect(lines).toEqual([
      expect.stringMatching(/^local-comfy\.mjs: .*gpu[\\/]argv\.mjs/),
      expect.stringMatching(/^relay\.mjs: .*lanes/),
      "computer-runner.mjs: not built, and the worker program imports it",
      "lanes.mjs: has no export allLanes, which the worker program reads",
    ]);
    const empty = tempDir("fuobe-worker-empty-");
    expect(check("--dir", empty).stderr).toContain(`${empty}: no built .mjs file`);
  }, 60_000);
});
