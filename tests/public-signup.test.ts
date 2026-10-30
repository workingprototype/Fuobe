import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-signup-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
delete process.env.FUOBE_ALLOWED_ORIGINS;
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const access = await import("@/lib/guest-access");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const toLogin = (r: Response) => r.status === 307 && new URL(r.headers.get("location") ?? "", "http://x").pathname === "/login";

function req(url: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method, headers, ...(method !== "GET" && method !== "HEAD" && { body: "{}" }) });
}

beforeAll(() => auth.setPassword("install password"));
afterEach(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  delete process.env.FUOBE_ALLOWED_ORIGINS;
});

describe("accounts", () => {
  it("signs up with a lower-cased email and a salted scrypt hash, never the password", () => {
    const a = auth.createAccount("  Judge@Example.COM ", "long enough");
    expect(a.email).toBe("judge@example.com");
    expect(a.hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(a.createdAt).toBeGreaterThan(0);
    const file = fs.readFileSync(path.join(dir, "auth.json"), "utf8");
    expect(file).not.toContain("long enough");
    expect(JSON.parse(file).accounts[0].email).toBe("judge@example.com");
  });

  it("logs in with the right password only", () => {
    expect(auth.checkAccount("JUDGE@example.com", "long enough")?.email).toBe("judge@example.com");
    expect(auth.checkAccount("judge@example.com", "wrong password")).toBeNull();
    expect(auth.checkAccount("nobody@example.com", "long enough")).toBeNull();
    expect(auth.checkAccount("not an email", "long enough")).toBeNull();
  });

  it("refuses a duplicate email, a bad email and a short password", () => {
    expect(() => auth.createAccount("judge@EXAMPLE.com", "another one")).toThrow(/already exists/);
    expect(() => auth.createAccount("judge@example.com", "another one")).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => auth.createAccount("no-at-sign", "long enough")).toThrow(/valid email/);
    expect(() => auth.createAccount("new@example.com", "short")).toThrow(/8 characters/);
  });

  it("keeps the install password working, and an account session is never the owner's", () => {
    expect(auth.checkPassword("install password")).toBe(true);
    const a = auth.checkAccount("judge@example.com", "long enough")!;
    const s = auth.createSession(a.id);
    expect(auth.sessionViewer(s.value)).toMatchObject({ kind: "account", account: { id: a.id } });
    expect(auth.validSession(s.value)).toBe(false);
    // Dropping the account id doesn't make an owner session.
    const [exp, , mac] = s.value.split(".");
    expect(auth.sessionViewer(`${exp}.${mac}`)).toBeNull();
    expect(auth.sessionViewer(s.value.replace(a.id, "0".repeat(a.id.length)))).toBeNull();
    expect(auth.validSession(auth.createSession().value)).toBe(true);
  });
});

describe("the switch", () => {
  it("is off by default, on with FUOBE_PUBLIC_SIGNUP=1 or the Settings switch, and FUOBE_PUBLIC_SIGNUP=0 wins", () => {
    expect(auth.publicSignup("localhost:3000")).toBe(false);
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    expect(auth.publicSignup("localhost:3000")).toBe(true);
    process.env.FUOBE_PUBLIC_SIGNUP = "0";
    expect(() => auth.setPublicSignup(true)).toThrow(/FUOBE_PUBLIC_SIGNUP/);
    delete process.env.FUOBE_PUBLIC_SIGNUP;
    auth.setPublicSignup(true);
    expect(auth.publicSignup("localhost:3000")).toBe(true);
    process.env.FUOBE_PUBLIC_SIGNUP = "0";
    expect(auth.publicSignup("localhost:3000")).toBe(false);
    delete process.env.FUOBE_PUBLIC_SIGNUP;
    auth.setPublicSignup(false);
    expect(auth.publicSignup("localhost:3000")).toBe(false);
  });

  it("is on at fuobe.com, but only on the install that names fuobe.com as its address", () => {
    // A self-hosted studio reached by IP: a forged Host header doesn't open it.
    expect(auth.publicSignup("fuobe.com")).toBe(false);
    process.env.FUOBE_ALLOWED_ORIGINS = "fuobe.com";
    expect(auth.publicSignup("fuobe.com")).toBe(true);
    expect(auth.publicSignup("www.fuobe.com")).toBe(true);
    expect(auth.publicSignup("evil.example")).toBe(false);
    process.env.FUOBE_PUBLIC_SIGNUP = "0";
    expect(auth.publicSignup("fuobe.com")).toBe(false);
  });
});

