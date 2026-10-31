import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeStream } from "./fixtures/claude-sse";
import { fakeLlm, type FakeLlm, type Mode } from "./helpers/fake-llm";

/*
 * Assist end to end on hosted providers, against fakes that enforce each provider's rules: Smart on an
 * OpenAI key alone reaches an approval card and carries OpenAI's reasoning through the tool loop; a chat
 * moves Claude → DeepSeek → Gemini → Claude and each provider takes the history (DeepSeek gets other
 * models' calls as text, Gemini the documented dummy signature, and Anthropic never sees replay data);
 * Free on OpenRouter's free models moves to the local model when the day's free requests run out, and
 * tries the step again.
 */

vi.setConfig({ testTimeout: 60_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-providers-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
for (const k of Object.keys(process.env)) if (/_API_KEY$|^HF_TOKEN$|^FUOBE_LLM_|^LM_API_TOKEN$|^LMSTUDIO_|^UNSLOTH_|^FUOBE_ENHANCE_PROVIDER$/.test(k)) delete process.env[k];

const { setSetting, SETTINGS } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const { modeLabel } = await import("@/lib/assist");
const { LLM_PROVIDERS, getLlmProvider } = await import("@/lib/catalog/llm-providers");

const fakes: FakeLlm[] = [];
const bases = new Map<string, string>();
async function fake(mode: Mode, provider: string = mode): Promise<FakeLlm> {
  const f = fakeLlm(mode, `${provider}-key-0123456789abcdef`);
  await f.start();
  fakes.push(f);
  setSetting(getLlmProvider(provider)!.keySetting as never, f.key);
  bases.set(provider, `${f.url}/v1`);
  process.env.FUOBE_LLM_TEST_BASE = [...bases].map(([k, v]) => `${k}=${v}`).join(",");
  return f;
}
/** Every provider key off, and the local server pinned to an address nothing answers. */
function disconnect() {
  for (const p of LLM_PROVIDERS) if (p.keySetting) setSetting(p.keySetting as keyof typeof SETTINGS, "");
  setSetting("llmProvider", "custom");
  setSetting("llmUrl", "http://127.0.0.1:9/v1");
  setSetting("llmKey", "");
  globalThis.__fuobeFreeSpent?.clear();
  globalThis.__fuobeOpenRouterKey = undefined;
}
beforeEach(disconnect);
afterAll(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  delete process.env.FUOBE_LLM_TEST_BASE;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const job = { model_id: "nano-banana-pro", prompt: "a red fox in snow, golden hour" };
const items = (id: string) => agent.getThread(id)!.thread.items;

describe("Smart on an OpenAI key alone", () => {
  it("plans with GPT-6.1 Sol, reaches the approval card, and keeps OpenAI's reasoning through the loop", async () => {
    const f = await fake("openai");
    const turn = [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-thinking" },
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "I'll make the fox photo.", annotations: [] }] },
      { type: "function_call", id: "fc_1", call_id: "call_gen1", name: "generate", arguments: JSON.stringify({ summary: "A fox photo", jobs: [job] }), status: "completed" },
    ];
    f.replies = [{ output: turn }, { text: "No problem — tell me what to change." }];
    const can = await agent.availability();
    expect(can.smart.plan).toMatchObject({ provider: "openai", model: "gpt-6.1-sol" });
    expect(can.smart.text).toBe("Smart uses GPT-6.1 Sol (OpenAI) to plan, pick models and check results.");
    expect(can.defaultMode).toBe("smart");
    const r = await agent.resolveMode({ mode: "smart" });
    expect(r).toMatchObject({ mode: "smart", agent: "hosted", provider: "openai", model: "gpt-6.1-sol", effort: "medium" });
    const t = agent.createThread({ engine: "cloud", agent: r.agent, mode: r.mode, provider: r.provider, model: r.model, effort: r.effort });
    agent.addMessage(t.id, "A photo of a fox in snow");
    await agent.run(t.id);
    const view = agent.getThread(t.id)!.thread;
    expect(view.status).toBe("waiting");
    expect(view.items.find((i) => i.role === "approval")).toMatchObject({ summary: expect.stringContaining("fox"), status: "pending" });
    expect(view.items.some((i) => i.role === "assistant" && i.text === "I'll make the fox photo.")).toBe(true);
    expect(modeLabel(view)).toBe("Smart · GPT-6.1 Sol");
    // The first request: stateless, the system prompt as instructions, Fuobe's tools.
    const first = f.chats()[0];
    expect(first).toMatchObject({ model: "gpt-6.1-sol", store: false, reasoning: { effort: "medium" } });
    expect(String(first.instructions)).toContain("You are Fuobe Assist");
    // Declining sends the result back with OpenAI's own items (the fake refuses the call without its reasoning).
    await agent.answerApproval(t.id, false);
    await agent.run(t.id);
    const second = f.chats()[1].input as Record<string, unknown>[];
    expect(second).toContainEqual(turn[0]);
    expect(second).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call_gen1" }));
    expect(items(t.id).at(-1)).toMatchObject({ role: "assistant", text: "No problem — tell me what to change." });
  });
});

