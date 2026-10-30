import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers set the session cookie through cookies() (no request scope in a test): a jar that only records.
const jar = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => jar }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-sign-in-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.FUOBE_TRUST_PROXY = "1";
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const { safeNext } = await import("@/lib/safe-redirect");
const { resetRates } = await import("@/server/rate");
const login = await import("@/app/api/auth/login/route");
const signup = await import("@/app/api/auth/signup/route");
const me = await import("@/app/api/auth/me/route");

const globals = globalThis as Record<string, unknown>;
/** A fresh start for every limit: guards live on globalThis so a dev server's reloads keep them. */
function resetGuards() {
  for (const k of Object.keys(globals)) if (/^__fuobe\w*Guard$/.test(k)) delete globals[k];
  resetRates();
}

let ip = 0;
/** A visitor's address, as a trusted reverse proxy passes it on (the last X-Forwarded-For hop). */
const nextIp = () => `198.51.100.${++ip % 250}`;
const post = (url: string, body: unknown, from = nextIp(), cookie?: string, method = "POST") =>
  new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": from, ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  auth.setPassword("install password");
  auth.createAccount("member@example.com", "member password");
  auth.createAccount("other@example.com", "other password");
});
afterEach(() => {
  resetGuards();
  vi.restoreAllMocks();
});
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  delete process.env.FUOBE_TRUST_PROXY;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("M-1: after sign-in, only pages on this site", () => {
  const origin = "http://localhost:3000";
  it("refuses a path that resolves to another host", () => {
    for (const bad of ["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/./\\evil.example", "http://localhost:3000//evil.example/login?owner=1", "/..//evil.example"]) {
      expect(safeNext(bad, origin), bad).toBe("/");
    }
  });

  it("keeps ordinary paths", () => {
    expect(safeNext("/video?model=kling-3#x", origin)).toBe("/video?model=kling-3#x");
    expect(safeNext("/a//b", origin)).toBe("/a//b");
    expect(safeNext("/library/../settings", origin)).toBe("/settings");
  });
});

describe("M-2: password checks are counted and never hold up the server", () => {
  it("counts a right password too: an email gets 10 log-ins a minute, from any address", async () => {
    for (let i = 0; i < 10; i++) expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status, `log-in ${i}`).toBe(200);
    const r = await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    // Another email is not affected.
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }))).status).toBe(200);
  });

  it("checks a password without the synchronous scrypt", async () => {
    const sync = vi.spyOn(crypto, "scryptSync");
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "wrong password" }))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { email: "nobody@example.com", password: "wrong password" }))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
    await expect(auth.verifyAccount("member@example.com", "member password")).resolves.toMatchObject({ email: "member@example.com" });
    await expect(auth.verifyAccount("member@example.com", "nope nope")).resolves.toBeNull();
    await expect(auth.verifyPassword("install password")).resolves.toBe(true);
    await expect(auth.verifyPassword("nope nope")).resolves.toBe(false);
  });

  it("records a log-in at most once an hour, so log-ins don't rewrite the accounts file", async () => {
    const file = path.join(dir, "auth.json");
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    const before = fs.readFileSync(file, "utf8");
    for (let i = 0; i < 3; i++) expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("an account deleting itself gets 5 password checks a minute", async () => {
    const a = auth.createAccount("deleter@example.com", "deleter password");
    const cookie = auth.createSession(a.id).value;
    for (let i = 0; i < 5; i++) expect((await me.DELETE(post("/api/auth/me", { password: "wrong password" }, nextIp(), cookie, "DELETE"))).status).toBe(403);
    expect((await me.DELETE(post("/api/auth/me", { password: "deleter password" }, nextIp(), cookie, "DELETE"))).status).toBe(429);
    expect(auth.accountById(a.id)).toBeDefined();
  });
});

describe("M-4: one visitor's wrong guesses don't lock everyone out", () => {
  it("treats an IPv6 /64 as one visitor, and an IPv4-mapped address as IPv4", () => {
    const key = (xff: string) => auth.LoginGuard.clientKey(new Headers({ "x-forwarded-for": xff }), true);
    expect(key("2001:db8:1:2::1")).toBe(key("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(key("2001:db8:1:2::1")).toBe(key("2001:0DB8:0001:0002:0000:0000:0000:0042"));
    expect(key("2001:db8:1:2::1")).not.toBe(key("2001:db8:1:3::1"));
    expect(key("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(key("203.0.113.9")).toBe("203.0.113.9");
  });

  it("wrong account passwords from many addresses don't slow the owner's sign-in", async () => {
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { email: `guess${i}@example.com`, password: "wrong password" }));
    expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(200);
  });

  it("wrong owner passwords from many addresses don't stop accounts from logging in", async () => {
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { password: `wrong ${i}` }));
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
  });

  it("locks one email after 10 wrong passwords from any number of addresses, and only that email", async () => {
    for (let i = 0; i < 10; i++) expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: `wrong ${i}` }))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }))).status).toBe(429);
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
  });

  it("counts only sign-ups that could make an account: empty bodies don't slow sign-up for everyone", async () => {
    for (let i = 0; i < 30; i++) expect((await signup.POST(post("/api/auth/signup", {}))).status).toBe(400);
    expect((await signup.POST(post("/api/auth/signup", { email: "newcomer@example.com", password: "newcomer password" }))).status).toBe(201);
  });
});
