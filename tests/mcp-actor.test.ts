/**
 * MCP receives the actor (docs/research/accounts-8.md §7.10, acc-2): /api/mcp resolves the token's (or session's)
 * person through handler() and hands it to handleMcp(body, actor), and every tool the message runs acts for that
 * person — in its ToolContext and as the scope's actor. The route's Origin check still refuses other sites (and the
 * refusal is audited).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/server/assist/define";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-mcp-actor-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

/** What each tool call saw: the context's actor and the scope's (and the whole scope). */
const calls: { name: string; ctxActor: unknown; scopeActor: unknown }[] = [];
const scopes: unknown[] = [];
vi.mock("@/server/assist/tools", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/assist/tools")>();
  const { maybeActor, requestScope } = await import("@/server/access/actor");
  return {
    ...real,
    executeTool: async (name: string, input: unknown, ctx: ToolContext) => {
      calls.push({ name, ctxActor: ctx.actor, scopeActor: maybeActor() });
      scopes.push(requestScope());
      return real.executeTool(name, input, ctx);
    },
  };
});

const { handleMcp } = await import("@/server/mcp");
const route = await import("@/app/api/mcp/route");
const { db } = await import("@/server/db");
const { runAs, withScope, SYSTEM, LOCAL_OWNER } = await import("@/server/access/actor");
const { seedPerson, tokenFor, request, actor, asNobody } = await import("./helpers/actors");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const call = (name: string, args: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("handleMcp(body, actor)", () => {
  it("runs each tool for the actor it is given, whoever is acting around it", async () => {
    const alex = actor(seedPerson(), "member", { via: "token", tokenId: "t1" });
    calls.length = 0;
    const res = await runAs(SYSTEM, () => handleMcp(call("search_models", { query: "video" }), alex));
    expect(res).toMatchObject({ result: {} });
    expect(calls).toEqual([{ name: "search_models", ctxActor: alex, scopeActor: alex }]);
  });

  it("acts for whoever the scope says when no actor is passed, and refuses to act for nobody", async () => {
    calls.length = 0;
    await handleMcp(call("list_elements"));
    expect(calls[0]).toMatchObject({ ctxActor: LOCAL_OWNER, scopeActor: LOCAL_OWNER });
    asNobody();
    await expect(handleMcp(call("list_elements"))).rejects.toThrow(/No one is acting/);
  });
});

describe("POST /api/mcp", () => {
  const post = (body: unknown, o: { bearer?: string; headers?: Record<string, string> } = {}) => route.POST(request("/api/mcp", { body, ...o }));

  it("hands the bearer token's person to the tools", async () => {
    const member = seedPerson();
    calls.length = 0;
    const res = await post(call("search_models", { query: "image" }), { bearer: tokenFor(member) });
    expect(res.status).toBe(200);
    expect(calls[0].ctxActor).toMatchObject({ userId: member, role: "member", via: "token" });
    expect(calls[0].scopeActor).toEqual(calls[0].ctxActor);
  });

  it("hands Just me on this computer the local owner", async () => {
    calls.length = 0;
    expect((await post(call("list_elements"))).status).toBe(200);
    expect(calls[0].ctxActor).toEqual(LOCAL_OWNER);
  });

  it("keeps the Origin check, and audits the refusal", async () => {
    const before = (db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'denied'").get() as { n: number }).n;
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: -32000, message: "Origin not allowed" } });
    expect((db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'denied'").get() as { n: number }).n).toBe(before + 1);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "http://localhost:3000" } })).status).toBe(200);
  });

  it("offers a Read-only token the read tools only, and refuses (and audits) a tool that makes things", async () => {
    const member = seedPerson();
    const read = tokenFor(member, ["read"]);
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { bearer: read });
    expect(init.status).toBe(200);
    const listed = (await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { bearer: read })).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    const names = listed.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_models", "check_generations", "estimate_cost"]));
    expect(names).not.toContain("generate");
    expect(listed.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    calls.length = 0;
    expect((await post(call("search_models", { query: "video" }), { bearer: read })).status).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(["search_models"]);
    const before = (db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'denied'").get() as { n: number }).n;
    calls.length = 0;
    const refused = (await (await post(call("generate", { prompt: "a lighthouse", modelId: "nano-banana-pro" }), { bearer: read })).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toMatch(/Read only/);
    expect(calls).toEqual([]);
    const row = db().prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { action: string; actor_id: string; meta_json: string };
    expect((db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'denied'").get() as { n: number }).n).toBe(before + 1);
    expect(row).toMatchObject({ action: "denied", actor_id: member });
    expect(JSON.parse(row.meta_json)).toMatchObject({ reason: "TOKEN_SCOPE", tool: "generate", path: "/api/mcp" });
    // A Generate token gets them all.
    const all = (await (await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { bearer: tokenFor(member, ["generate"]) })).json()) as { result: { tools: { name: string }[] } };
    expect(all.result.tools.map((t) => t.name)).toContain("generate");
  });

  it("keeps the request's address and browser in the scope the tools run in", async () => {
    const alex = actor(seedPerson(), "member", { via: "token", tokenId: "t9" });
    scopes.length = 0;
    await withScope({ actor: LOCAL_OWNER, ip: "203.0.113.9", userAgent: "mcp-client/1", method: "POST", path: "/api/mcp" }, () => handleMcp(call("list_elements"), alex));
    expect(scopes.at(-1)).toMatchObject({ actor: alex, ip: "203.0.113.9", userAgent: "mcp-client/1", method: "POST", path: "/api/mcp" });
  });

  it("ignores an invalid token in Just me on this computer, as the proxy does", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { bearer: "fuobe_wrong" })).status).toBe(200);
  });
});
