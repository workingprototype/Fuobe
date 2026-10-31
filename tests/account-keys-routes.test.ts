import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { keysSeen, startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";

/**
 * Settings → Your keys, the routes: an account adds, checks, replaces and removes its own fal.ai key or Replicate token.
 * A key is checked with the provider (the typed key only, never another) before it is saved, and no answer, list or
 * export ever holds a key or its sealed value. Removing or replacing a key that runs are going on asks first, then
 * stops them with the old key.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-keys-routes-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
process.env.FAL_KEY = "owner-fal-env";
process.env.REPLICATE_API_TOKEN = "owner-rep-env";
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keysRoute = await import("@/app/api/account/keys/route");
const keyRoute = await import("@/app/api/account/keys/[provider]/route");
const generationsRoute = await import("@/app/api/generations/route");
const adminRoute = await import("@/app/api/admin/accounts/route");
const meRoute = await import("@/app/api/auth/me/route");
const statusRoute = await import("@/app/api/status/route");
const modelsRoute = await import("@/app/api/models/route");
const { proxy } = await import("@/proxy");
const { setSetting } = await import("@/server/settings");
const { resetRates } = await import("@/server/rate");
const { db } = await import("@/server/db");
const { accountMayChange, accountOwnRead } = await import("@/lib/guest-access");

const GOOD_FAL = "acct-key-id-7d1e:acct-key-secret-3f9a";
const NEW_FAL = "acct-key-id-8e2f:acct-key-secret-4c0b";
const BAD_FAL = "wrong-key-id-0000:wrong-key-secret-0000";
const GOOD_REP = "r8_accountReplicateToken5c21";

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
let cookie = "";
beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  for (const k of [GOOD_FAL, NEW_FAL, "owner-fal-db", "owner-fal-env"]) fal.keys[k] = "good";
  for (const k of [GOOD_REP, "owner-rep-db", "owner-rep-env"]) rep.keys[k] = "good";
  fal.keys["outage-key-id-1111:outage-secret-1111"] = "outage";
  setSetting("falKey", "owner-fal-db");
  setSetting("replicateToken", "owner-rep-db");
  auth.setPassword("install password");
  A = auth.createAccount("routes-a@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
  await rep.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  resetRates();
  fal.log.length = 0;
  rep.log.length = 0;
  fal.pollsToFinish = 2;
});

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const req = (url: string, method: string, body?: unknown, who = cookie) =>
  new Request(`http://localhost:3000${url}`, { method, headers: { cookie: who, host: "localhost:3000", "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const put = (provider: string, body: unknown, q = "", who = cookie) => keyRoute.PUT(req(`/api/account/keys/${provider}${q}`, "PUT", body, who), ctx(provider));
const del = (provider: string, body?: unknown) => keyRoute.DELETE(req(`/api/account/keys/${provider}`, "DELETE", body), ctx(provider));
const get = async () => (await keysRoute.GET(req("/api/account/keys", "GET"))).json();
const ownerCookie = () => `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
/** Everything the account, the owner and their browsers can read, as text. */
async function everythingReadable(): Promise<string> {
  const texts = [
    JSON.stringify(await get()),
    await (await meRoute.GET(req("/api/auth/me", "GET"))).text(),
    await (await statusRoute.GET(req("/api/status", "GET"))).text(),
    await (await modelsRoute.GET(req("/api/models?kind=image", "GET"))).text(),
    await (await adminRoute.GET(req("/api/admin/accounts", "GET", undefined, ownerCookie()))).text(),
    await (await adminRoute.GET(req("/api/admin/accounts?format=csv", "GET", undefined, ownerCookie()))).text(),
    JSON.stringify(auth.listAccounts()),
  ];
  return texts.join("\n");
}
const dataFiles = () =>
  fs
    .readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, String(f)))
    .filter((f) => fs.statSync(f).isFile())
    .map((f) => ({ f, text: fs.readFileSync(f).toString("latin1") }));

