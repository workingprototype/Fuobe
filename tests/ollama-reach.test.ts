import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-ollama-reach-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const llm = await import("@/server/providers/llm");
const { REACH } = await import("@/server/providers/reach");

/** A stand-in Ollama: /api/tags answers `status` after `delay` ms (busy loading a model, it answers late but takes the connection). */
let delay = 0;
let status = 200;
let asked = 0;
const server = http.createServer((req, res) => {
  if (req.url !== "/api/tags") return void res.writeHead(404).end();
  asked++;
  setTimeout(() => {
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  }, delay);
});
let ollamaUrl = "";
const reach = { ...REACH };
/** An open-source translation: Ollama runs it when it answers (ComfyUI, its fallback, is off here). */
const ROUTE = { endpoint: "ollama", op: "translate" as const };

/** A port nothing listens on: connecting is refused at once. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as net.AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

/** An Ollama that answers /api/tags at once, in a process of its own; it prints its port. */
const OTHER_PROCESS_OLLAMA = `const s = require("node:http").createServer((q, r) => q.url === "/api/tags" ? r.end(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3:8b" }] })) : r.writeHead(404).end());
s.listen(0, "127.0.0.1", () => console.log(s.address().port));`;

/** What `f` gives once it's truthy (polled every 100 ms, for at most `ms`). */
const until = async <T>(f: () => T | undefined | null | false, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** Forget what the probes found, as a fresh start does. */
const forget = () => {
  globalThis.__fuobeOllamaReach = undefined;
  globalThis.__fuobeReachChecks?.delete("ollama");
};

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ollamaUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  // Checks give up sooner here, so a late answer is quick to make (a 3 s answer still makes the longer look).
  Object.assign(REACH, { answerMs: 300, connectMs: 1000, lookMs: 5000 });
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "ollama");
});
afterAll(() => {
  Object.assign(REACH, reach);
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  delay = 0;
  status = 200;
  setSetting("ollamaUrl", ollamaUrl);
  forget();
});

