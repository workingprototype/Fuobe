/**
 * Snapshots never carry live credentials (docs/research/accounts-8.md §7.16), and the security headers (§7.1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-snap-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET"]) delete process.env[k];

const { db } = await import("@/server/db");
const { bootstrapIdentity } = await import("@/server/identity/bootstrap");
const { snapshotDatabase, STRIPPED_TABLES } = await import("@/server/backup/snapshot");
const { setOwnerPassword, ownerCookie } = await import("./helpers/identity");
const nextConfig = (await import("../next.config")).default;
const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

await bootstrapIdentity();

describe("database snapshots", () => {
  it("strip sessions, verifications and step-up marks, even from free pages, and keep everything else", async () => {
    await setOwnerPassword("correct horse battery");
    const cookie = await ownerCookie("correct horse battery");
    const token = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
    const now = new Date().toISOString();
    db().prepare(`INSERT INTO auth_verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('v1', 'reset:owner', 'secret-reset-value', ?, ?, ?)`).run(now, now, now);
    db().prepare("INSERT INTO session_step_up (session_id, user_id, confirmed_at, expires_at) VALUES ('s1', 'u_owner', 1, 2)").run();
    expect((db().prepare("SELECT COUNT(*) AS n FROM auth_session").get() as { n: number }).n).toBe(1);

    const snap = snapshotDatabase({ kind: "manual" });
    expect(path.dirname(snap.db)).toBe(path.join(dir, "backups"));
    expect(fs.statSync(path.join(dir, "backups")).mode & 0o777).toBe(0o700);
    for (const f of [snap.db, snap.secret!, snap.manifest]) expect(fs.statSync(f).mode & 0o777, f).toBe(0o600);
    expect(fs.readFileSync(snap.secret!)).toEqual(fs.readFileSync(path.join(dir, "secret.key")));

    const copy = new Database(snap.db, { readonly: true });
    for (const t of ["auth_session", "auth_verification", "session_step_up"]) expect((copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n, t).toBe(0);
    expect(copy.prepare("SELECT id FROM users").all()).toEqual([{ id: "u_owner" }]);
    expect((copy.prepare("SELECT COUNT(*) AS n FROM auth_account").get() as { n: number }).n).toBe(1);
    copy.close();
    // Not even the bytes of a deleted row survive.
    const bytes = fs.readFileSync(snap.db).toString("latin1");
    expect(bytes).not.toContain(token);
    expect(bytes).not.toContain("secret-reset-value");

    const manifest = JSON.parse(fs.readFileSync(snap.manifest, "utf8"));
    expect(manifest).toMatchObject({ kind: "manual", database: path.basename(snap.db), stripped: ["auth_session", "auth_verification", "session_step_up"] });
    expect(STRIPPED_TABLES).toEqual(expect.arrayContaining(["auth_session", "auth_verification", "session_step_up", "cli_connect_requests", "request_keys"]));
    // The live database still has its session.
    expect((db().prepare("SELECT COUNT(*) AS n FROM auth_session").get() as { n: number }).n).toBe(1);
  });

  it("refuse an odd kind name", () => {
    expect(() => snapshotDatabase({ kind: "../escape" })).toThrow(/kind/);
  });
});

describe("security headers", () => {
  const rules = async () => (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
  const headersFor = async (pathname: string) => {
    const out: Record<string, string> = {};
    for (const r of await rules()) if (getPathMatch(r.source, { removeUnnamedParams: true, strict: true })(pathname)) for (const h of r.headers) out[h.key] = h.value;
    return out;
  };

  it("forbid framing everywhere but share pages", async () => {
    for (const p of ["/", "/library", "/settings", "/login", "/api/files/outputs/a.png", "/s"]) {
      expect(await headersFor(p), p).toMatchObject({ "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" });
    }
    for (const p of ["/s/abcdefabcdefabcdefabcdefabcdefabcdefabcdefab", "/s/abc/f/outputs/a.png"]) {
      expect(await headersFor(p), p).not.toHaveProperty("X-Frame-Options");
    }
  });

  it("keep sign-in pages and their APIs out of every cache", async () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/tokens", "/api/identity/get-session"]) expect((await headersFor(p))["Cache-Control"], p).toBe("no-store");
    expect(await headersFor("/library")).not.toHaveProperty("Cache-Control");
  });
});
