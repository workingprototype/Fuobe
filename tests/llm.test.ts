import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 40_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const llm = await import("@/server/providers/llm");
const { getModel, modelsFor } = await import("@/lib/catalog");

// A stand-in Ollama: answers numbered subtitle lines line by line, anything else with a prefix.
const seen: { system: string; user: string; model: string }[] = [];
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
    const system = j.messages[0].content;
    const user = j.messages[1].content;
    seen.push({ system, user, model: j.model });
    const lang = /into (\w+)/.exec(system)?.[1] ?? "??";
    const content = /^\[\d+\]/.test(user)
      ? user
          .split("\n")
          .map((l) => l.replace(/^\[(\d+)\]\s*/, (_, n) => `[${n}] (${lang}) `))
          .join("\n")
      : `<think>hmm</think>(${lang}) ${user}`;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content } }));
  });
});
let ollama = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ollama = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setSetting("demoMode", "auto");
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  seen.length = 0;
  setSetting("anthropicKey", "");
  setSetting("engineMode", "");
  setSetting("enhanceProvider", "");
  setSetting("demoMode", "auto");
});

async function settle(id: string, ms = 20_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const useOllama = async (up: boolean) => {
  setSetting("ollamaUrl", up ? ollama : "http://127.0.0.1:9");
  await llm.probeOllama(true);
};

const CUES = JSON.stringify([
  { start: 0, end: 1.8, text: "Hello there." },
  { start: 2, end: 4.25, text: "This is a test\nwith two lines." },
]);

describe("text models", () => {
  it("are registered as text models with a cloud and an open route", () => {
    expect(getModel("text-llm")).toMatchObject({ kind: "text", engine: "cloud" });
    expect(getModel("oss-text-llm")).toMatchObject({ kind: "text", engine: "open" });
    // Only pickers that ask for text see them.
    expect(modelsFor({ kind: "image" }).some((m) => m.kind === "text")).toBe(false);
    expect(modelsFor({ kind: "text", ops: ["translate"] }).map((m) => m.id)).toEqual(expect.arrayContaining(["text-llm", "oss-text-llm"]));
  });
});

describe("LLM provider", () => {
  it("translates subtitles cue by cue on Ollama and keeps the timing", async () => {
    await useOllama(true);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: CUES, params: { targetLanguage: "Spanish" } });
    expect(g.provider).toBe("llm");
    expect(g.kind).toBe("text");
    expect(g.costUsd).toBe(0);
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    const out = done.outputs[0];
    expect(out).toMatchObject({ kind: "text", contentType: "application/x-subrip" });
    expect(out.url).toMatch(/\.srt$/);
    expect(out.meta?.cues).toEqual([
      { start: 0, end: 1.8, text: "(Spanish) Hello there." },
      { start: 2, end: 4.25, text: "(Spanish) This is a test\nwith two lines." },
    ]);
    expect(out.text).toBe("(Spanish) Hello there.\n(Spanish) This is a test\nwith two lines.");
    // One call for the batch, multi-line cues kept together.
    expect(seen).toHaveLength(1);
    expect(seen[0].user).toBe("[1] Hello there.\n[2] This is a test <br> with two lines.");
    expect(seen[0].model).toBe("qwen3:8b");
  });

  it("translates SRT and plain text too", async () => {
    await useOllama(true);
    const srt = "1\n00:00:01,000 --> 00:00:02,500\nBonjour\n\n2\n00:00:03,000 --> 00:00:04,000\nÇa va ?\n";
    const [a] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: srt, params: { targetLanguage: "English" } });
    const [b] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: "Good morning, friends.", params: { targetLanguage: "German" } });
    const [da, db] = [await settle(a.id), await settle(b.id)];
    expect(da.outputs[0].meta?.cues).toEqual([
      { start: 1, end: 2.5, text: "(English) Bonjour" },
      { start: 3, end: 4, text: "(English) Ça va ?" },
    ]);
    expect(db.outputs[0]).toMatchObject({ kind: "text", contentType: "text/plain", text: "(German) Good morning, friends." });
    expect(db.outputs[0].url).toMatch(/\.txt$/);
  });

  it("writes from a brief with an optional system prompt", async () => {
    await useOllama(true);
    const [g] = gens.createGenerations({ feature: "ads", modelId: "text-llm", op: "write", prompt: "Three hooks for a perfume ad", params: { extra: { system: "You write punchy hooks into French." } } });
    const done = await settle(g.id);
    expect(done.status).toBe("succeeded");
    expect(seen[0].system).toBe("You write punchy hooks into French.");
    expect(done.outputs[0].text).toBe("(French) Three hooks for a perfume ad");
  });

  it("uses Claude when a key is set (falling back to Ollama), never on the open model", async () => {
    await useOllama(true);
    setSetting("anthropicKey", "sk-ant-test");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["claude", "ollama"]);
    expect(llm.llmBackends({ endpoint: "ollama" })).toEqual(["ollama"]);
    setSetting("engineMode", "open");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["ollama"]);
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x", params: { targetLanguage: "Spanish" } })).toThrow(/open source only/);
    setSetting("engineMode", "");
    setSetting("enhanceProvider", "none");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual([]);
    setSetting("enhanceProvider", "");

    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    let status = 200;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
      sent.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      const body =
        status === 200
          ? { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Hola, amigos." }], stop_reason: "end_turn", stop_sequence: null, stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } }
          : { type: "error", error: { type: "invalid_request_error", message: "nope" } };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const [g] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "Hello, friends.", params: { targetLanguage: "Spanish" } });
      expect(g.costUsd).toBe(0.02);
      const done = await settle(g.id);
      expect(done.outputs[0].text).toBe("Hola, amigos.");
      expect(sent[0].body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default" });
      expect(String(sent[0].body.system)).toMatch(/into Spanish/);
      expect(seen).toHaveLength(0);
      // Claude fails: Ollama takes over.
      status = 400;
      const [h] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "Bye.", params: { targetLanguage: "Spanish" } });
      expect((await settle(h.id)).outputs[0].text).toBe("(Spanish) Bye.");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("with no LLM: demo text in demo mode (timing kept), a clear error otherwise", async () => {
    await useOllama(false);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: CUES, params: { targetLanguage: "Italian" } });
    expect(g.provider).toBe("mock");
    const done = await settle(g.id);
    expect(done.outputs[0].meta).toMatchObject({ demo: true, cues: [{ start: 0, end: 1.8, text: "[Italian] Hello there." }, { start: 2, end: 4.25 }] });
    const [w] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "A tagline for a bakery" });
    expect((await settle(w.id)).outputs[0].text).toMatch(/Demo script for: A tagline for a bakery/);
    setSetting("demoMode", "off");
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x", params: { targetLanguage: "Italian" } })).toThrow(/Connect Claude or Ollama in Settings/);
    expect(() => gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "write", prompt: "x" })).toThrow(/Connect Ollama in Settings/);
  });

  it("asks for a language before translating", () => {
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x" })).toThrow(/Pick a language/);
  });

  it("fails a job that a restart interrupted", async () => {
    const res = await llm.llmProvider.poll({ externalId: "llm_gone", meta: {}, route: getModel("text-llm")!.routes[0], model: getModel("text-llm")!, createdAt: Date.now() });
    expect(res).toMatchObject({ state: "failed", error: expect.stringMatching(/Interrupted/) });
  });
});
