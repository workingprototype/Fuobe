/**
 * The identity bootstrap (docs/research/accounts-8.md §7.9, §7.15, §7.16), as a matrix of data folders: fresh, an
 * install from before accounts with and without a password and API tokens, FUOBE_PASSWORD, a second start, a
 * changed secret key and FUOBE_MODE. Each case boots fresh modules on its own folder, as a server start would.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Real scrypt hashes (N=2^15) and fresh module loads per case: slow under a parallel run.
vi.setConfig({ testTimeout: 60_000 });

const ENV = ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET", "FUOBE_ACCEPT_NEW_SECRET", "FUOBE_DEV_PLATFORM", "FUOBE_SITE_URL", "FUOBE_TRUST_PROXY", "FUOBE_TRUSTED_PROXIES"];
for (const k of ENV) delete process.env[k];
const dirs: string[] = [];
afterAll(() => {
  closeDbs();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

function closeDbs() {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
  globalThis.__fuobeAuthDb?.db.close();
  globalThis.__fuobeAuthDb = undefined;
}

const newDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-boot-"));
  dirs.push(d);
  return d;
};

/** Fresh modules on `dir`, as a new server process would load them. */
async function load(dir: string) {
  closeDbs();
  vi.resetModules();
  process.env.FUOBE_DATA_DIR = dir;
  return {
    bootstrap: await import("@/server/identity/bootstrap"),
    mode: await import("@/server/mode"),
    dbm: await import("@/server/db"),
    owner: await import("@/server/identity/owner"),
    ops: await import("@/server/identity/admin-ops"),
    tokens: await import("@/server/identity/tokens"),
    principal: await import("@/server/identity/principal"),
    proxy: (await import("@/proxy")).proxy,
    login: await import("@/app/api/auth/login/route"),
    password: await import("@/app/api/auth/password/route"),
  };
}

async function boot(dir: string) {
  const m = await load(dir);
  const report = await m.bootstrap.bootstrapIdentity();
  return { ...m, report };
}

/** A database as a build from before accounts left it: every migration but the identity one. */
async function preAccountsDb(dir: string) {
  const { dbm } = await load(dir);
  const d = dbm.db();
  for (const t of ["users", "workspaces", "workspace_members", "invites", "grants", "item_marks", "api_tokens", "audit_log", "user_settings", "workspace_settings", "session_step_up", "auth_user", "auth_session", "auth_account", "auth_verification", "auth_rate_limit"]) d.exec(`DROP TABLE IF EXISTS "${t}"`);
  d.prepare("DELETE FROM _migrations WHERE id = ?").run(dbm.IDENTITY_MIGRATION);
  d.prepare("INSERT INTO settings (key, value) VALUES ('engine.mode', 'open')").run();
  closeDbs();
}

const legacyHash = (password: string) => {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
};
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const TOKEN_A = `fuobe_${"a".repeat(32)}`;
const TOKEN_B = `fuobe_${"b".repeat(32)}`;

function writeAuthJson(dir: string, opts: { password?: string; tokens?: boolean }) {
  const data = {
    ...(opts.password && { password: legacyHash(opts.password) }),
    secret: crypto.randomBytes(32).toString("hex"),
    tokens: opts.tokens
      ? [
          { id: "aaaaaaaaaaaa", name: "CLI", hash: sha(TOKEN_A), prefix: TOKEN_A.slice(0, 12), createdAt: 1_700_000_000_000, lastUsedAt: 1_700_000_100_000 },
          { id: "bbbbbbbbbbbb", name: "MCP", hash: sha(TOKEN_B), prefix: TOKEN_B.slice(0, 12), createdAt: 1_700_000_200_000 },
        ]
      : [],
  };
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify(data), { mode: 0o600 });
  return data;
}

const BY = { actorId: "u_owner", via: "local" };
/** A password of exactly `n` characters. */
const longPassword = (n: number) => "correct horse battery staple ".repeat(Math.ceil(n / 29)).slice(0, n);
/** Set-Cookie lines → the Cookie header a browser would send next. */
const cookieOf = (setCookies: string[]) =>
  setCookies
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(";")[0])
    .join("; ");

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
const loginPost = (password: string) =>
  new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" }, body: JSON.stringify({ password }) });