describe("adding a key", () => {
  it("refuses a key the provider rejects, says how to fix it, saves nothing and never repeats the key", async () => {
    const r = await put("fal", { key: BAD_FAL });
    expect(r.status).toBe(422);
    const text = await r.text();
    expect(JSON.parse(text).error).toBe("fal.ai didn't accept this key. Copy it again from fal.ai's API keys page.");
    expect(text).not.toContain("wrong-key");
    // A key that doesn't look like one gets the format hint too.
    const half = await put("fal", { key: "fal_only_one_half" });
    expect((await half.json()).error).toMatch(/key_id:key_secret/);
    // The check sent the typed key, and only that key, to fal.ai.
    expect(keysSeen(fal.log)).toEqual([`Key ${BAD_FAL}`, "Key fal_only_one_half"]);
    expect((await get()).keys.fal).toBeNull();
  });

  it("says when the provider can't be reached or answers oddly", async () => {
    const odd = await put("fal", { key: "outage-key-id-1111:outage-secret-1111" });
    expect(odd.status).toBe(502);
    expect((await odd.json()).error).toBe("fal.ai answered 503, so the key couldn't be checked. Try again in a moment.");
    globalThis.__fuobeTestFalUrl = "http://127.0.0.1:9";
    try {
      const down = await put("fal", { key: GOOD_FAL });
      expect(down.status).toBe(502);
      expect((await down.json()).error).toBe("Couldn't reach fal.ai to check the key, so it wasn't saved. Try again in a moment.");
    } finally {
      globalThis.__fuobeTestFalUrl = fal.url;
    }
    expect((await get()).keys.fal).toBeNull();
  });

  it("checks only, with ?test=1", async () => {
    const r = await put("fal", { key: GOOD_FAL }, "?test=1");
    expect(await r.json()).toEqual({ provider: "fal", ok: true, detail: "Key accepted" });
    expect((await get()).keys.fal).toBeNull();
  });

  it("saves a key the provider accepts, answers with its last 4 characters only", async () => {
    const r = await put("fal", { key: `  ${GOOD_FAL} ` });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ provider: "fal", last4: "3f9a", addedAt: expect.any(Number), readable: true, detail: "Key accepted" });
    expect(text).not.toContain("acct-key");
    const rr = await put("replicate", { key: GOOD_REP });
    expect(await rr.json()).toMatchObject({ provider: "replicate", last4: "5c21", detail: "Signed in as alice" });
    expect(await get()).toEqual({
      keys: { fal: { last4: "3f9a", addedAt: expect.any(Number), readable: true }, replicate: { last4: "5c21", addedAt: expect.any(Number), readable: true } },
      engineMode: "both",
      paidAllowed: true,
    });
  });

  it("never shows the key or its sealed value anywhere: answers, lists, exports, status, models, files", async () => {
    const sealed = auth.accountKeyRecord(A, "fal")!.sealed;
    const all = await everythingReadable();
    for (const secret of [GOOD_FAL, "acct-key-id-7d1e", "acct-key-secret-3f9a", GOOD_REP, sealed, "owner-fal-db", "owner-rep-db"]) expect(all).not.toContain(secret);
    expect(all).toContain('"keys":["fal","replicate"]');
    expect(all).toMatch(/routes-a@example\.com,[^,]+,[^,]+,false,true,true,false/);
    for (const { f, text } of dataFiles()) for (const secret of [GOOD_FAL, "acct-key-secret-3f9a", GOOD_REP]) expect(text.includes(secret), f).toBe(false);
  });

  it("allows 10 checks a minute per account", async () => {
    resetRates();
    for (let i = 0; i < 10; i++) await put("fal", { key: GOOD_FAL }, "?test=1");
    const r = await put("fal", { key: GOOD_FAL }, "?test=1");
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("Too many checks. Wait a minute.");
  });
});

