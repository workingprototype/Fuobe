/**
 * Better Auth's connection and Fuobe's share one SQLite file (docs/research/accounts-8.md §7.1). Busy waits
 * block the event loop, so a lock held across an await would stall everything: 50 sign-ins while a runner keeps
 * writing must never wait anywhere near the 5 s busy timeout (each wait stays under 1 s), and nothing fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-load-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET"]) delete process.env[k];

const { db } = await import("@/server/db");
const { bootstrapIdentity } = await import("@/server/identity/bootstrap");
const { signInOwner } = await import("@/server/identity/owner");
const { setOwnerPassword } = await import("./helpers/identity");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

await bootstrapIdentity();
const PASSWORD = "correct horse battery";
await setOwnerPassword(PASSWORD);

describe("sign-ins while the runner writes", () => {
  it("50 sign-ins succeed, the runner's writes all land, and no busy wait reaches 1 s", { timeout: 60_000 }, async () => {
    // A runner: a write transaction every couple of milliseconds, like the generation runner's ticks.
    let writes = 0;
    const failures: string[] = [];
    const upsert = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const tick = db().transaction((n: number) => {
      for (let i = 0; i < 20; i++) upsert.run(`load.${n % 50}.${i}`, String(n));
    });
    const runner = setInterval(() => {
      try {
        tick(writes++);
      } catch (e) {
        failures.push((e as Error).message);
      }
    }, 2);

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const durations: number[] = [];
    try {
      for (let batch = 0; batch < 10; batch++) {
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            const t = performance.now();
            const r = await signInOwner(PASSWORD, new Headers({ "user-agent": `load test ${batch}` }));
            durations.push(performance.now() - t);
            if (!r.ok) failures.push(`sign-in: ${r.code ?? "refused"}`);
          }),
        );
      }
    } finally {
      clearInterval(runner);
      delay.disable();
    }

    expect(failures).toEqual([]);
    expect(durations).toHaveLength(50);
    expect(writes).toBeGreaterThan(50);
    expect((db().prepare("SELECT COUNT(*) AS n FROM auth_session").get() as { n: number }).n).toBe(50);
    // A busy wait blocks the event loop: the longest block is the longest wait.
    expect(delay.max / 1e6).toBeLessThan(1000);
  });
});
