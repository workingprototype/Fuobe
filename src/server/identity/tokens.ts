import "server-only";
import crypto from "node:crypto";
import { db } from "../db";
import { appendAudit } from "./audit-log";

/**
 * API tokens (docs/research/accounts-8.md §7.10): `fuobe_` + 24 random bytes, shown once; only the SHA-256 and a
 * 12-character prefix are kept, in `api_tokens`, owned by a person. auth.json's tokens were imported as `legacy`
 * Full tokens owned by u_owner with their hashes and prefixes, so the CLI, MCP clients and the eval harness keep
 * working unchanged. Scopes (Full, Generate only, Read only, Admin), expiry choices and workspace pins arrive with
 * the account page (acc-13) and the CLI login (acc-22); until then every token is Full and never expires.
 */

export const TOKEN_PATTERN = /^Bearer\s+(fuobe_[\w-]+)$/i;

export interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  legacy?: boolean;
}

interface TokenRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  legacy: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const info = (r: TokenRow): TokenInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.created_at,
  ...(r.last_used_at && { lastUsedAt: r.last_used_at }),
  ...(r.expires_at && { expiresAt: r.expires_at }),
  ...(r.legacy && { legacy: true }),
});

/** A person's live tokens, oldest first (the order Settings has always listed them in). */
export function listTokens(userId: string): TokenInfo[] {
  return (db().prepare("SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at, id").all(userId) as TokenRow[]).map(info);
}

export function createToken(userId: string, name: string): { token: string; info: TokenInfo } {
  const token = `fuobe_${crypto.randomBytes(24).toString("base64url")}`;
  const row: TokenRow = {
    id: crypto.randomBytes(6).toString("hex"),
    user_id: userId,
    workspace_id: null,
    name: name.trim() || "API token",
    prefix: token.slice(0, 12),
    hash: tokenHash(token),
    scopes: "full",
    legacy: 0,
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    created_at: Date.now(),
  };
  db()
    .prepare(
      `INSERT INTO api_tokens (id, user_id, workspace_id, name, prefix, hash, scopes, legacy, expires_at, last_used_at, revoked_at, created_at)
       VALUES (@id, @user_id, @workspace_id, @name, @prefix, @hash, @scopes, @legacy, @expires_at, @last_used_at, @revoked_at, @created_at)`,
    )
    .run(row);
  appendAudit({ action: "token.created", actorId: userId, targetKind: "token", targetId: row.id, meta: { name: row.name, prefix: row.prefix } });
  return { token, info: info(row) };
}

/** Revoke one of a person's tokens; false when they have no such live token. */
export function revokeToken(userId: string, id: string): boolean {
  const done = db().prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(Date.now(), id, userId).changes > 0;
  if (done) appendAudit({ action: "token.revoked", actorId: userId, targetKind: "token", targetId: id });
  return done;
}

/** Import one auth.json token as a legacy Full token (its id, name, hash and prefix kept); false if it was there. */
export function importLegacyToken(userId: string, t: { id: string; name: string; hash: string; prefix: string; createdAt: number; lastUsedAt?: number }): boolean {
  return (
    db()
      .prepare(
        `INSERT OR IGNORE INTO api_tokens (id, user_id, name, prefix, hash, scopes, legacy, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'full', 1, ?, ?)`,
      )
      .run(t.id, userId, t.name || "API token", t.prefix || "fuobe_", t.hash.toLowerCase(), t.lastUsedAt ?? null, t.createdAt || Date.now()).changes > 0
  );
}

export interface TokenOwner {
  tokenId: string;
  userId: string;
  scopes: string[];
  workspacePin: string | null;
}

const touched = new Map<string, number>();

/**
 * The live token an Authorization header carries: "missing" when it carries none (or not a fuobe_ one), "invalid"
 * when the token is unknown, revoked or expired. `fuobe_scim_` tokens are never API tokens. Use is recorded at most
 * once an hour per token, to avoid a write per request.
 */
export function tokenFromHeader(header: string | null): TokenOwner | "missing" | "invalid" {
  const m = TOKEN_PATTERN.exec(header?.trim() ?? "");
  if (!m) return "missing";
  if (m[1].startsWith("fuobe_scim_")) return "invalid";
  const row = db().prepare("SELECT * FROM api_tokens WHERE hash = ?").get(tokenHash(m[1])) as TokenRow | undefined;
  const now = Date.now();
  if (!row || row.revoked_at || (row.expires_at && row.expires_at <= now)) return "invalid";
  if (now - (touched.get(row.id) ?? 0) > 3_600_000) {
    touched.set(row.id, now);
    db().prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
  }
  return { tokenId: row.id, userId: row.user_id, scopes: row.scopes.split(",").filter(Boolean), workspacePin: row.workspace_id };
}
