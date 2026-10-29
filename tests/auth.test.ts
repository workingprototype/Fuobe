/**
 * Personal sign-in after accounts (docs/research/accounts-8.md §7.2, §8): the owner's password (formats, the
 * upgrade from auth.json's salt:hash), Settings → Security's set / change / remove, and API tokens in api_tokens.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-auth-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET"]) delete process.env[k];

const auth = await import("@/server/auth");
const pw = await import("@/server/identity/password");
const owner = await import("@/server/identity/owner");
const ops = await import("@/server/identity/admin-ops");
const tokens = await import("@/server/identity/tokens");
const { db } = await import("@/server/db");
const { setOwnerPassword, ownerCookie } = await import("./helpers/identity");
const { getAuth } = await import("@/server/identity/auth");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** How auth.json stored a password before accounts. */
const legacyHash = (password: string) => {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
};

describe("password hashes (§7.2)", () => {
  it("are scrypt v2 (N=2^15, r=8, p=3, 64 bytes) with their parameters in the string", async () => {
    const h = await pw.hashPassword("correct horse battery");
    const [scheme, version, N, r, p, salt, key] = h.split("$");
    expect([scheme, version, N, r, p]).toEqual(["scrypt", "v2", "32768", "8", "3"]);
    expect(Buffer.from(salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(key, "base64url")).toHaveLength(64);
    expect(pw.hashFormat(h)).toBe("v2");
    expect(pw.needsRehash(h)).toBe(false);
    expect(await pw.verifyPassword({ hash: h, password: "correct horse battery" })).toBe(true);
    expect(await pw.verifyPassword({ hash: h, password: "correct horse batterY" })).toBe(false);
    expect(h).not.toContain("correct horse");
  });

  it("still verify auth.json's salt:hash, which needs a rehash", async () => {
    const old = legacyHash("old password here");
    expect(pw.hashFormat(old)).toBe("legacy");
    expect(pw.needsRehash(old)).toBe(true);
    expect(await pw.verifyPassword({ hash: old, password: "old password here" })).toBe(true);
    expect(await pw.verifyPassword({ hash: old, password: "old password her" })).toBe(false);
  });

  it("never verify a damaged or unknown hash, nor one asking for absurd parameters", async () => {
    for (const hash of ["", "nope", "scrypt$v2$1024$8$1$AAAA$BBBB", `scrypt$v2$${2 ** 30}$8$1$${"A".repeat(22)}$${"B".repeat(86)}`, "zz:zz"]) {
      expect(await pw.verifyPassword({ hash, password: "anything at all" }), hash).toBe(false);
    }
  });

  it("are 8 to 128 characters", () => {
    expect(pw.passwordProblem("short")).toMatch(/8 characters/);
    expect(pw.passwordProblem("x".repeat(129))).toMatch(/128 characters/);
    expect(pw.passwordProblem("eight ch")).toBeNull();
  });
});

describe("the owner's password", () => {
  it("is off until a password is set", async () => {
    expect(auth.authEnabled()).toBe(false);
    expect(await owner.checkOwnerPassword("anything")).toBe(false);
  });

  it("is set, checked and stored only as a hash; short ones are refused", async () => {
    await expect(setOwnerPassword("short")).rejects.toThrow(/8 characters/);
    await setOwnerPassword("correct horse");
    expect(auth.authEnabled()).toBe(true);
    expect(await owner.checkOwnerPassword("correct horse")).toBe(true);
    expect(await owner.checkOwnerPassword("wrong horse")).toBe(false);
    const stored = db().prepare("SELECT password FROM auth_account WHERE userId = ?").get(owner.ownerAuthUserId()) as { password: string };
    expect(pw.hashFormat(stored.password)).toBe("v2");
    expect(fs.existsSync(path.join(dir, "auth.json"))).toBe(false);
  });

  it("signs every browser out when it changes", async () => {
    const cookie = await ownerCookie("correct horse");
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    await setOwnerPassword("another secret");
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await owner.checkOwnerPassword("another secret")).toBe(true);
  });

  it("is upgraded from auth.json's format at the next sign-in", async () => {
    const id = owner.ownerAuthUserId()!;
    await ops.setPasswordFor(id, { hash: legacyHash("from the old file") }, ops.SYSTEM);
    expect(await ops.passwordNeedsRehash(id)).toBe(true);
    const r = await owner.signInOwner("from the old file", new Headers());
    expect(r.ok).toBe(true);
    expect(await ops.passwordNeedsRehash(id)).toBe(false);
    expect(await owner.checkOwnerPassword("from the old file")).toBe(true);
    // A wrong password neither signs in nor rewrites anything.
    expect((await owner.signInOwner("from the old filE", new Headers())).ok).toBe(false);
  });

  it("is the server's when FUOBE_PASSWORD is set: Settings can't change it", async () => {
    process.env.FUOBE_PASSWORD = "from the env";
    try {
      expect(owner.ownerPasswordStatus().fromEnv).toBe(true);
      await expect(setOwnerPassword(null)).rejects.toThrow(/FUOBE_PASSWORD/);
    } finally {
      delete process.env.FUOBE_PASSWORD;
    }
  });

  it("turns sign-in off when removed (Just me on this computer)", async () => {
    await setOwnerPassword(null);
    expect(auth.authEnabled()).toBe(false);
    expect(await owner.checkOwnerPassword("from the old file")).toBe(false);
  });
});

describe("API tokens", () => {
  it("are issued once, stored only as a hash, verified by Bearer and revoked", () => {
    const { token, info } = tokens.createToken("u_owner", "CI");
    expect(token).toMatch(/^fuobe_[\w-]{32}$/);
    const ok = tokens.tokenFromHeader(`Bearer ${token}`);
    expect(ok).toMatchObject({ tokenId: info.id, userId: "u_owner", scopes: ["full"] });
    expect(tokens.tokenFromHeader(`Bearer ${token}x`)).toBe("invalid");
    expect(tokens.tokenFromHeader(token)).toBe("missing");
    expect(tokens.tokenFromHeader(null)).toBe("missing");
    expect(tokens.tokenFromHeader("Bearer fuobe_scim_abc")).toBe("invalid");
    const row = JSON.stringify(db().prepare("SELECT * FROM api_tokens WHERE id = ?").get(info.id));
    expect(row).not.toContain(token);
    expect(tokens.listTokens("u_owner")[0]).toMatchObject({ name: "CI", prefix: token.slice(0, 12) });
    expect(tokens.listTokens("u_owner")[0]).not.toHaveProperty("hash");
    expect(tokens.revokeToken("u_someone_else", info.id)).toBe(false);
    expect(tokens.revokeToken("u_owner", info.id)).toBe(true);
    expect(tokens.tokenFromHeader(`Bearer ${token}`)).toBe("invalid");
    expect(tokens.listTokens("u_owner")).toEqual([]);
  });
});
