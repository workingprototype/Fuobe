import "server-only";
import { appendAudit, verifyAuditChain, type AuditChainCheck } from "../identity/audit-log";
import { SETTINGS, type SettingDef } from "../settings";
import { requestScope } from "./actor";

/**
 * The audit log as the rest of Fuobe writes it (docs/research/accounts-8.md §7.14): `audit(action, target, meta)`
 * takes who acted, from which address and with which browser from the request scope, and appends a row to the
 * hash-chained, append-only `audit_log` (src/server/identity/audit-log.ts). Core events: auth.*, token.*, people.*,
 * team.*, install.*, keys.* (setting names and masked prefixes only), limits.*, content.share|move|grant, `denied`
 * (every 403) and `denied.hidden` (404s for records the actor may not see).
 *
 * Denials nobody signed in can cause (a public route's 403, a turned-off person's credentials) and hidden-record 404s
 * are written at most once a minute per person (or address) and route; the next entry says how many more there were
 * (`more`), so a script can't grow the log as fast as it can send requests.
 *
 * Secrets never reach the log: meta fields named like one (password, secret, token, a key: apiKey, falKey, "fal.key"…),
 * values shaped like one (an API key, a bearer token), and the value of a secret setting are replaced before the row
 * is written, whatever the caller passed, in nested objects and lists too.
 */

export interface AuditTarget {
  kind: string;
  id?: string | null;
}

// ---------------------------------------------------------------------------
// Redaction

const REDACTED = "[redacted]";
const SECRET_NAME = /(pass(word)?|passphrase|secret|token|key|authorization|cookie|credentials?)$/i;
/** Names that look like a secret's but only describe one (a prefix, an id, a count, where it is kept). */
const DESCRIBES = /(prefix|id|ids|name|names|kind|count|at|tokens|mode|source|scope|scopes|set|masked|hint|last4|length)$/i;
/** Values shaped like a credential: Fuobe tokens, provider keys (sk-, r8_, hf_, AIza…), fal's id:secret, a bearer header. */
const SECRET_VALUE = [
  /^(fuobe_|sk-|sk_|rk_|pk_live_|r8_|hf_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abpr]-|AIza|AKIA)[A-Za-z0-9_\-.]{12,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{20,}$/i,
  /^(Bearer|Basic)\s+\S{8,}$/i,
];
/** A masked value ("sk-l••••abcd", "fuobe_ab…") is what the log may keep. */
const MASKED = /••••|…/;

const SETTING_DEFS = Object.entries(SETTINGS) as [string, SettingDef][];
/** Every secret setting, by its name in code and its stored key (falKey, "fal.key"). */
const SECRET_SETTINGS = new Set(SETTING_DEFS.filter(([, d]) => d.secret).flatMap(([name, d]) => [name, d.key]));
/** Every setting's name, which is a name and not a secret even in a field called `key`. */
const SETTING_NAMES = new Set(SETTING_DEFS.flatMap(([name, d]) => [name, d.key]));
/** The fields that carry a setting's value next to its name. */
const VALUE_FIELDS = new Set(["value", "from", "to", "old", "new", "previous", "next", "before", "after"]);

const secretName = (k: string) => SECRET_NAME.test(k) && !DESCRIBES.test(k);
const secretValue = (v: string) => !MASKED.test(v) && SECRET_VALUE.some((re) => re.test(v.trim()));

/** Whether this object (or the entry's target) names a secret setting, so its value fields are secrets too. */
function namesSecretSetting(o: Record<string, unknown>, target?: AuditTarget | null): boolean {
  if (target?.kind === "setting" && target.id && SECRET_SETTINGS.has(target.id)) return true;
  return ["key", "setting", "name"].some((k) => typeof o[k] === "string" && (SECRET_SETTINGS.has(o[k] as string) || (SECRET_NAME.test(o[k] as string) && !SETTING_NAMES.has(o[k] as string) && !DESCRIBES.test(o[k] as string))));
}

function redactValue(v: unknown, target?: AuditTarget | null): unknown {
  if (typeof v === "string") return secretValue(v) ? REDACTED : v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x));
  if (v && typeof v === "object") return redact(v as Record<string, unknown>, target);
  return v;
}