describe("a fresh data folder", () => {
  it("boots as Personal, sign-in off, setup done: Just me on this computer, as before accounts", async () => {
    const dir = newDir();
    const m = await boot(dir);
    expect(m.report).toMatchObject({ snapshot: null, importedPassword: false, importedTokens: 0, signin: "off" });
    expect(m.mode.installMode()).toBe("personal");
    expect(m.mode.setupState()).toBe("done");
    expect(m.mode.signInRequired()).toBe(false);
    expect(m.principal.justMe(req("http://localhost:3000/"))).toBe(true);
    expect((await m.principal.resolvePrincipal(req("http://localhost:3000/library"))).actor).toMatchObject({ userId: "u_owner", via: "local", role: "owner" });
    // The owner exists, unclaimed, with a personal workspace; the install catalog too.
    const d = m.dbm.db();
    expect(d.prepare("SELECT id, role, status, auth_user_id, personal_workspace_id FROM users").all()).toEqual([
      { id: "u_owner", role: "owner", status: "active", auth_user_id: null, personal_workspace_id: "w_owner" },
    ]);
    expect(d.prepare("SELECT id, kind FROM workspaces ORDER BY id").all()).toEqual([
      { id: "w_install", kind: "install" },
      { id: "w_owner", kind: "personal" },
    ]);
    // The root secret, private, and its fingerprint (never the secret) in the database.
    const key = path.join(dir, "secret.key");
    expect(fs.statSync(key).size).toBe(32);
    expect(fs.statSync(key).mode & 0o777).toBe(0o600);
    expect(m.mode.installValue("identity.secret_check")).toMatch(/^[0-9a-f]{32}$/);
    expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
  });
});

describe("an install from before accounts", () => {
  it("is copied first, then its password and tokens move to accounts; old cookies stop, tokens keep working", async () => {
    const dir = newDir();
    await preAccountsDb(dir);
    const before = writeAuthJson(dir, { password: "the old password", tokens: true });
    const m = await boot(dir);

    // 1. The pre-accounts snapshot: the database as it was, beside a manifest, private.
    const snap = m.report.snapshot!;
    expect(path.basename(snap.db)).toMatch(/^fuobe-\d{8}T\d{6}Z-pre-accounts\.db$/);
    expect(fs.statSync(snap.db).mode & 0o777).toBe(0o600);
    const copy = new Database(snap.db, { readonly: true });
    const tables = (copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).not.toContain("users");
    expect(copy.prepare("SELECT value FROM settings WHERE key = 'engine.mode'").get()).toEqual({ value: "open" });
    copy.close();
    expect(JSON.parse(fs.readFileSync(snap.manifest, "utf8"))).toMatchObject({ kind: "pre-accounts", stripped: [] });

    // 2. Personal with sign-in; the password and both tokens imported once.
    expect(m.report).toMatchObject({ importedPassword: true, importedTokens: 2, signin: "on" });
    expect(m.mode.signInRequired()).toBe(true);
    expect(m.mode.installValue("engine.mode")).toBe("open");
    expect(m.dbm.db().prepare("SELECT source FROM users WHERE id = 'u_owner'").get()).toEqual({ source: "legacy" });
    const id = m.owner.ownerAuthUserId()!;
    expect(await m.ops.passwordNeedsRehash(id)).toBe(true);

    // 3. The old password signs in (one password field), and is rewritten as scrypt v2.
    expect((await m.login.POST(loginPost("not it at all"))).status).toBe(401);
    const ok = await m.login.POST(loginPost("the old password"));
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().some((c) => c.startsWith("fuobe.session_token="))).toBe(true);
    expect(await m.ops.passwordNeedsRehash(id)).toBe(false);

    // 4. The tokens are legacy Full tokens with the same hashes: the CLI and MCP keep working.
    expect(m.tokens.listTokens("u_owner")).toEqual([
      { id: "aaaaaaaaaaaa", name: "CLI", prefix: TOKEN_A.slice(0, 12), createdAt: 1_700_000_000_000, lastUsedAt: 1_700_000_100_000, legacy: true },
      { id: "bbbbbbbbbbbb", name: "MCP", prefix: TOKEN_B.slice(0, 12), createdAt: 1_700_000_200_000, legacy: true },
    ]);
    const api = await m.proxy(req("http://localhost:3000/api/generations", { authorization: `Bearer ${TOKEN_B}` }));
    expect(api.headers.get("x-middleware-next")).toBe("1");
    // A pre-accounts session cookie is no longer accepted.
    const old = await m.proxy(req("http://localhost:3000/library", { cookie: `fuobe_session=${Date.now() + 1e9}.abc` }));
    expect(old.status).toBe(307);

    // 5. auth.json stays, untouched, for one release.
    expect(JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8"))).toEqual(before);

    // A second start changes nothing and imports nothing again.
    const again = await boot(dir);
    expect(again.report).toMatchObject({ snapshot: null, importedPassword: false, importedTokens: 0, signin: "on" });
    expect(again.tokens.listTokens("u_owner")).toHaveLength(2);
  });

  it("without a password stays Just me, and its tokens still move", async () => {
    const dir = newDir();
    await preAccountsDb(dir);
    writeAuthJson(dir, { tokens: true });
    const m = await boot(dir);
    expect(m.report).toMatchObject({ importedPassword: false, importedTokens: 2, signin: "off" });
    expect(m.report.snapshot).not.toBeNull();
    expect(m.mode.signInRequired()).toBe(false);
    expect(m.owner.ownerAuthUserId()).toBeNull();
    expect(m.tokens.tokenFromHeader(`Bearer ${TOKEN_A}`)).toMatchObject({ userId: "u_owner" });
  });
});