describe("proxy with public sign-up on", () => {
  let account = "";
  beforeAll(() => {
    account = auth.createSession(auth.createAccount("proxy@example.com", "long enough").id).value;
  });

  it("lets a guest open pages and the catalog reads", () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    for (const p of ["/", "/motions", "/layers", "/cinema", "/image-to-3d", "/settings"]) expect(passed(proxy(req(p))), p).toBe(true);
    for (const p of ["/api/status", "/api/models", "/api/search-index"]) expect(passed(proxy(req(p))), p).toBe(true);
    expect(passed(proxy(req("/motions", { method: "HEAD" })))).toBe(true);
  });

  it("never shows a guest the owner's library", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const list = proxy(req("/api/generations?limit=40"));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [] });
    for (const p of ["/api/files/outputs/a.png", "/api/settings", "/api/auth/tokens", "/api/generations/abc", "/api/layers/abc", "/api/uploads", "/api/assist"]) {
      const r = proxy(req(p));
      expect(r.status, p).toBe(401);
      expect(r.headers.get(access.GUEST_HEADER), p).toBe("1");
    }
    // Catalogs mixed with the owner's items: the route is told it's a guest.
    const moodboards = proxy(req("/api/moodboards"));
    expect(passed(moodboards)).toBe(true);
    expect(moodboards.headers.get(`x-middleware-request-${access.GUEST_HEADER}`)).toBe("1");
  });

  it("refuses a guest's every change with a 401 the client turns into the sign-up prompt", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    for (const [method, p] of [
      ["POST", "/api/generations"],
      ["POST", "/api/uploads"],
      ["PUT", "/api/settings"],
      ["POST", "/api/layers"],
      ["DELETE", "/api/generations/abc"],
      ["PATCH", "/api/cinema/projects/abc"],
    ]) {
      const r = proxy(req(p, { method }));
      expect(r.status, `${method} ${p}`).toBe(401);
      expect(r.headers.get(access.GUEST_HEADER)).toBe("1");
      expect((await r.json()).error).toMatch(/free account/);
    }
    // Price checks only plan a run.
    expect(passed(proxy(req("/api/generations?preview=1", { method: "POST" })))).toBe(true);
    expect(passed(proxy(req("/api/shorts/estimate", { method: "POST" })))).toBe(true);
  });

  it("lets an account open every page, but never settings, keys or tokens", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    for (const p of ["/", "/motions", "/layers", "/settings", "/api/status", "/api/models"]) expect(passed(proxy(req(p, { cookie: account }))), p).toBe(true);
    for (const [method, p] of [
      ["PUT", "/api/settings"],
      ["PUT", "/api/settings/models"],
      ["POST", "/api/auth/password"],
      ["GET", "/api/auth/tokens"],
      ["POST", "/api/auth/tokens"],
      ["PUT", "/api/auth/public"],
      ["POST", "/api/loras"],
      ["POST", "/api/assist/connectors"],
    ]) {
      const r = proxy(req(p, { method, cookie: account }));
      expect(r.status, `${method} ${p}`).toBe(403);
      expect((await r.json()).error).toMatch(/owner/);
    }
  });

  it("keeps the install password and API tokens working, with everything open", () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const owner = auth.createSession().value;
    expect(passed(proxy(req("/api/settings", { method: "PUT", cookie: owner })))).toBe(true);
    expect(passed(proxy(req("/api/auth/tokens", { cookie: owner })))).toBe(true);
    const { token } = auth.createToken("CI");
    expect(passed(proxy(req("/api/settings", { method: "PUT", headers: { authorization: `Bearer ${token}` } })))).toBe(true);
  });

  it("opens sign-up, log-in and who-am-I to everyone", () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/signup", "/api/auth/me"]) {
      expect(passed(proxy(req(p, { method: p === "/login" || p === "/api/auth/me" ? "GET" : "POST" }))), p).toBe(true);
    }
  });
});

