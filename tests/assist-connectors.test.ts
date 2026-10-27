import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeStream } from "./fixtures/claude-sse";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-conn-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const connectors = await import("@/server/assist/connectors");
const lib = await import("@/lib/assist-connectors");
const listRoute = await import("@/app/api/assist/connectors/route");
const oneRoute = await import("@/app/api/assist/connectors/[connectorId]/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const TOKEN = "sk-live-0123456789abcdef";

describe("connector URLs", () => {
  const check = lib.checkConnectorUrl;
  it("takes https anywhere and http only on this machine", () => {
    expect(check("https://mcp.example.com/mcp")).toEqual({ url: "https://mcp.example.com/mcp" });
    expect(check("  https://mcp.example.com  ")).toEqual({ url: "https://mcp.example.com/" });
    expect(check("http://localhost:8787/mcp")).toMatchObject({ url: "http://localhost:8787/mcp", warning: expect.stringMatching(/public tunnel/) });
    expect(check("http://127.0.0.1:3001/mcp")).toMatchObject({ url: "http://127.0.0.1:3001/mcp" });
    expect(check("http://[::1]:3001/mcp")).toMatchObject({ url: "http://[::1]:3001/mcp" });
    expect(check("http://mcp.example.com/mcp")).toEqual({ error: "Use https:// — plain http is only allowed for localhost" });
    expect(check("http://192.168.1.20/mcp")).toEqual({ error: "Use https:// — plain http is only allowed for localhost" });
  });

  it("FUOBE_ALLOW_PRIVATE_URLS=1 allows plain http elsewhere, with a warning", () => {
    expect(check("http://192.168.1.20/mcp", true)).toMatchObject({ url: "http://192.168.1.20/mcp", warning: expect.stringMatching(/public tunnel/) });
    expect(check("http://mcp.example.com/mcp", true)).toMatchObject({ url: "http://mcp.example.com/mcp", warning: expect.stringMatching(/unencrypted/) });
  });

  it("refuses other schemes, credentials in the URL, garbage and very long URLs", () => {
    expect(check("ftp://mcp.example.com")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("javascript:alert(1)")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("file:///etc/passwd")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("https://user:pw@mcp.example.com/")).toEqual({ error: "Put the token in the token field, not in the URL" });
    expect(check("mcp.example.com")).toEqual({ error: "Enter a full URL, like https://mcp.example.com/mcp" });
    expect(check("")).toEqual({ error: "Enter the connector's URL" });
    expect(check(`https://mcp.example.com/${"a".repeat(2100)}`)).toMatchObject({ error: expect.stringMatching(/too long/) });
    // https to a private address is allowed (Anthropic's servers make the call) but flagged.
    expect(check("https://10.0.0.5/mcp")).toMatchObject({ warning: expect.stringMatching(/public tunnel/) });
  });

  it("masks the query (keys often live there), names connectors and cleans pasted tokens", () => {
    expect(lib.maskConnectorUrl("https://mcp.zapier.com/api/mcp/s/abc?key=SECRET")).toBe("https://mcp.zapier.com/api/mcp/s/abc?••••");
    expect(lib.maskConnectorUrl("https://mcp.example.com/")).toBe("https://mcp.example.com");
    expect(lib.connectorSlug("Notion (work)")).toBe("notion-work");
    expect(lib.connectorSlug("Ünïcode Tööls")).toBe("unicode-tools");
    expect(lib.connectorSlug("Notion", ["notion", "notion-2"])).toBe("notion-3");
    expect(lib.connectorSlug("!!!")).toBe("connector");
    expect(lib.cleanToken("Bearer abc.def")).toBe("abc.def");
    expect(lib.cleanToken("Authorization: Bearer abc")).toBe("abc");
  });
});

describe("connectors in Settings", () => {
  it("keeps the token on the server: every view masks it, and the API never returns it", async () => {
    const c = connectors.createConnector({ name: "Notion", url: "https://mcp.notion.com/mcp?workspace=SECRET", token: `Bearer ${TOKEN}` });
    expect(c).toMatchObject({ name: "Notion", slug: "notion", url: "https://mcp.notion.com/mcp?••••", hasToken: true, enabled: true, token: "sk-l••••cdef" });
    const res = await listRoute.GET();
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("SECRET");
    expect(JSON.parse(body).items).toHaveLength(1);
    // Created through the route: the response is masked too.
    const created = await listRoute.POST(new Request("http://x/api/assist/connectors", { method: "POST", body: JSON.stringify({ name: "Linear", url: "https://mcp.linear.app/mcp", token: "lin_api_SECRETSECRET" }) }));
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("lin_api_SECRETSECRET");
    expect(JSON.parse(text)).toMatchObject({ slug: "linear", hasToken: true });
    // The secret is only what the Claude request reads.
    expect(connectors.activeConnectors().map((x) => [x.slug, x.token])).toEqual([
      ["notion", TOKEN],
      ["linear", "lin_api_SECRETSECRET"],
    ]);
  });

  it("validates input, refuses duplicates and caps the list", async () => {
    expect(() => connectors.createConnector({ name: "", url: "https://a.example.com" })).toThrow(/name/);
    expect(() => connectors.createConnector({ name: "Plain", url: "http://a.example.com" })).toThrow(/https/);
    expect(() => connectors.createConnector({ name: "Again", url: "https://mcp.linear.app/mcp" })).toThrow(/already/);
    expect(() => connectors.createConnector({ name: "Spaces", url: "https://b.example.com", token: "two words" })).toThrow(/only the token/);
    const bad = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "x", url: "ftp://x" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Connectors use https:// URLs");
  });

  it("edits keep the token unless a new one is given; off connectors aren't sent", async () => {
    const [notion] = connectors.listConnectors();
    const ctx = { params: Promise.resolve({ connectorId: notion.id }) };
    const r = await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Notion work", enabled: false }) }), ctx);
    expect(await r.json()).toMatchObject({ name: "Notion work", slug: "notion", enabled: false, hasToken: true });
    expect(connectors.activeConnectors().map((x) => x.slug)).toEqual(["linear"]);
    await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true, token: "" }) }), ctx);
    expect(connectors.activeConnectors().find((x) => x.slug === "notion")?.token).toBeNull();
    await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ token: TOKEN }) }), ctx);
    expect(connectors.activeConnectors().find((x) => x.slug === "notion")?.token).toBe(TOKEN);
  });
});