describe("Ollama reachability under load", () => {
  it("a busy Ollama that answered before stays reachable", async () => {
    expect(await llm.probeOllama(true)).toBe(true);
    // Busy with a long generation: the answer comes long after the check gives up (and after the old 1.5 s limit).
    delay = 2000;
    for (let i = 0; i < 2; i++) expect(await llm.probeOllama(true)).toBe(true);
    expect(llm.llmBackends(ROUTE)).toEqual(["ollama"]);
    // Back to answering: still reachable, and the answer counts again.
    delay = 0;
    expect(await llm.probeOllama(true)).toBe(true);
    expect(globalThis.__fuobeOllamaReach?.seen).toBeGreaterThan(Date.now() - 1000);
  });

  it("a refused port is unreachable at once, in the blocking first check and the background one", async () => {
    setSetting("ollamaUrl", `http://127.0.0.1:${await closedPort()}`);
    let t0 = Date.now();
    expect(llm.llmBackends(ROUTE)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1500);
    t0 = Date.now();
    expect(await llm.probeOllama(true)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("an HTTP error is down at once, without the longer look", async () => {
    status = 503;
    const t0 = Date.now();
    expect(await llm.probeOllama(true)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(asked).toBeGreaterThan(0);
  });

  it("no answer in time is busy when Ollama answered lately, unreachable when it didn't and its port refuses", async () => {
    const url = `http://127.0.0.1:${await closedPort()}`;
    setSetting("ollamaUrl", url);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    try {
      expect(await llm.probeOllama(true)).toBe(false);
      // It answered a minute ago: busy, so still reachable.
      globalThis.__fuobeOllamaReach = { ok: true, at: Date.now() - 60_000, url, seen: Date.now() - 60_000 };
      expect(await llm.probeOllama(true)).toBe(true);
      // Its last answer is long past, and nothing takes the connection.
      globalThis.__fuobeOllamaReach = { ok: true, at: Date.now() - 60_000, url, seen: Date.now() - REACH.answeredLatelyMs - 1000 };
      expect(await llm.probeOllama(true)).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("the first check of a slow but alive Ollama says reachable (blocking, then in the longer look)", async () => {
    delay = 3000;
    // The routing question right after start: Ollama takes the connection while it's busy.
    const t0 = Date.now();
    expect(llm.llmBackends(ROUTE)).toEqual(["ollama"]);
    expect(Date.now() - t0).toBeLessThan(3000);
    forget();
    expect(await llm.probeOllama(true)).toBe(true);
    // Callers while a check runs share it: one quick ask, one longer look.
    forget();
    asked = 0;
    expect(await Promise.all([llm.probeOllama(true), llm.probeOllama(true), llm.probeOllama()])).toEqual([true, true, true]);
    expect(asked).toBe(2);
  });

  it("a port that takes the connection but never answers (a tunnel or proxy whose Ollama is gone) is unreachable after the longer look", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    try {
      setSetting("ollamaUrl", `http://127.0.0.1:${(silent.address() as net.AddressInfo).port}`);
      // The first, blocking check can only see the connection taken, as for a busy Ollama; the background check says for sure.
      llm.llmBackends(ROUTE);
      await until(() => globalThis.__fuobeOllamaReach?.ok === false);
      // Found silent: no longer look again for a while, so the next checks are quick.
      const t0 = Date.now();
      for (let i = 0; i < 2; i++) expect(await llm.probeOllama(true)).toBe(false);
      expect(Date.now() - t0).toBeLessThan(2 * REACH.answerMs + 500);
      expect(llm.llmBackends(ROUTE)).toEqual([]);
    } finally {
      silent.close();
    }
  });

  it("Assist reads the same check: a busy Ollama keeps chats on it, with the models it last listed", async () => {
    const agent = await import("@/server/assist/agent");
    expect(await llm.probeOllama(true)).toBe(true);
    expect(llm.ollamaModels()).toEqual(["qwen3:8b"]);
    // Busy: its list comes after Assist's old 0.8 s limit, which took Ollama for gone and chats to the offline planner.
    delay = 1500;
    expect(await llm.probeOllama(true)).toBe(true);
    expect(await agent.availability()).toMatchObject({ ollama: true, ollamaModels: ["qwen3:8b"] });
    setSetting("enhanceProvider", "auto");
    try {
      expect(await agent.resolveAgent()).toBe("ollama");
    } finally {
      setSetting("enhanceProvider", "ollama");
    }
    // A refused port is down for Assist too, with no models.
    setSetting("ollamaUrl", `http://127.0.0.1:${await closedPort()}`);
    expect(await agent.availability()).toMatchObject({ ollama: false, ollamaModels: [] });
  });

  it("Assist doesn't wait on an Ollama that takes the connection but never answers: it reads the check, which goes on behind", async () => {
    const agent = await import("@/server/assist/agent");
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    try {
      setSetting("ollamaUrl", `http://127.0.0.1:${(silent.address() as net.AddressInfo).port}`);
      // The first look: no answer yet, but the port took the connection, so busy for now (as routing's first check says).
      let t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ ollama: true, ollamaModels: [] });
      expect(Date.now() - t0).toBeLessThan(2500);
      // The check behind it says for sure after the longer look; Assist doesn't wait for that either.
      await until(() => globalThis.__fuobeOllamaReach?.ok === false);
      t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ ollama: false, ollamaModels: [] });
      expect(await agent.resolveMode({ mode: "free" })).toMatchObject({ agent: "offline" });
      expect(Date.now() - t0).toBeLessThan(300);
      // Its cache is old: the answer it has, at once, and a fresh check in the background.
      globalThis.__fuobeOllamaReach = { ...globalThis.__fuobeOllamaReach!, at: Date.now() - 60_000 };
      t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ ollama: false });
      expect(Date.now() - t0).toBeLessThan(300);
      await until(() => Date.now() - (globalThis.__fuobeOllamaReach?.at ?? 0) < 10_000);
    } finally {
      silent.close();
    }
  });

  it("after routing's blocking first check, Assist lists Ollama's models (that check can't read them)", async () => {
    const agent = await import("@/server/assist/agent");
    // An Ollama in another process, so the blocking check (which holds this thread) gets its answer.
    const child = spawn(process.execPath, ["-e", OTHER_PROCESS_OLLAMA], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        child.stdout.once("data", (d: Buffer) => resolve(Number(String(d).trim())));
        child.once("exit", () => reject(new Error("the stand-in Ollama exited")));
      });
      setSetting("ollamaUrl", `http://127.0.0.1:${port}`);
      expect(llm.llmBackends(ROUTE)).toEqual(["ollama"]);
      // A sure answer: no check goes on behind it, and none has read the models yet.
      expect(globalThis.__fuobeOllamaReach).toMatchObject({ ok: true });
      expect(await agent.availability()).toMatchObject({ ollama: true, ollamaModels: ["qwen3:8b", "llama3:8b"] });
    } finally {
      child.kill();
    }
  });

  it("a late Ollama that answers the longer look is reachable; a check of an address changed meanwhile keeps to itself", async () => {
    delay = 1000;
    const old = llm.probeOllama(true);
    // While that check runs, the address changes and the new one is checked.
    setSetting("ollamaUrl", `http://127.0.0.1:${await closedPort()}`);
    expect(await llm.probeOllama(true)).toBe(false);
    const now = globalThis.__fuobeOllamaReach;
    expect(await old).toBe(true);
    expect(globalThis.__fuobeOllamaReach).toBe(now);
    setSetting("ollamaUrl", ollamaUrl);
    forget();
    expect(await llm.probeOllama(true)).toBe(true);
    expect(globalThis.__fuobeOllamaReach?.seen).toBeGreaterThan(Date.now() - 1000);
  });
});
