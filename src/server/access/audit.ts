import "server-only";
import { appendAudit, verifyAuditChain, type AuditChainCheck } from "../identity/audit-log";
import { requestScope } from "./actor";

/**
 * The audit log as the rest of Fuobe writes it (docs/research/accounts-8.md §7.14): `audit(action, target, meta)`
 * takes who acted, from which address and with which browser from the request scope, and appends a row to the
 * hash-chained, append-only `audit_log` (src/server/identity/audit-log.ts). Core events: auth.*, token.*, people.*,
 * team.*, install.*, keys.* (setting names and masked prefixes only), limits.*, content.share|move|grant, `denied`
 * (every 403 a route answers) and `denied.hidden` (404s for records the actor may not see, at most one a minute per
 * person and route).
 *
 * Secrets never reach the log: meta fields named like one (password, secret, token, apiKey…) are replaced before the
 * row is written, whatever the caller passed.
 */

export interface AuditTarget {
  kind: string;
  id?: string | null;
}

const SECRET_NAME = /(pass(word)?|secret|token|api_?key|private_?key|authorization|cookie)$/i;
/** Names that look like a secret's but only describe one. */
const DESCRIBES = /(prefix|id|name|kind|count|at|tokens)$/i;

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_NAME.test(k) && !DESCRIBES.test(k) && typeof v === "string" && v) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** Append an entry for whoever is acting now (the request's person, a runner's row owner, or the server). */
export function audit(action: string, target?: AuditTarget | null, meta: Record<string, unknown> = {}): void {
  const scope = requestScope();
  const actor = scope?.actor ?? null;
  appendAudit({
    action,
    actorId: actor?.userId ?? null,
    via: actor?.via ?? null,
    targetKind: target?.kind ?? null,
    targetId: target?.id ?? null,
    meta: redact({
      ...(actor?.impersonatorId && { impersonator: actor.impersonatorId }),
      ...(actor?.tokenId && { tokenId: actor.tokenId }),
      ...meta,
    }),
    ip: scope?.ip ?? null,
    userAgent: scope?.userAgent ?? null,
  });
}

/** A 403: what was refused and why (a permission, a token's scope, a code like REAUTH). */
export function auditDenied(reason: string, meta: Record<string, unknown> = {}): void {
  const scope = requestScope();
  audit("denied", null, { method: scope?.method, path: scope?.path, reason, ...meta });
}

declare global {
  var __fuobeHiddenDenials: Map<string, number> | undefined;
}

const HIDDEN_EVERY_MS = 60_000;

/**
 * A 404 for a record that exists but isn't the actor's to see. Logged at most once a minute per person and route, so
 * probing ids can't flood the log (the scoping package calls it through NotFoundError({ hidden: true })).
 */
export function auditHidden(target?: AuditTarget | null): void {
  const scope = requestScope();
  const key = `${scope?.actor?.userId ?? "-"} ${scope?.method ?? ""} ${scope?.path ?? ""}`;
  const seen = (globalThis.__fuobeHiddenDenials ??= new Map());
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < HIDDEN_EVERY_MS) return;
  if (seen.size > 5000) for (const [k, t] of seen) if (now - t >= HIDDEN_EVERY_MS) seen.delete(k);
  seen.set(key, now);
  audit("denied.hidden", target, { method: scope?.method, path: scope?.path });
}

export { verifyAuditChain, type AuditChainCheck };