describe("the Claude request", () => {
  it("builds one mcp_servers entry and one mcp_toolset per connector, joined by name", () => {
    expect(connectors.mcpParams([])).toBeNull();
    expect(
      connectors.mcpParams([
        { id: "a", name: "Notion", slug: "notion", url: "https://mcp.notion.com/mcp", token: TOKEN, enabled: true },
        { id: "b", name: "Docs", slug: "docs", url: "https://docs.example.com/mcp", token: null, enabled: true },
      ]),
    ).toEqual({
      mcp_servers: [
        { type: "url", url: "https://mcp.notion.com/mcp", name: "notion", authorization_token: TOKEN },
        { type: "url", url: "https://docs.example.com/mcp", name: "docs" },
      ],
      toolsets: [
        { type: "mcp_toolset", mcp_server_name: "notion" },
        { type: "mcp_toolset", mcp_server_name: "docs" },
      ],
    });
  });

  it("sends the connectors through the SDK with the MCP beta, and the chat shows the connector tools used", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    const sent: { headers: Headers; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    let turn = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      turn++;
      // First reply: Claude used two Notion tools on Anthropic's side (one failed), then answered.
      return claudeStream(
        turn === 1
          ? {
              content: [
                { type: "mcp_tool_use", id: "mcptoolu_1", name: "search_pages", server_name: "notion", input: { query: "launch plan" } },
                { type: "mcp_tool_result", tool_use_id: "mcptoolu_1", is_error: false, content: [{ type: "text", text: "Launch plan: 3 ads" }] },
                { type: "mcp_tool_use", id: "mcptoolu_2", name: "get_page", server_name: "notion", input: { id: "x" } },
                { type: "mcp_tool_result", tool_use_id: "mcptoolu_2", is_error: true, content: [{ type: "text", text: "not found" }] },
                { type: "text", text: "Your launch plan asks for 3 ads." },
              ],
              stop_reason: "end_turn",
            }
          : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
      );
    }) as typeof fetch;
    try {
      const r = await agent.resolveMode({ mode: "smart" });
      const t = agent.createThread({ engine: "cloud", agent: r.agent, mode: r.mode, model: r.model, effort: r.effort });
      agent.addMessage(t.id, "What does my launch plan in Notion say?");
      await agent.run(t.id);
      const body = sent[0].body;
      expect(sent[0].headers.get("anthropic-beta")).toContain(connectors.MCP_BETA);
      expect(body.mcp_servers).toEqual([
        { type: "url", url: "https://mcp.notion.com/mcp?workspace=SECRET", name: "notion", authorization_token: TOKEN },
        { type: "url", url: "https://mcp.linear.app/mcp", name: "linear", authorization_token: "lin_api_SECRETSECRET" },
      ]);
      const tools = body.tools as { type?: string; name?: string; mcp_server_name?: string }[];
      expect(tools.filter((x) => x.type === "mcp_toolset")).toEqual([
        { type: "mcp_toolset", mcp_server_name: "notion" },
        { type: "mcp_toolset", mcp_server_name: "linear" },
      ]);
      // Fuobe's own tools are still there, first.
      expect(tools[0].name).toBeTruthy();
      const items = agent.getThread(t.id)!.thread.items;
      expect(items.filter((i) => i.role === "tool")).toMatchObject([
        { text: "Notion work · search_pages", connector: "Notion work" },
        { text: "Notion work · get_page", connector: "Notion work", failed: true },
      ]);
      expect(items.find((i) => i.role === "assistant")).toMatchObject({ text: "Your launch plan asks for 3 ads." });

      // The connector is deleted: the next request doesn't name it, and its history goes as text.
      connectors.deleteConnector(connectors.listConnectors().find((c) => c.slug === "notion")!.id);
      agent.addMessage(t.id, "Thanks");
      await agent.run(t.id);
      const second = sent[1].body;
      expect((second.mcp_servers as { name: string }[]).map((m) => m.name)).toEqual(["linear"]);
      const history = JSON.stringify(second.messages);
      expect(history).not.toContain('"mcp_tool_use"');
      expect(history).toContain("[Used notion · search_pages — that connector is no longer available]");
      // The stored history keeps what Claude returned.
      expect(JSON.stringify(agent.getThread(t.id))).toContain("Your launch plan");
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
    }
  });

  it("no connectors: no MCP fields and no MCP beta", async () => {
    for (const c of connectors.listConnectors()) connectors.updateConnector(c.id, { enabled: false });
    setSetting("anthropicKey", "sk-ant-test");
    const sent: { headers: Headers; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return claudeStream({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" });
    }) as typeof fetch;
    try {
      const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart" });
      agent.addMessage(t.id, "Hi");
      await agent.run(t.id);
      expect(sent[0].body.mcp_servers).toBeUndefined();
      expect(sent[0].headers.get("anthropic-beta")).not.toContain("mcp-client");
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
      for (const c of connectors.listConnectors()) connectors.updateConnector(c.id, { enabled: true });
    }
  });

  it("a chat on Ollama or the offline planner says connectors need Claude, once", async () => {
    const t = agent.createThread({ engine: "cloud", agent: "offline", mode: "free" });
    const notes = () => agent.getThread(t.id)!.thread.items.filter((i) => i.role === "notice" && /Connectors work in Claude chats/.test(i.text));
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ text: expect.stringContaining("(Linear)") });
    await agent.updateThread(t.id, { mode: { mode: "free" } });
    expect(notes()).toHaveLength(1);
    // Claude chats don't get it.
    const c = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart" });
    expect(agent.getThread(c.id)!.thread.items).toEqual([]);
  });

  it("history from a connector that's gone becomes text in the request only", () => {
    type Msg = Anthropic.Beta.BetaMessageParam;
    const messages: Msg[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "mcp_tool_use", id: "m1", name: "find", server_name: "old", input: {} },
          { type: "mcp_tool_result", tool_use_id: "m1", is_error: false, content: [{ type: "text", text: "found it" }] },
          { type: "mcp_tool_use", id: "m2", name: "list", server_name: "kept", input: {} },
          { type: "text", text: "ok" },
        ],
      },
    ];
    const out = connectors.withoutMissingServers(messages, new Set(["kept"]));
    expect(out[1].content).toEqual([
      { type: "text", text: "[Used old · find — that connector is no longer available]" },
      { type: "text", text: "[Result: found it]" },
      { type: "mcp_tool_use", id: "m2", name: "list", server_name: "kept", input: {} },
      { type: "text", text: "ok" },
    ]);
    expect(messages[1].content).toHaveLength(4);
    expect((messages[1].content as { type: string }[])[0].type).toBe("mcp_tool_use");
    expect(connectors.withoutMissingServers(messages, new Set(["old", "kept"]))).toBe(messages);
  });
});
