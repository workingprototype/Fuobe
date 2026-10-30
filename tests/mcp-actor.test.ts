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

/** What each tool call saw: the context's actor and the scope's. */
const calls: { name: string; ctxActor: unknown; scopeActor: unknown }[] = [];
vi.mock("@/server/assist/tools", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/assist/tools")>();
  const { maybeActor } = await import("@/server/access/actor");
  return {
    ...real,
    executeTool: async (name: string, input: unknown, ctx: ToolContext) => {
      calls.push({ name, ctxActor: ctx.actor, scopeActor: maybeActor() });
      return real.executeTool(name, input, ctx);
    },
  };
});

const { handleMcp } = await import("@/server/mcp");
const route = await import("@/app/api/mcp/route");
const { db } = await import("@/server/db");
const { runAs, SYSTEM, LOCAL_OWNER } = await import("@/server/access/actor");
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

  it("ignores an invalid token in Just me on this computer, as the proxy does", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { bearer: "fuobe_wrong" })).status).toBe(200);
  });
});
