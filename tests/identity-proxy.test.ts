/**
 * The proxy after accounts (docs/research/accounts-8.md §7.1, §8): Just me on this computer, a password install,
 * API tokens (valid, wrong, revoked), Better Auth's session cookie, refusal codes, share links, the client-IP
 * header only a trusted proxy may set, session refresh on POST, and no-store on sign-in paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-proxy-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET", "FUOBE_TRUST_PROXY", "FUOBE_TRUSTED_PROXIES", "FUOBE_SITE_URL"]) delete process.env[k];

const { proxy } = await import("@/proxy");
const { db } = await import("@/server/db");
const { bootstrapIdentity } = await import("@/server/identity/bootstrap");
const tokens = await import("@/server/identity/tokens");
const shares = await import("@/server/shares");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { setOwnerPassword, ownerCookie } = await import("./helpers/identity");
const { SHARE_VIEW_HEADER } = await import("@/lib/share");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

await bootstrapIdentity();
const PASSWORD = "correct horse battery";

const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    headers: { host: new URL(url).host, ...(init.method && init.method !== "GET" && { origin: new URL(url).origin }), ...init.headers },
    ...(init.method && init.method !== "GET" && init.method !== "HEAD" && { body: "{}" }),
  });
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const forwarded = (r: Response, name: string) => r.headers.get(`x-middleware-request-${name}`);

describe("Just me on this computer", () => {
  it("lets every page and API through as the owner, with no sign-in", async () => {
    expect(passed(await proxy(req("http://localhost:3000/library")))).toBe(true);
    expect(passed(await proxy(req("http://localhost:3000/api/generations", { method: "POST" })))).toBe(true);
  });

  it("ignores a wrong bearer token and accepts a right one", async () => {
    expect(passed(await proxy(req("http://localhost:3000/api/generations", { headers: { authorization: "Bearer fuobe_wrong" } })))).toBe(true);
    const { token } = tokens.createToken("u_owner", "CLI");
    expect(passed(await proxy(req("http://localhost:3000/api/generations", { headers: { authorization: `Bearer ${token}` } })))).toBe(true);
  });

  it("sends /login home: there is nothing to sign in to", async () => {
    const r = await proxy(req("http://localhost:3000/login"));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/");
  });

  it("keeps the DNS-rebinding and cross-site checks", async () => {
    expect((await proxy(req("http://rebind.attacker.example/library"))).status).toBe(403);
    expect((await proxy(req("http://localhost:3000/api/generations", { method: "POST", headers: { origin: "http://evil.example" } }))).status).toBe(403);
  });

  it("answers 404 at /api/identity: Better Auth isn't mounted", async () => {
    const route = await import("@/app/api/identity/[...all]/route");
    expect((await route.GET(new Request("http://localhost:3000/api/identity/get-session", { headers: { host: "localhost:3000" } }))).status).toBe(404);
  });
});

describe("the client address Better Auth sees", () => {
  it("is never what the client wrote", async () => {
    const r = await proxy(req("http://localhost:3000/api/generations", { headers: { "x-fuobe-client-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6" } }));
    expect(passed(r)).toBe(true);
    expect(forwarded(r, "x-fuobe-client-ip")).toBeNull();
    expect(r.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-fuobe-client-ip");
  });

  it("comes from X-Forwarded-For only behind a trusted proxy (hops or ranges)", async () => {
    vi.stubEnv("FUOBE_TRUST_PROXY", "1");
    try {
      const r = await proxy(req("http://localhost:3000/api/generations", { headers: { "x-fuobe-client-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 203.0.113.5" } }));
      expect(forwarded(r, "x-fuobe-client-ip")).toBe("203.0.113.5");
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("FUOBE_TRUSTED_PROXIES", "10.0.0.0/8, 192.0.2.1");
    try {
      const r = await proxy(req("http://localhost:3000/api/generations", { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.1.2.3, 192.0.2.1" } }));
      expect(forwarded(r, "x-fuobe-client-ip")).toBe("198.51.100.7");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("a password install", () => {
  it("needs a session or a token for everything but sign-in", async () => {
    await setOwnerPassword(PASSWORD);
    const api = await proxy(req("http://localhost:3000/api/generations"));
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toMatch(/Bearer/);
    const page = await proxy(req("http://localhost:3000/cinema?tab=new"));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/cinema?tab=new");
    for (const open of ["/login", "/api/auth/login", "/api/identity/get-session"]) {
      const r = await proxy(req(`http://localhost:3000${open}`, open === "/api/auth/login" ? { method: "POST" } : {}));
      expect(passed(r), open).toBe(true);
      expect(r.headers.get("cache-control"), open).toBe("no-store");
    }
    expect((await proxy(req("http://localhost:3000/library"))).headers.get("cache-control")).toBeNull();
  });

  it("takes API tokens: a right one passes, a wrong or revoked one is 401 with a way forward", async () => {
    const { token, info } = tokens.createToken("u_owner", "MCP");
    expect(passed(await proxy(req("http://localhost:3000/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` } })))).toBe(true);
    const wrong = await proxy(req("http://localhost:3000/api/generations", { headers: { authorization: "Bearer fuobe_wrong" } }));
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/isn't valid/);
    tokens.revokeToken("u_owner", info.id);
    expect((await proxy(req("http://localhost:3000/api/generations", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(401);
  });

  it("takes Better Auth's session cookie, until the session ends", async () => {
    const cookie = await ownerCookie(PASSWORD);
    expect(cookie).toMatch(/^fuobe\.session_token=/);
    expect(passed(await proxy(req("http://localhost:3000/library", { headers: { cookie } })))).toBe(true);
    const logout = await import("@/app/api/auth/logout/route");
    const out = await logout.POST(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { cookie, host: "localhost:3000" } }));
    expect(out.headers.getSetCookie().some((c) => /fuobe\.session_token=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true);
    expect((await proxy(req("http://localhost:3000/library", { headers: { cookie } }))).status).toBe(307);
  });

  it("refuses a person who may not act with their code (API) or on the sign-in card (pages)", async () => {
    const cookie = await ownerCookie(PASSWORD);
    db().prepare("UPDATE users SET status = 'disabled' WHERE id = 'u_owner'").run();
    try {
      const api = await proxy(req("http://localhost:3000/api/generations", { headers: { cookie } }));
      expect(api.status).toBe(403);
      expect(await api.json()).toMatchObject({ code: "ACCOUNT_DISABLED", error: expect.stringMatching(/turned off/) });
      const page = await proxy(req("http://localhost:3000/library", { headers: { cookie } }));
      expect(new URL(page.headers.get("location")!).searchParams.get("code")).toBe("ACCOUNT_DISABLED");
    } finally {
      db().prepare("UPDATE users SET status = 'active' WHERE id = 'u_owner'").run();
    }
  });

  it("refreshes a session that is due, on a POST only", async () => {
    const cookie = await ownerCookie(PASSWORD);
    // Two days into a 30-day session: due for its daily refresh.
    const token = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
    const due = new Date(Date.now() + 28 * 86_400_000);
    db().prepare('UPDATE auth_session SET "expiresAt" = ? WHERE token = ?').run(due.toISOString(), token);
    const get = await proxy(req("http://localhost:3000/library", { headers: { cookie } }));
    expect(passed(get)).toBe(true);
    expect(get.headers.getSetCookie()).toEqual([]);
    const post = await proxy(req("http://localhost:3000/api/generations", { method: "POST", headers: { cookie } }));
    expect(passed(post)).toBe(true);
    expect(post.headers.getSetCookie().some((c) => c.startsWith("fuobe.session_token="))).toBe(true);
    const after = db().prepare('SELECT "expiresAt" AS e FROM auth_session WHERE token = ?').get(token) as { e: string };
    expect(new Date(after.e).getTime()).toBeGreaterThan(due.getTime() + 86_400_000);
  });

  it("opens a live share link without a session, and the signed-in owner's own visit isn't a view", async () => {
    const asset = saveFile({ data: Buffer.from("not really a png"), contentType: "image/png", source: "generation" });
    const g = gens.recordLocalGeneration({ feature: "grade", modelId: "local-color-grade", op: "grade", prompt: "proxy pier", inputs: {}, output: { url: asset.url, kind: "image", contentType: "image/png" } });
    const S = shares.createShare({ kind: "result", targetId: g.id });
    const visitor = await proxy(req(`http://localhost:3000/s/${S.token}`, { headers: { "user-agent": "Mozilla/5.0 Chrome/141.0" } }));
    expect(passed(visitor)).toBe(true);
    expect(forwarded(visitor, SHARE_VIEW_HEADER)).toBe("1");
    const cookie = await ownerCookie(PASSWORD);
    const own = await proxy(req(`http://localhost:3000/s/${S.token}`, { headers: { "user-agent": "Mozilla/5.0 Chrome/141.0", cookie } }));
    expect(forwarded(own, SHARE_VIEW_HEADER)).toBeNull();
  });
});