describe("who may use the routes", () => {
  it("the owner is told where the studio's keys are; an unknown provider is 404", async () => {
    const owner = await put("fal", { key: GOOD_FAL }, "", ownerCookie());
    expect(owner.status).toBe(400);
    expect((await owner.json()).error).toMatch(/Settings → Paid API configuration/);
    expect((await put("openai", { key: GOOD_FAL })).status).toBe(404);
  });

  it("the proxy lets an account reach its own keys, and keeps guests out", async () => {
    expect(accountOwnRead("/api/account/keys")).toBe(true);
    for (const m of ["PUT", "DELETE"]) {
      expect(accountMayChange(m, "/api/account/keys/fal", "")).toBe(true);
      expect(accountMayChange(m, "/api/account/keys/replicate", "")).toBe(true);
      expect(accountMayChange(m, "/api/account/keys/openai", "")).toBe(false);
    }
    expect(accountMayChange("POST", "/api/account/keys/fal", "")).toBe(false);
    const at = (url: string, method: string, who?: string) => proxy(new NextRequest(`http://localhost:3000${url}`, { method, headers: who ? { cookie: who } : {}, ...(method !== "GET" && { body: "{}" }) }));
    const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
    expect(passed(at("/api/account/keys", "GET", cookie))).toBe(true);
    expect(passed(at("/api/account/keys/fal", "PUT", cookie))).toBe(true);
    expect(passed(at("/api/account/keys/fal", "DELETE", cookie))).toBe(true);
    expect(at("/api/account/keys/fal", "PUT").status).toBe(401);
    expect(at("/api/account/keys", "GET").status).toBe(401);
    // The studio's own key settings stay the owner's.
    expect(at("/api/settings", "PUT", cookie).status).toBe(403);
    expect(at("/api/providers/test", "POST", cookie).status).toBe(403);
  });
});

describe("replacing and removing a key with runs going on it", () => {
  const startRun = async () => {
    fal.pollsToFinish = Infinity;
    const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour" });
    const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
    expect(r.status).toBe(201);
    const id = (await r.json()).items[0].id as string;
    for (let i = 0; i < 100 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    return id;
  };
  const status = (id: string) => db().prepare("SELECT status FROM generations WHERE id = ?").pluck().get(id);

  it("replace: asks first, then stops the runs with the old key and saves the new one", async () => {
    const id = await startRun();
    const ask = await put("fal", { key: NEW_FAL });
    expect(ask.status).toBe(409);
    expect(await ask.json()).toEqual({ code: "runs-going", count: 1, error: "1 run is using this key now. Replacing it stops it." });
    expect(["queued", "running"]).toContain(status(id));
    fal.log.length = 0;
    const r = await put("fal", { key: NEW_FAL, stopRuns: true });
    expect(r.status).toBe(200);
    expect((await r.json()).last4).toBe("4c0b");
    expect(status(id)).toBe("canceled");
    const cancel = fal.log.find((x) => x.path.endsWith("/cancel"));
    expect(cancel?.authorization).toBe(`Key ${GOOD_FAL}`);
    expect(fal.log.indexOf(cancel!)).toBeGreaterThan(fal.log.findIndex((x) => x.authorization === `Key ${NEW_FAL}`));
  });

  it("remove: asks first, then stops the runs with the key, and the key is gone", async () => {
    const id = await startRun();
    const ask = await del("fal");
    expect(ask.status).toBe(409);
    expect((await ask.json()).error).toBe("1 run is using this key now. Removing it stops it.");
    fal.log.length = 0;
    const r = await del("fal", { stopRuns: true });
    expect(r.status).toBe(200);
    expect((await r.json()).keys.fal).toBeNull();
    expect(status(id)).toBe("canceled");
    expect(keysSeen(fal.log)).toEqual([`Key ${NEW_FAL}`]);
    expect(auth.accountKeyRecord(A, "fal")).toBeNull();
    // Nothing more reaches fal.ai for the account, and a paid run asks for the key again.
    fal.log.length = 0;
    await globalThis.__fuobeRunner?.tick();
    expect(fal.log).toEqual([]);
    const again = await generationsRoute.POST(req("/api/generations", "POST", { feature: "image", modelId: "nano-banana-2", engine: "cloud", prompt: "x" }));
    expect(again.status).toBe(403);
    expect(again.headers.get("x-fuobe-add-key")).toBe("fal");
  });
});
