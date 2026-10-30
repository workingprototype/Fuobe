import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-signout-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const route = await import("@/app/api/auth/sessions/route");
afterAll(() => {
  delete process.env.FUOBE_PASSWORD;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const DAY = 86_400_000;
const secret = () => (JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")) as { secret: string }).secret;
/** A cookie signed with the real secret, as someone who read auth.json could make one. */
const forge = (payload: string) => `${payload}.${crypto.createHmac("sha256", secret()).update(payload).digest("base64url")}`;

function req(method: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest("http://localhost:3000/api/auth/sessions", { method, headers });
}

beforeAll(() => {
  // fuobe.com: the password comes from the server's environment, so Settings can't change it.
  process.env.FUOBE_PASSWORD = "from the environment";
});
afterEach(() => delete process.env.FUOBE_PUBLIC_SIGNUP);

describe("H-1: a cookie's expiry is capped at the session lifetime", () => {
  it("refuses a forged owner cookie that expires far in the future, and keeps a real one", () => {
    const real = auth.createSession().value;
    expect(auth.validSession(real)).toBe(true);
    expect(auth.validSession(forge("9999999999999"))).toBe(false);
    expect(auth.validSession(forge(String(Date.now() + 31 * DAY)))).toBe(false);
    // Signed just now for the full 30 days: still fine.
    expect(auth.validSession(forge(String(Date.now() + 30 * DAY - 1000)))).toBe(true);
  });

  it("refuses a forged account cookie that expires far in the future", () => {
    const a = auth.createAccount("far@example.com", "long enough");
    expect(auth.sessionViewer(auth.createSession(a.id).value)?.kind).toBe("account");
    expect(auth.sessionViewer(forge(`9999999999999.${a.id}`))).toBeNull();
  });

  it("refuses an expiry that isn't plain digits", () => {
    // Both read as a time a day from now by Number(), but no real cookie looks like this.
    expect(auth.validSession(forge(`0x${(Date.now() + DAY).toString(16)}`))).toBe(false);
    expect(auth.validSession(forge(`${String(Date.now() + DAY).slice(0, -3)}e3`))).toBe(false);
  });
});

describe("H-1: Sign everyone out", () => {
  it("replaces the secret even while FUOBE_PASSWORD is set: every owner and account session ends, the password still works", () => {
    const owner = auth.createSession().value;
    const a = auth.createAccount("everyone@example.com", "long enough");
    const account = auth.createSession(a.id).value;
    const before = secret();
    auth.signOutEveryone();
    expect(secret()).not.toBe(before);
    expect(secret()).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.validSession(owner)).toBe(false);
    expect(auth.sessionViewer(account)).toBeNull();
    expect(auth.checkPassword("from the environment")).toBe(true);
    expect(auth.validSession(auth.createSession().value)).toBe(true);
    expect(auth.checkAccount("everyone@example.com", "long enough")?.id).toBe(a.id);
  });

  it("keeps API tokens unless asked to revoke them too", () => {
    const { token } = auth.createToken("CI");
    auth.signOutEveryone();
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
    auth.signOutEveryone({ tokens: true });
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
    expect(auth.authStatus().tokens).toEqual([]);
  });

  it("is a POST the owner's signed-in browser makes, and signs that browser out too", async () => {
    const owner = auth.createSession().value;
    const other = auth.createSession().value;
    const { token } = auth.createToken("kept");
    const res = await route.POST(req("POST", { cookie: owner, headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tokensRevoked: false });
    // The cookie of the browser that pressed it is cleared, and it no longer works anywhere.
    expect(res.headers.get("set-cookie")).toMatch(/^fuobe_session=;.*Max-Age=0/i);
    expect(auth.validSession(owner)).toBe(false);
    expect(auth.validSession(other)).toBe(false);
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
  });

  it("revokes every API token when the owner asks", async () => {
    const owner = auth.createSession().value;
    const { token } = auth.createToken("gone");
    const res = await route.POST(new NextRequest("http://localhost:3000/api/auth/sessions", { method: "POST", headers: { cookie: `${auth.SESSION_COOKIE}=${owner}`, "content-type": "application/json" }, body: JSON.stringify({ tokens: true }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).tokensRevoked).toBe(true);
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
  });

  it("refuses an API token, an account and a guest", async () => {
    const before = secret();
    const { token } = auth.createToken("script");
    expect((await route.POST(req("POST", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
    const a = auth.createAccount("not-owner@example.com", "long enough");
    expect((await route.POST(req("POST", { cookie: auth.createSession(a.id).value }))).status).toBe(403);
    expect((await route.POST(req("POST"))).status).toBe(403);
    expect(secret()).toBe(before);
  });

  it("is the owner's only in the proxy too", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const a = auth.createAccount("proxy-signout@example.com", "long enough");
    const r = proxy(req("POST", { cookie: auth.createSession(a.id).value }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/owner/);
    expect(proxy(req("POST")).status).toBe(401);
  });
});
