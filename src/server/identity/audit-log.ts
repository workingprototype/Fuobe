import "server-only";
import crypto from "node:crypto";
import { db } from "../db";

/**
 * The append-only audit log's storage (docs/research/accounts-8.md §7.14): each row carries the hash of the row
 * before it, so a changed or removed row breaks the chain from there on. This is the bare writer the identity core
 * needs (imports, sign-ins, admin operations); the actor-aware `audit()` (src/server/access/audit.ts) reads the
 * request scope and writes through it. The table refuses UPDATE and DELETE (triggers in db.ts). Never put a secret
 * in `meta` (a password, a token, a key): names and prefixes only.
 */

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  via?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

interface Row {
  seq: number;
  at: number;
  actor_id: string | null;
  actor_via: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  meta_json: string;
  ip: string | null;
  user_agent: string | null;
  prev_hash: string;
  hash: string;
}

const rowHash = (prev: string, r: Omit<Row, "seq" | "prev_hash" | "hash">) =>
  crypto
    .createHash("sha256")
    .update(prev)
    .update(JSON.stringify([r.at, r.actor_id, r.actor_via, r.action, r.target_kind, r.target_id, r.meta_json, r.ip, r.user_agent]))
    .digest("hex");

export function appendAudit(e: AuditEntry): void {
  const d = db();
  d.transaction(() => {
    const prev = (d.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined)?.hash ?? "";
    const r = {
      at: Date.now(),
      actor_id: e.actorId ?? null,
      actor_via: e.via ?? null,
      action: e.action,
      target_kind: e.targetKind ?? null,
      target_id: e.targetId ?? null,
      meta_json: JSON.stringify(e.meta ?? {}),
      ip: e.ip ?? null,
      user_agent: e.userAgent ? e.userAgent.slice(0, 300) : null,
    };
    d.prepare(
      `INSERT INTO audit_log (at, actor_id, actor_via, action, target_kind, target_id, meta_json, ip, user_agent, prev_hash, hash)
       VALUES (@at, @actor_id, @actor_via, @action, @target_kind, @target_id, @meta_json, @ip, @user_agent, @prev_hash, @hash)`,
    ).run({ ...r, prev_hash: prev, hash: rowHash(prev, r) });
  }).immediate();
}

/** The newest entries, newest first (tests and, later, the audit viewer). */
export function recentAudit(limit = 50): Row[] {
  return db().prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?").all(limit) as Row[];
}

export interface AuditChainCheck {
  ok: boolean;
  /** Rows checked. */
  rows: number;
  /** The time of the last row that verified ("Records verified up to {time}"); null when none did. */
  verifiedUpTo: number | null;
  /** The first row that doesn't match what the row before it remembers ("The record changed after {time}"). */
  brokenAt?: { seq: number; at: number };
}

/**
 * Walk the chain from the first row: each row must remember the hash of the row before it and hash to its own. A row
 * changed in place, removed from the middle or inserted out of order breaks it from there on.
 */
export function verifyAuditChain(): AuditChainCheck {
  let prev = "";
  let rows = 0;
  let verifiedUpTo: number | null = null;
  for (const r of db().prepare("SELECT * FROM audit_log ORDER BY seq").iterate() as Iterable<Row>) {
    if (r.prev_hash !== prev || r.hash !== rowHash(prev, r)) return { ok: false, rows, verifiedUpTo, brokenAt: { seq: r.seq, at: r.at } };
    prev = r.hash;
    rows++;
    verifiedUpTo = r.at;
  }
  return { ok: true, rows, verifiedUpTo };
}

/** Whether every row still hashes to what the next one remembers: false from the first changed row on. */
export function auditChainIntact(): boolean {
  return verifyAuditChain().ok;
}