describe("proxy with public sign-up off (today's behaviour)", () => {
  it("sends guests to sign in and refuses accounts; the owner still gets in", async () => {
    const account = auth.createSession(auth.createAccount("off@example.com", "long enough").id).value;
    expect(toLogin(proxy(req("/motions")))).toBe(true);
    expect(toLogin(proxy(req("/")))).toBe(true);
    expect(proxy(req("/api/status")).status).toBe(401);
    const list = proxy(req("/api/generations"));
    expect(list.status).toBe(401);
    expect(list.headers.get(access.GUEST_HEADER)).toBeNull();
    expect(proxy(req("/api/generations", { method: "POST" })).status).toBe(401);
    expect(toLogin(proxy(req("/motions", { cookie: account })))).toBe(true);
    expect(proxy(req("/api/generations", { cookie: account })).status).toBe(401);
    const owner = auth.createSession().value;
    expect(passed(proxy(req("/motions", { cookie: owner })))).toBe(true);
    expect(passed(proxy(req("/api/generations", { method: "POST", cookie: owner })))).toBe(true);
  });
});

describe("accounts never run on the owner's keys or GPU", () => {
  it("refuses an account's runs and AI helpers with Connect your GPU", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(auth.createAccount("gpu@example.com", "long enough").id).value;
    for (const p of [
      "/api/generations",
      "/api/canvases/c1/run",
      "/api/cinema/projects/p1/generate",
      "/api/layers/l1/jobs",
      "/api/katana/k1/retry",
      "/api/enhance",
      "/api/brands/b1/chat",
      "/api/assist",
      "/api/assist/t1/messages",
      "/api/assist/t1/approval",
      "/api/faceless/episodes/e1/render",
      "/api/content-factory/claude",
      // A run route that ignores ?preview=1 isn't a price check.
      "/api/cinema/projects/p1/generate?preview=1",
      "/api/faceless/episodes/e1/estimate",
    ]) {
      const r = proxy(req(p, { method: "POST", cookie }));
      expect(r.status, p).toBe(403);
      expect(r.headers.get(access.CONNECT_GPU_HEADER), p).toBe("1");
      expect((await r.json()).code).toBe("connect-gpu");
    }
    // Owner-only routes say so (not "connect your GPU").
    expect(proxy(req("/api/mcp", { method: "POST", cookie })).headers.get(access.CONNECT_GPU_HEADER)).toBeNull();
    // Price checks and signing out are fine.
    for (const [method, p] of [
      ["POST", "/api/generations?preview=1"],
      ["POST", "/api/ads/estimate"],
      ["POST", "/api/assist/skills/s1/estimate"],
      ["POST", "/api/auth/logout"],
    ]) {
      expect(passed(proxy(req(p, { method, cookie }))), `${method} ${p}`).toBe(true);
    }
  });
});