describe("FUOBE_PASSWORD", () => {
  it("turns sign-in on, is the owner's password, and is synced at every start", async () => {
    const dir = newDir();
    process.env.FUOBE_PASSWORD = "break glass one";
    const m = await boot(dir);
    expect(m.report).toMatchObject({ syncedEnvPassword: true, signin: "on" });
    expect(m.dbm.db().prepare("SELECT source FROM users WHERE id = 'u_owner'").get()).toEqual({ source: "env" });
    expect(await m.owner.checkOwnerPassword("break glass one")).toBe(true);
    const cookie = (await m.login.POST(loginPost("break glass one"))).headers.getSetCookie()[0].split(";")[0];
    expect((await m.proxy(req("http://localhost:3000/library", { cookie }))).headers.get("x-middleware-next")).toBe("1");

    // Same value: nothing rewritten, sessions kept.
    const same = await boot(dir);
    expect(same.report.syncedEnvPassword).toBe(false);
    expect((await same.proxy(req("http://localhost:3000/library", { cookie }))).headers.get("x-middleware-next")).toBe("1");

    // A new value replaces the old one and signs every browser out.
    process.env.FUOBE_PASSWORD = "break glass two";
    const changed = await boot(dir);
    expect(changed.report.syncedEnvPassword).toBe(true);
    expect(await changed.owner.checkOwnerPassword("break glass two")).toBe(true);
    expect(await changed.owner.checkOwnerPassword("break glass one")).toBe(false);
    expect((await changed.proxy(req("http://localhost:3000/library", { cookie }))).status).toBe(307);
  });

  it("also works as FUOBE_OWNER_PASSWORD", async () => {
    process.env.FUOBE_OWNER_PASSWORD = "owner from env";
    const m = await boot(newDir());
    expect(m.report.signin).toBe("on");
    expect(await m.owner.checkOwnerPassword("owner from env")).toBe(true);
  });
});

