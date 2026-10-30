import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const jar = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => jar }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-space-limits-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ACCOUNTS_DISK_GB;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const files = await import("@/server/account-files");
const { saveFile } = await import("@/server/storage");
const { enter, hit, resetRates } = await import("@/server/rate");
const uploads = await import("@/app/api/uploads/route");
const signup = await import("@/app/api/auth/signup/route");

const GB = 2 ** 30;
const DAY = 24 * 60 * 60_000;
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d4948445200000010000000100806000000", "hex"), Buffer.alloc(64)]);

let fresh = "";
let old = "";
beforeAll(() => {
  auth.setPassword("install password");
  fresh = auth.createAccount("fresh@example.com", "long enough").id;
  old = auth.createAccount("old@example.com", "long enough").id;
  for (const id of [fresh, old]) auth.setAccountGpu(id, { url: "https://gpu.example.com" });
  // An account made 8 days ago (auth.json is the accounts' store).
  const file = path.join(dir, "auth.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { accounts: { id: string; createdAt: number }[] };
  for (const a of data.accounts) if (a.id === old) a.createdAt = Date.now() - 8 * DAY;
  fs.writeFileSync(file, JSON.stringify(data));
  // A new modified time, so the auth module reads the file again (it caches by that time).
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
});
afterEach(() => {
  delete process.env.FUOBE_ACCOUNTS_DISK_GB;
  delete process.env.FUOBE_TRUST_PROXY;
  resetRates();
  db().prepare("DELETE FROM assets WHERE account_id IS NOT NULL").run();
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** A result of `account` that weighs `bytes` (only its row says so). */
function weigh(account: string, bytes: number) {
  const a = saveFile({ data: Buffer.from("x"), contentType: "image/png", source: "generation", accountId: account });
  db().prepare("UPDATE assets SET size = ? WHERE id = ?").run(bytes, a.id);
}

const upload = (account: string) =>
  uploads.POST(
    new Request("http://localhost:3000/api/uploads", {
      method: "POST",
      headers: { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`, "content-type": "image/png", "x-file-name": "a.png", "content-length": String(PNG.length) },
      body: PNG,
    }),
  );

describe("M-6: accounts can't fill the server's disk", () => {
  it("a new account keeps 1 GB in its first 7 days, then 3 GB", async () => {
    expect(files.accountTotalBytes(fresh)).toBe(1 * GB);
    expect(files.accountTotalBytes(old)).toBe(files.ACCOUNT_LIMITS.totalBytes);
    weigh(fresh, 1 * GB - 10);
    const r = await upload(fresh);
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/1 GB.*first 7 days/);
    weigh(old, 1 * GB - 10);
    expect((await upload(old)).status).toBe(201);
  });

  it("all accounts together keep at most a share of the disk (FUOBE_ACCOUNTS_DISK_GB)", async () => {
    process.env.FUOBE_ACCOUNTS_DISK_GB = "2";
    weigh(old, 1.5 * GB);
    expect(files.diskHasRoom()).toBe(true);
    weigh(fresh, 0.6 * GB);
    expect(files.diskHasRoom()).toBe(false);
    const r = await upload(old);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(files.ACCOUNT_MESSAGES.diskLow);
  });

  it("by default, all accounts together keep at most a quarter of the disk", () => {
    expect(files.accountsMaxBytes(400 * GB)).toBe(100 * GB);
  });

  it("a few uploads at once across every account", async () => {
    const held = Array.from({ length: files.ACCOUNT_LIMITS.uploadsAtOnceAll }, () => enter("up:accounts", files.ACCOUNT_LIMITS.uploadsAtOnceAll));
    try {
      expect(held.every(Boolean)).toBe(true);
      const r = await upload(old);
      expect(r.status).toBe(429);
    } finally {
      for (const release of held) release?.();
    }
    expect((await upload(old)).status).toBe(201);
  });

  it("an address makes at most 5 accounts a day", async () => {
    process.env.FUOBE_TRUST_PROXY = "1";
    for (let i = 0; i < 5; i++) hit("signup-day:203.0.113.5", 5, DAY);
    const r = await signup.POST(
      new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" }, body: JSON.stringify({ email: "sixth@example.com", password: "long enough" }) }),
    );
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/today/);
    const ok = await signup.POST(
      new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.6" }, body: JSON.stringify({ email: "sixth@example.com", password: "long enough" }) }),
    );
    expect(ok.status).toBe(201);
  });
});