describe("accounts never see or change the owner's library", () => {
  const families: Record<string, { lists: string[]; records: string[]; changes: [string, string][] }> = {
    generations: {
      lists: ["/api/generations", "/api/generations/trash", "/api/generations/facets"],
      records: ["/api/generations/g1", "/api/generations/zip?ids=g1"],
      changes: [["PATCH", "/api/generations/g1"], ["DELETE", "/api/generations/g1"], ["POST", "/api/generations/bulk"], ["DELETE", "/api/generations/trash"], ["POST", "/api/generations/g1/cancel"]],
    },
    files: { lists: ["/api/assets"], records: ["/api/files/outputs/a.png", "/api/assets/a1", "/api/uploads"], changes: [["POST", "/api/uploads"], ["DELETE", "/api/assets/a1"]] },
    folders: { lists: ["/api/folders"], records: ["/api/folders/f1", "/api/folders/f1/zip"], changes: [["POST", "/api/folders"], ["PATCH", "/api/folders/f1"], ["DELETE", "/api/folders/f1"]] },
    shares: { lists: ["/api/shares"], records: ["/api/shares/s1"], changes: [["POST", "/api/shares"], ["PATCH", "/api/shares/s1"], ["DELETE", "/api/shares/s1"]] },
    layers: { lists: ["/api/layers"], records: ["/api/layers/l1"], changes: [["POST", "/api/layers"], ["PATCH", "/api/layers/l1"], ["DELETE", "/api/layers/l1"], ["POST", "/api/layers/l1/versions"]] },
    elements: { lists: ["/api/elements"], records: ["/api/elements/e1"], changes: [["POST", "/api/elements"], ["PATCH", "/api/elements/e1"], ["DELETE", "/api/elements/e1"]] },
    canvases: { lists: ["/api/canvases"], records: ["/api/canvases/c1"], changes: [["POST", "/api/canvases"], ["PATCH", "/api/canvases/c1"], ["DELETE", "/api/canvases/c1"], ["POST", "/api/canvases/c1/duplicate"]] },
    cinema: { lists: ["/api/cinema/projects"], records: ["/api/cinema/projects/p1", "/api/cinema/projects/p1/items"], changes: [["POST", "/api/cinema/projects"], ["PATCH", "/api/cinema/projects/p1"], ["DELETE", "/api/cinema/projects/p1"]] },
    storyboards: { lists: [], records: ["/api/storyboards"], changes: [["POST", "/api/storyboards"]] },
    assist: { lists: ["/api/assist/projects"], records: ["/api/assist", "/api/assist/t1", "/api/assist/memory"], changes: [["PATCH", "/api/assist/t1"], ["DELETE", "/api/assist/t1"], ["POST", "/api/assist/projects"]] },
    brands: { lists: ["/api/brands", "/api/products"], records: ["/api/brands/b1"], changes: [["POST", "/api/brands"], ["DELETE", "/api/brands/b1"], ["POST", "/api/products"]] },
  };

  for (const [family, f] of Object.entries(families)) {
    it(`hides and protects ${family}`, async () => {
      process.env.FUOBE_PUBLIC_SIGNUP = "1";
      const cookie = auth.createSession(auth.createAccount(`lib-${family}@example.com`, "long enough").id).value;
      for (const p of f.lists) {
        const r = proxy(req(p, { cookie }));
        expect(r.status, p).toBe(200);
        const body = (await r.json()) as { items?: unknown[]; total?: number };
        expect(body.items ?? [], p).toEqual([]);
        if ("total" in body) expect(body.total).toBe(0);
      }
      for (const p of f.records) expect(proxy(req(p, { cookie })).status, p).toBe(403);
      for (const [method, p] of f.changes) {
        const r = proxy(req(p, { method, cookie }));
        expect(r.status, `${method} ${p}`).toBe(403);
      }
    });
  }

  it("says the library isn't theirs, not \"connect your GPU\", for a library change", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(auth.createAccount("lib-message@example.com", "long enough").id).value;
    const r = proxy(req("/api/folders", { method: "POST", cookie }));
    expect(r.headers.get(access.CONNECT_GPU_HEADER)).toBeNull();
    expect((await r.json()).code).toBe("library");
    const read = proxy(req("/api/generations/g1", { cookie }));
    expect(read.headers.get(access.GUEST_HEADER)).toBeNull();
    expect((await read.json()).error).toMatch(/owner/);
  });

  it("keeps the owner's runs unchanged", () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const owner = auth.createSession().value;
    for (const p of ["/api/generations", "/api/enhance", "/api/canvases/c1/run"]) expect(passed(proxy(req(p, { method: "POST", cookie: owner }))), p).toBe(true);
  });

  it("knows a price check from a run", () => {
    expect(access.isPriceCheck("POST", "/api/generations", "?preview=1")).toBe(true);
    expect(access.isPriceCheck("POST", "/api/dub/d1/voice", "?preview=1")).toBe(true);
    expect(access.isPriceCheck("POST", "/api/generations", "")).toBe(false);
    expect(access.isPriceCheck("POST", "/api/canvases/c1/run", "?preview=1")).toBe(false);
    expect(access.isPriceCheck("POST", "/api/shorts/sessions/s1/segments/estimate", "")).toBe(false);
    expect(access.isPriceCheck("GET", "/api/shorts/estimate", "")).toBe(false);
  });
});