function redact(meta: Record<string, unknown>, target?: AuditTarget | null): Record<string, unknown> {
  const secretSetting = namesSecretSetting(meta, target);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const isString = typeof v === "string" && v !== "";
    // A field named like a secret keeps a value that is only a setting's name ("key": "fal.key") or already masked.
    if (secretName(k) && isString && !SETTING_NAMES.has(v as string) && !MASKED.test(v as string)) out[k] = REDACTED;
    else if (secretName(k) && v && typeof v === "object") out[k] = REDACTED;
    else if (secretSetting && VALUE_FIELDS.has(k) && isString && !MASKED.test(v as string)) out[k] = REDACTED;
    else out[k] = redactValue(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing

interface Who {
  actorId: string | null;
  via: string | null;
  meta: Record<string, unknown>;
}

function write(action: string, target: AuditTarget | null | undefined, meta: Record<string, unknown>, who?: Who): void {
  const scope = requestScope();
  const actor = scope?.actor ?? null;
  const by: Who = who ?? {
    actorId: actor?.userId ?? null,
    via: actor?.via ?? null,
    meta: { ...(actor?.impersonatorId && { impersonator: actor.impersonatorId }), ...(actor?.tokenId && { tokenId: actor.tokenId }) },
  };
  appendAudit({
    action,
    actorId: by.actorId,
    via: by.via,
    targetKind: target?.kind ?? null,
    targetId: target?.id ?? null,
    meta: redact({ ...by.meta, ...meta }, target),
    ip: scope?.ip ?? null,
    userAgent: scope?.userAgent ?? null,
  });
}

/** Append an entry for whoever is acting now (the request's person, a runner's row owner, or the server). */
export function audit(action: string, target?: AuditTarget | null, meta: Record<string, unknown> = {}): void {
  write(action, target, meta);
}

// ---------------------------------------------------------------------------
// Denials

declare global {
  var __fuobeAuditThrottle: Map<string, { at: number; more: number }> | undefined;
}

const THROTTLE_MS = 60_000;

/**
 * Whether an entry under `key` may be written now (at most one a minute), and how many were held back since the last
 * one. The map forgets keys a minute old once it grows, so it stays small whatever is probed.
 */
function throttle(key: string): { write: boolean; more: number } {
  const seen = (globalThis.__fuobeAuditThrottle ??= new Map());
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last.at < THROTTLE_MS) {
    last.more++;
    return { write: false, more: 0 };
  }
  if (seen.size > 5000) for (const [k, t] of seen) if (now - t.at >= THROTTLE_MS) seen.delete(k);
  seen.set(key, { at: now, more: 0 });
  return { write: true, more: last?.more ?? 0 };
}

/** The route a request reached: its path with each dynamic segment named (handler() fills it in), else the path. */
const routeOf = () => {
  const scope = requestScope();
  return scope?.route ?? scope?.path ?? "";
};

/**
 * A 403: what was refused and why (a permission, a token's scope, a code like REAUTH). Every one is written for a
 * signed-in person; for nobody (a public route's own 403), at most one a minute per address and route.
 */
export function auditDenied(reason: string, meta: Record<string, unknown> = {}): void {
  const scope = requestScope();
  const base = { method: scope?.method, path: scope?.path, reason, ...meta };
  if (scope?.actor) return write("denied", null, base);
  const t = throttle(`denied nobody ${scope?.ip ?? "-"} ${scope?.method ?? ""} ${routeOf()}`);
  if (t.write) write("denied", null, { ...base, ...(t.more && { more: t.more }) });
}

/**
 * A 403 for a person who may not act right now (pending, turned off, dormant) and showed their credentials anyway: who
 * they are and why, at most one a minute per person and route.
 */
export function auditRefused(userId: string, via: string, code: string): void {
  const scope = requestScope();
  const t = throttle(`denied ${userId} ${scope?.method ?? ""} ${routeOf()}`);
  if (t.write) write("denied", null, { method: scope?.method, path: scope?.path, reason: code, ...(t.more && { more: t.more }) }, { actorId: userId, via, meta: {} });
}

/**
 * A 404 for a record that exists but isn't the actor's to see. Logged at most once a minute per person and route (the
 * route's pattern, so probing ids can't flood the log); the scoping package calls it through
 * NotFoundError({ hidden: true }).
 */
export function auditHidden(target?: AuditTarget | null): void {
  const scope = requestScope();
  const who = scope?.actor?.userId ?? `nobody ${scope?.ip ?? "-"}`;
  const t = throttle(`hidden ${who} ${scope?.method ?? ""} ${routeOf()}`);
  if (t.write) write("denied.hidden", target, { method: scope?.method, path: scope?.path, ...(t.more && { more: t.more }) });
}

export { verifyAuditChain, type AuditChainCheck };