describe("the secret key's fingerprint (§7.15)", () => {
  it("refuses to start with another key, unless FUOBE_ACCEPT_NEW_SECRET=1 (which signs everyone out)", async () => {
    const dir = newDir();
    process.env.FUOBE_PASSWORD = "a password here";
    const m = await boot(dir);
    const cookie = (await m.login.POST(loginPost("a password here"))).headers.getSetCookie()[0].split(";")[0];
    const sessions = () => (m.dbm.db().prepare("SELECT COUNT(*) AS n FROM auth_session").get() as { n: number }).n;
    expect(sessions()).toBe(1);

    process.env.FUOBE_SECRET = "f".repeat(64);
    const refused = await load(dir);
    await expect(refused.bootstrap.bootstrapIdentity()).rejects.toThrow(/secret key doesn't match/);
    await expect(refused.bootstrap.bootstrapIdentity()).rejects.toBeInstanceOf(refused.bootstrap.StartupError);

    process.env.FUOBE_ACCEPT_NEW_SECRET = "1";
    const accepted = await boot(dir);
    expect((accepted.dbm.db().prepare("SELECT COUNT(*) AS n FROM auth_session").get() as { n: number }).n).toBe(0);
    expect((await accepted.proxy(req("http://localhost:3000/library", { cookie }))).status).toBe(307);
    // From now on the new key is the expected one.
    delete process.env.FUOBE_ACCEPT_NEW_SECRET;
    expect((await boot(dir)).report.signin).toBe("on");
  });

  it("refuses a FUOBE_SECRET that is too short, as a start-up error", async () => {
    process.env.FUOBE_SECRET = "short";
    const m = await load(newDir());
    await expect(m.bootstrap.bootstrapIdentity()).rejects.toThrow(/FUOBE_SECRET is too short/);
    await expect(m.bootstrap.bootstrapIdentity()).rejects.toBeInstanceOf(m.bootstrap.StartupError);
  });
});

describe("FUOBE_MODE", () => {
  it("personal boots (Just me unless a password says otherwise); studio and platform aren't ready yet", async () => {
    process.env.FUOBE_MODE = "personal";
    expect((await boot(newDir())).report.signin).toBe("off");
    process.env.FUOBE_MODE = "studio";
    await expect((await load(newDir())).bootstrap.bootstrapIdentity()).rejects.toThrow(/FUOBE_MODE=studio needs the first-run setup/);
    process.env.FUOBE_MODE = "platform";
    await expect((await load(newDir())).bootstrap.bootstrapIdentity()).rejects.toThrow(/FUOBE_DEV_PLATFORM=1/);
    process.env.FUOBE_MODE = "public";
    await expect((await load(newDir())).bootstrap.bootstrapIdentity()).rejects.toThrow(/isn't a mode/);
  });
});

describe("long passwords (they signed in before accounts, so they still do)", () => {
  it("an auth.json password over 128 characters signs in, and is rewritten", async () => {
    const dir = newDir();
    await preAccountsDb(dir);
    const pw = longPassword(150);
    writeAuthJson(dir, { password: pw });
    const m = await boot(dir);
    expect(m.report).toMatchObject({ importedPassword: true, signin: "on" });
    expect((await m.login.POST(loginPost(pw))).status).toBe(200);
    const id = m.owner.ownerAuthUserId()!;
    expect(await m.ops.passwordNeedsRehash(id)).toBe(false);
    expect((await m.owner.signInOwner(pw, new Headers())).ok).toBe(true);
  });

  it("FUOBE_PASSWORD up to 500 characters signs in; a longer one stops the start with one line", async () => {
    process.env.FUOBE_PASSWORD = longPassword(129);
    const m = await boot(newDir());
    expect(m.report).toMatchObject({ syncedEnvPassword: true, signin: "on" });
    expect((await m.login.POST(loginPost(longPassword(129)))).status).toBe(200);

    process.env.FUOBE_PASSWORD = longPassword(500);
    expect((await (await boot(newDir())).owner.signInOwner(longPassword(500), new Headers())).ok).toBe(true);

    // Nor was there a shortest one: a short FUOBE_PASSWORD still signs in (Better Auth checks no minimum at sign-in).
    process.env.FUOBE_PASSWORD = "pw1";
    expect((await (await boot(newDir())).login.POST(loginPost("pw1"))).status).toBe(200);

    process.env.FUOBE_PASSWORD = longPassword(501);
    const tooLong = await load(newDir());
    await expect(tooLong.bootstrap.bootstrapIdentity()).rejects.toThrow(/^FUOBE_PASSWORD is longer than 500 characters/);
    await expect(tooLong.bootstrap.bootstrapIdentity()).rejects.toBeInstanceOf(tooLong.bootstrap.StartupError);
    delete process.env.FUOBE_PASSWORD;
    process.env.FUOBE_OWNER_PASSWORD = longPassword(501);
    await expect((await load(newDir())).bootstrap.bootstrapIdentity()).rejects.toThrow(/^FUOBE_OWNER_PASSWORD is longer/);
  });

  it("a new password still stops at 128 characters", async () => {
    const m = await boot(newDir());
    await expect(m.owner.changeOwnerPassword(longPassword(129), BY)).rejects.toThrow(/at most 128/);
    await m.owner.changeOwnerPassword(longPassword(128), BY);
    expect(await m.owner.checkOwnerPassword(longPassword(128))).toBe(true);
  });
});

describe("FUOBE_SIGNIN locks the switch (§7.9)", () => {
  it("on, with no password to sign in with, stops the start with one line", async () => {
    process.env.FUOBE_SIGNIN = "on";
    const m = await load(newDir());
    await expect(m.bootstrap.bootstrapIdentity()).rejects.toThrow(/^FUOBE_SIGNIN=on needs the owner's password/);
    await expect(m.bootstrap.bootstrapIdentity()).rejects.toBeInstanceOf(m.bootstrap.StartupError);
    // With FUOBE_PASSWORD (or an auth.json password) it starts.
    process.env.FUOBE_PASSWORD = "break glass pw";
    expect((await boot(newDir())).report.signin).toBe("on");
    delete process.env.FUOBE_PASSWORD;
    const dir = newDir();
    await preAccountsDb(dir);
    writeAuthJson(dir, { password: "the old password" });
    expect((await boot(dir)).report.signin).toBe("on");
  });

  it("on: the Settings password can be changed but not removed (no install nobody can sign in to)", async () => {
    const dir = newDir();
    await (await boot(dir)).owner.changeOwnerPassword("settings password", BY);
    process.env.FUOBE_SIGNIN = "on";
    const m = await boot(dir);
    expect(m.owner.ownerPasswordStatus()).toEqual({ fromEnv: false, signinFromEnv: true });
    await expect(m.owner.changeOwnerPassword(null, BY)).rejects.toThrow(/FUOBE_SIGNIN/);
    expect(m.mode.signInRequired()).toBe(true);
    expect(await m.owner.checkOwnerPassword("settings password")).toBe(true);

    // As Settings → Security sends it, from the signed-in browser: refused, and the password still works.
    const signedIn = await m.owner.signInOwner("settings password", new Headers());
    expect(signedIn.ok).toBe(true);
    const cookie = cookieOf(signedIn.ok ? signedIn.setCookies : []);
    const remove = await m.password.POST(
      new Request("http://localhost:3000/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", cookie },
        body: JSON.stringify({ current: "settings password", password: null }),
      }),
    );
    expect(remove.status).toBe(400);
    expect(((await remove.json()) as { error: string }).error).toMatch(/FUOBE_SIGNIN/);
    expect((await m.login.POST(loginPost("settings password"))).status).toBe(200);

    // Changing it still works.
    await m.owner.changeOwnerPassword("another settings pw", BY);
    expect(await m.owner.checkOwnerPassword("another settings pw")).toBe(true);
  });

  it("off: the install stays open, and Settings can't claim to require a password", async () => {
    process.env.FUOBE_SIGNIN = "off";
    const m = await boot(newDir());
    expect(m.mode.signInRequired()).toBe(false);
    expect(m.owner.ownerPasswordStatus()).toEqual({ fromEnv: false, signinFromEnv: false });
    await expect(m.owner.changeOwnerPassword("a new password", BY)).rejects.toThrow(/FUOBE_SIGNIN/);
    expect(m.owner.ownerAuthUserId()).toBeNull();
    expect(m.mode.signInRequired()).toBe(false);
  });
});

describe("FUOBE_PASSWORD after it is unset", () => {
  it("stays the owner's password with sign-in on, and Settings can then change or remove it", async () => {
    const dir = newDir();
    process.env.FUOBE_PASSWORD = "temporary env pw";
    await boot(dir);
    delete process.env.FUOBE_PASSWORD;
    const m = await boot(dir);
    expect(m.report).toMatchObject({ syncedEnvPassword: false, signin: "on" });
    expect(await m.owner.checkOwnerPassword("temporary env pw")).toBe(true);
    expect(m.owner.ownerPasswordStatus().fromEnv).toBe(false);
    await m.owner.changeOwnerPassword(null, BY);
    expect(m.mode.signInRequired()).toBe(false);
  });
});

describe("start-up errors", () => {
  it("are one line naming the problem, never a stack trace", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.FUOBE_SECRET = "short";
      await (await load(newDir())).bootstrap.startIdentity();
      delete process.env.FUOBE_SECRET;
      const damaged = newDir();
      fs.writeFileSync(path.join(damaged, "secret.key"), Buffer.alloc(10), { mode: 0o600 });
      await (await load(damaged)).bootstrap.startIdentity();
      process.env.FUOBE_SIGNIN = "on";
      await (await load(newDir())).bootstrap.startIdentity();

      expect(exit.mock.calls).toEqual([[1], [1], [1]]);
      expect(err.mock.calls.map((c) => c.length)).toEqual([1, 1, 1]);
      const lines = err.mock.calls.map((c) => c[0] as unknown);
      for (const line of lines) {
        expect(typeof line).toBe("string");
        expect(line as string).toMatch(/^Fuobe can't start: /);
        // No stack trace: a single line.
        expect(line as string).not.toMatch(/\n/);
      }
      expect(lines[0]).toMatch(/FUOBE_SECRET is too short/);
      expect(lines[1]).toMatch(/secret\.key is damaged/);
      expect(lines[2]).toMatch(/FUOBE_SIGNIN=on needs/);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });
});