describe("a chat that changes model", () => {
  it("moves Claude → DeepSeek → Gemini → Claude, each provider taking the history", async () => {
    setSetting("anthropicKey", "sk-ant-test-0123456789");
    const ds = await fake("deepseek");
    const gm = await fake("google");
    ds.issued.add("call_ds1");
    ds.replies = [{ reasoning: { field: "reasoning_content", text: "List models first." }, calls: [{ id: "call_ds1", name: "search_models", args: { kind: "video" } }] }, { reasoning: { field: "reasoning_content", text: "Done." }, text: "Two video models fit." }];
    gm.replies = [{ text: "Looking again.", calls: [{ id: "function-call-9", name: "search_models", args: { kind: "audio" }, extra: { google: { thought_signature: "Z2VtaW5p" } } }] }, { text: "Here are the audio ones." }];
    const anthropic: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      anthropic.push(body);
      return anthropic.length === 1
        ? claudeStream({ content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_01Claude", name: "search_models", input: { kind: "image" } }], stop_reason: "tool_use" })
        : claudeStream({ content: [{ type: "text", text: anthropic.length === 2 ? "Found some." : "Back on Claude." }], stop_reason: "end_turn" });
    }) as typeof fetch;
    try {
      const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "manual", model: "claude-sonnet-5-5", effort: "low" });
      agent.addMessage(t.id, "Which image models do I have?");
      await agent.run(t.id);
      await agent.updateThread(t.id, { mode: { mode: "manual", agent: "hosted", provider: "deepseek", model: "deepseek-v4-pro", effort: "high" } });
      agent.addMessage(t.id, "And video?");
      await agent.run(t.id);
      expect(items(t.id).at(-1)).toMatchObject({ role: "assistant", text: "Two video models fit." });
      // Claude's call went to DeepSeek as words; DeepSeek's own turn carried its reasoning back.
      const dsLast = ds.chats().at(-1)!.messages!;
      expect(JSON.stringify(dsLast)).toContain("search_models");
      expect(dsLast.some((m) => m.tool_calls?.some((c) => c.id === "toolu_01Claude"))).toBe(false);
      expect(dsLast.find((m) => m.tool_calls?.[0]?.id === "call_ds1")!.reasoning_content).toBe("List models first.");
      expect(ds.chats()[0]).toMatchObject({ reasoning_effort: "high", thinking: { type: "enabled" } });

      await agent.updateThread(t.id, { mode: { mode: "manual", agent: "hosted", provider: "google", model: "gemini-3.8-flash" } });
      agent.addMessage(t.id, "And audio?");
      await agent.run(t.id);
      expect(items(t.id).at(-1)).toMatchObject({ role: "assistant", text: "Here are the audio ones." });
      const gmLast = gm.chats().at(-1)!.messages!.filter((m) => m.tool_calls?.length);
      expect(gmLast.map((m) => (m.tool_calls![0].extra_content as { google: { thought_signature: string } }).google.thought_signature)).toEqual(["skip_thought_signature_validator", "skip_thought_signature_validator", "Z2VtaW5p"]);

      await agent.updateThread(t.id, { mode: { mode: "manual", agent: "claude", model: "claude-sonnet-5-5" } });
      agent.addMessage(t.id, "Thanks");
      await agent.run(t.id);
      expect(items(t.id).at(-1)).toMatchObject({ role: "assistant", text: "Back on Claude." });
      const last = JSON.stringify(anthropic.at(-1));
      expect(last).not.toContain("replay");
      expect(last).not.toContain("reasoning_content");
      expect(last).toContain("call_ds1");
      expect(last).toContain("function-call-9");
      expect(modeLabel(agent.getThread(t.id)!.thread)).toBe("Sonnet 5.5 · Medium");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Free", () => {
  it("runs on OpenRouter's free models, then moves to the local model when the day's free requests run out", async () => {
    const or = await fake("openrouter");
    or.keyInfo = { is_free_tier: true, free_model_daily_requests: { used: 47, limit: 50, remaining: 3 } };
    or.replies = [{ status: 429, headers: { "retry-after": "0" }, error: { error: { code: 429, message: "Rate limit exceeded: free-models-per-day", metadata: { error_type: "rate_limit_exceeded" } } } }];
    const local = fakeLlm("local", "sk-local-0123456789");
    await local.start();
    fakes.push(local);
    local.models = ["qwen3.8:27b"];
    local.replies = [{ text: "Here's the plan, from this machine." }];
    setSetting("llmUrl", `${local.url}/v1`);
    setSetting("llmKey", local.key);

    const can = await agent.availability();
    expect(can.free.pick).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", free: true });
    expect(can.free.text).toMatch(/^Runs on Nemotron 3 Ultra through OpenRouter — free: 20 a minute, 50 a day .*\(3 left today\)\. When those run out: qwen3\.8:27b on your local server\.$/);
    // No credits on OpenRouter: Smart plans on its best free model too, and says how to do better.
    expect(can.smart.text).toMatch(/^Smart uses Nemotron 3 Ultra \(free, through OpenRouter\)/);
    expect(can.manual.groups.find((g) => g.id === "openrouter")!.models.find((m) => m.model === "x-ai/grok-4.7")!.disabled).toMatch(/No credits on OpenRouter/);

    const r = await agent.resolveMode({ mode: "free" });
    expect(r).toMatchObject({ mode: "free", agent: "hosted", provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" });
    const t = agent.createThread({ engine: "open", agent: r.agent, mode: r.mode, provider: r.provider, model: r.model, effort: r.effort });
    agent.addMessage(t.id, "A fox in snow");
    await agent.run(t.id);
    const thread = agent.getThread(t.id)!.thread;
    expect(thread.items.find((i) => i.role === "notice")).toMatchObject({ text: expect.stringMatching(/^OpenRouter's free requests are used up for today, so this chat goes on with the local model \(your local server\) instead of Nemotron 3 Ultra \(OpenRouter\)\.$/) });
    expect(thread.items.at(-1)).toMatchObject({ role: "assistant", text: "Here's the plan, from this machine." });
    expect(thread).toMatchObject({ agent: "local", mode: "free" });
    // Free never moves to a paid model, and later Free chats skip OpenRouter until the limit resets.
    expect((await agent.resolveMode({ mode: "free" })).agent).toBe("local");
  });
});

describe("Manual", () => {
  it("runs a connected provider's model, and says why another can't run", async () => {
    await fake("deepseek");
    expect(await agent.resolveMode({ mode: "manual", agent: "hosted", provider: "deepseek", model: "deepseek-flash", effort: "xhigh" })).toMatchObject({ mode: "manual", agent: "hosted", provider: "deepseek", model: "deepseek-flash", effort: "xhigh" });
    expect(await agent.resolveMode({ mode: "manual", agent: "hosted", provider: "xai", model: "grok-4.7" })).toMatchObject({ mode: "free", note: "xAI (Grok) isn't connected (Settings → AI helper) — using Free instead." });
    expect(await agent.resolveMode({ mode: "manual", agent: "hosted", provider: "deepseek", model: "not-a-model" })).toMatchObject({ mode: "free" });
    setSetting("engineMode", "open");
    try {
      await fake("moonshot");
      expect(await agent.resolveMode({ mode: "manual", agent: "hosted", provider: "moonshot", model: "kimi-k3.1-pro" })).toMatchObject({ mode: "free", note: expect.stringMatching(/Not open weights/) });
      expect(await agent.resolveMode({ mode: "smart" })).toMatchObject({ agent: "hosted", provider: "deepseek", model: "deepseek-v4-pro" });
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("Smart picks again, and says so, when its provider's key is removed", async () => {
    await fake("deepseek");
    const local = fakes.find((f) => f.mode === "local")!;
    setSetting("llmUrl", `${local.url}/v1`);
    setSetting("llmKey", local.key);
    local.replies = [{ text: "Local now." }];
    const r = await agent.resolveMode({ mode: "smart" });
    const t = agent.createThread({ engine: "cloud", agent: r.agent, mode: r.mode, provider: r.provider, model: r.model, effort: r.effort });
    setSetting("deepseekKey", "");
    agent.addMessage(t.id, "Hi");
    await agent.run(t.id);
    expect(items(t.id).find((i) => i.role === "notice")).toMatchObject({ text: "Smart now uses the local model (your local server) (DeepSeek's key was removed)." });
    expect(items(t.id).at(-1)).toMatchObject({ role: "assistant", text: "Local now." });
  });
});
