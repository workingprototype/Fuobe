import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nanoid } from "nanoid";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Kysely, SqliteDialect } from "kysely";
import { hostAllowed, trustedProxies } from "../auth";
import { DATA_DIR, db } from "../db";
import { INSTALL, installMode, installValue, siteUrl } from "../mode";
import { appendAudit } from "./audit-log";
import { hashPassword, needsRehash, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_SIGN_IN_MAX, verifyPassword } from "./password";
import { refusal } from "./refusals";
import { AUTH_TABLES } from "./schema";
import { deriveKey } from "./secret";

/**
 * Better Auth, behind Fuobe (docs/research/accounts-8.md §5.2, §7.1). It answers "who is this": passwords,
 * sessions and (in later packages) passkeys, two-step, Google/GitHub/OIDC and company sign-in. Fuobe answers what
 * they may do. Fuobe reaches its tables in three places only: principal.ts (auth.api.getSession), people lists
 * (read-only joins) and admin-ops.ts (the internal adapter).
 *
 * How it is set up, and why:
 * - Its own better-sqlite3 connection to data/fuobe.db (WAL, busy_timeout 5000), tables named auth_*, no extra
 *   fields, telemetry off; the schema is frozen in Fuobe's migrations (scripts/auth-schema.mjs prints it).
 *   Better Auth's multi-statement transactions are off: on SQLite they would hold the write lock across awaits
 *   (sign-up hashes the password inside one), and a Fuobe write on the other connection in that window would
 *   busy-wait on the event loop the transaction needs to finish. Each statement commits on its own instead.
 * - The secret is HKDF(root secret, "better-auth/v1"), so it never sits in the database or the environment as is.
 * - Cookies are named fuobe.*; on an https site address they become __Host-fuobe.* with Secure and Path=/ and no
 *   Domain (useSecureCookies stays false: Better Auth would otherwise prefix __Secure-). Plain http (localhost,
 *   the LAN) keeps the plain names, without Secure.
 * - Client IPs come only from x-fuobe-client-ip, which the proxy deletes from every request and writes only when
 *   a trusted proxy is configured. Without one, IP tracking is off, so Better Auth's limiter skips its IP rules
 *   instead of putting every client in one bucket that anyone could fill.
 * - Sessions last 30 days, refreshed once a day, and only on POST (GET stays read-only); no cookie cache.
 * - Router traffic (/api/identity/*) may reach only the allowlisted endpoints; Fuobe's own auth.api calls pass.
 *   Sign-up and social sign-in are off the list until the sign-in package adds them with their policy.
 * - A new Better Auth user needs a Fuobe intent (claiming the owner, the auth.json import) until the meter
 *   package sets accounts.multi_user, so no second account can exist before isolation and limits do. Each intent
 *   has its own check: the owner's two refuse once the owner has a live sign-in account.
 * - Passwords: new ones are 8 to 128 characters on every path; sign-in takes up to 500, so a longer password from
 *   before accounts (or FUOBE_PASSWORD) still works.
 */

declare global {
  var __fuobeAuthDb: { file: string; db: Database.Database; kysely: Kysely<unknown> } | undefined;
}

/** Better Auth's connection. Opened after Fuobe's own, so the frozen tables exist before Better Auth reads them. */
export function authDb(): Database.Database {
  db();
  const file = path.join(DATA_DIR, "fuobe.db");
  if (globalThis.__fuobeAuthDb?.file !== file) {
    const conn = new Database(file);
    conn.pragma("journal_mode = WAL");
    conn.pragma("busy_timeout = 5000");
    conn.pragma("foreign_keys = ON");
    globalThis.__fuobeAuthDb = { file, db: conn, kysely: new Kysely({ dialect: new SqliteDialect({ database: conn }) }) };
  }
  return globalThis.__fuobeAuthDb.db;
}

/** The same connection as Better Auth's adapter sees it (transactions off, see above). */
function authDatabase() {
  authDb();
  return { db: globalThis.__fuobeAuthDb!.kysely, type: "sqlite" as const, transaction: false };
}

// ---------------------------------------------------------------------------
// Registries

/** A path rule for the router allowlist: an exact Better Auth path, or a prefix ending in "/*". */
type PathRule = string;
const matches = (rule: PathRule, p: string) => (rule.endsWith("/*") ? p.startsWith(rule.slice(0, -1)) : p === rule);

/**
 * Endpoints the browser may reach at /api/identity/*. Built from what is loaded: each package that loads a plugin or
 * opens a flow adds its paths (sign-in pages add /sign-in/email, /sign-up/email and the social paths with their
 * policy, acc-11). Everything else answers 403 to router traffic.
 */
export const ROUTER_ALLOWED: PathRule[] = ["/get-session", "/sign-out", "/update-user", "/ok", "/error"];

/** Never reachable from the browser, whatever a package adds (§7.1). */
export const ROUTER_BLOCKED: PathRule[] = [
  "/delete-user",
  "/delete-user/*",
  "/update-session",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
  "/change-email",
  "/send-verification-email",
  "/sign-in/email-otp",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
];

export const routerAllows = (p: string): boolean => !ROUTER_BLOCKED.some((r) => matches(r, p)) && ROUTER_ALLOWED.some((r) => matches(r, p));

/**
 * Why Fuobe is creating a Better Auth user, each with its own check (a refusal code, or null to go ahead). The two
 * core intents only ever make the owner's sign-in account, so they refuse once the owner has a live one. Packages
 * add theirs (invite, sso, scim, admin) with registerCreateIntent.
 */
export type CreateIntentCheck = () => string | null;
export const CREATE_INTENTS = new Map<string, CreateIntentCheck>([
  ["claim-owner", () => (ownerClaimable() ? null : "OWNER_CLAIMED")],
  ["bootstrap-import", () => (ownerClaimable() ? null : "OWNER_CLAIMED")],
]);

export function registerCreateIntent(intent: string, check: CreateIntentCheck): void {
  CREATE_INTENTS.set(intent, check);
}

const createIntent = new AsyncLocalStorage<string>();

/** Run `fn` with a create intent, so user.create.before lets the new user through. */
export function withCreateIntent<T>(intent: string, fn: () => Promise<T>): Promise<T> {
  return createIntent.run(intent, fn);
}

/** The intent of the create in progress (null outside withCreateIntent). */
export const currentCreateIntent = (): string | null => createIntent.getStore() ?? null;

/** A person row as session checks see it. */
export interface PersonRow {
  id: string;
  role: string;
  status: string;
  dormant: number;
}

/**
 * Checks before a session is created, in order: each may refuse with a code (core codes ACCOUNT_PENDING,
 * ACCOUNT_DISABLED, ACCOUNT_DORMANT). Packages add theirs (network policy, seats, bans…).
 */
export type SessionCheck = (person: PersonRow, session: { userId: string; userAgent?: string | null }, path: string | null) => string | null;
export const SESSION_CHECKS: SessionCheck[] = [
  (p) => (p.status === "pending" ? "ACCOUNT_PENDING" : null),
  (p) => (p.status === "disabled" || p.status === "deleted" ? "ACCOUNT_DISABLED" : null),
  (p) => (p.dormant ? "ACCOUNT_DORMANT" : null),
];

/** What happens after a session is created (audit; later: alerts, two-step marks). */
export type SessionAfter = (person: PersonRow, session: { id: string; userId: string; userAgent?: string | null; ipAddress?: string | null }) => void;
export const SESSION_AFTER: SessionAfter[] = [
  (p, s) => appendAudit({ action: "auth.sign_in", actorId: p.id, via: "session", targetKind: "session", targetId: s.id, ip: s.ipAddress, userAgent: s.userAgent }),
];

/**
 * Endpoints that set a new password, and the body field that holds it. New passwords keep the 8 to 128 rule
 * (§7.2) on every path, Fuobe's own calls included; Better Auth's own limit is the higher sign-in one, so passwords
 * from before accounts (and FUOBE_PASSWORD) still sign in. Packages that load a plugin with its own path add it.
 */
export const NEW_PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
  "/admin/create-user": "password",
  "/admin/set-user-password": "newPassword",
};

/** Better Auth cookies Fuobe renames (and makes __Host- on https). Plugins add theirs (two_factor, passkey…). */
export const AUTH_COOKIES = ["session_token", "session_data", "dont_remember", "account_data"];

// ---------------------------------------------------------------------------
// People

const now = () => Date.now();

/** The Fuobe person for a Better Auth user, or null. */
export function personFor(authUserId: string): PersonRow | null {
  return (db().prepare("SELECT id, role, status, dormant FROM users WHERE auth_user_id = ?").get(authUserId) as PersonRow | undefined) ?? null;
}

/**
 * A Better Auth user without a Fuobe person (a link lost, or a user created with multi_user on before its package
 * links people). Created idempotently, pending, with no memberships, and audited: never active (review 1).
 */
export function ensurePendingPerson(authUserId: string): PersonRow {
  const existing = personFor(authUserId);
  if (existing) return existing;
  const id = `u_${nanoid(12)}`;
  const t = now();
  const made = db()
    .prepare("INSERT OR IGNORE INTO users (id, auth_user_id, role, status, pending_reason, source, created_at, updated_at) VALUES (?, ?, 'member', 'pending', 'unlinked', 'unknown', ?, ?)")
    .run(id, authUserId, t, t);
  if (made.changes) appendAudit({ action: "people.link_pending", targetKind: "user", targetId: id, meta: { reason: "a sign-in account had no Fuobe person" } });
  return personFor(authUserId)!;
}

/** Whether the owner can still be given a sign-in account: none linked, or the linked one is gone. */
export function ownerClaimable(): boolean {
  const row = db()
    .prepare(`SELECT u.auth_user_id AS linked, EXISTS (SELECT 1 FROM "${AUTH_TABLES.user}" a WHERE a.id = u.auth_user_id) AS live FROM users u WHERE u.id = 'u_owner'`)
    .get() as { linked: string | null; live: number } | undefined;
  return !!row && (!row.linked || !row.live);
}

/** Link a new Better Auth user to the Fuobe person its intent names. */
function linkPerson(authUserId: string, intent: string | null): void {
  if (intent === "claim-owner" || intent === "bootstrap-import") {
    db().prepare("UPDATE users SET auth_user_id = ?, updated_at = ? WHERE id = 'u_owner' AND auth_user_id IS NULL").run(authUserId, now());
    return;
  }
  ensurePendingPerson(authUserId);
}

// ---------------------------------------------------------------------------
// The instance

/** The address Better Auth runs at and whether cookies are __Host-: from the site address, else the request. */
export interface AuthSite {
  siteUrl: string | null;
  /** A trusted proxy writes x-fuobe-client-ip; without one IP tracking is off. */
  trustedProxy: boolean;
}

export const currentSite = (): AuthSite => ({ siteUrl: siteUrl(), trustedProxy: !!trustedProxies() });

/** The cookie names this site uses (the proxy checks for one before asking Better Auth). */
export function sessionCookieName(site: AuthSite = currentSite()): string {
  return site.siteUrl?.startsWith("https://") ? "__Host-fuobe.session_token" : "fuobe.session_token";
}

function cookieConfig(secure: boolean): NonNullable<BetterAuthOptions["advanced"]>["cookies"] {
  if (!secure) return undefined;
  return Object.fromEntries(AUTH_COOKIES.map((c) => [c, { name: `__Host-fuobe.${c}`, attributes: { secure: true, path: "/" } }]));
}

/** Origins a browser may post from (§7.1). SSO issuers are never added. */
function trustedOriginsFor(request?: Request): string[] {
  const out = new Set<string>();
  const site = siteUrl();
  if (site) out.add(site);
  for (const entry of (process.env.FUOBE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (entry === "*") continue;
    if (entry.includes("://")) {
      try {
        out.add(new URL(entry).origin);
      } catch {
        // skip
      }
    } else {
      out.add(`https://${entry}`);
      out.add(`http://${entry}`);
    }
  }
  for (const entry of (installValue("access.allowed_hosts") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    out.add(`https://${entry}`);
    out.add(`http://${entry}`);
  }
  // The address the browser used, in Personal only and only when it's one Fuobe may be reached at without a password.
  if (request && installMode() === "personal") {
    const host = request.headers.get("host");
    if (hostAllowed(host)) {
      const url = new URL(request.url);
      out.add(url.origin);
      if (host) out.add(`${url.protocol}//${host}`);
    }
  }
  return [...out];
}

const QUIET = [/Base URL is not set/];

export function buildAuthOptions(site: AuthSite) {
  const secure = !!site.siteUrl?.startsWith("https://");
  return {
    appName: "Fuobe",
    basePath: "/api/identity",
    ...(site.siteUrl && { baseURL: site.siteUrl }),
    secret: deriveKey("better-auth/v1").toString("hex"),
    database: authDatabase(),
    telemetry: { enabled: false },
    logger: {
      // "info", not "warn": at warn Better Auth's router also prints every refused request (each 403 from the
      // allowlist) through its own logger. Warnings and errors still come here, minus the known-harmless ones.
      level: "info" as const,
      log: (level: string, message: string, ...args: unknown[]) => {
        if ((level !== "warn" && level !== "error") || QUIET.some((q) => q.test(message))) return;
        (level === "error" ? console.error : console.warn)(`[identity] ${message}`, ...args);
      },
    },
    trustedOrigins: (request?: Request) => trustedOriginsFor(request),
    user: { modelName: AUTH_TABLES.user },
    account: {
      modelName: AUTH_TABLES.account,
      accountLinking: { trustedProviders: [] as string[], allowDifferentEmails: false },
    },
    session: {
      modelName: AUTH_TABLES.session,
      expiresIn: 30 * 86_400,
      updateAge: 86_400,
      deferSessionRefresh: true,
      freshAge: 600,
      cookieCache: { enabled: false },
    },
    verification: { modelName: AUTH_TABLES.verification, storeIdentifier: "hashed" as const },
    rateLimit: { enabled: true, storage: "database" as const, modelName: AUTH_TABLES.rateLimit },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      // The sign-in limit, not the new-password one: Better Auth checks it before verifying, and a longer password
      // from before accounts must still sign in. New passwords meet PASSWORD_MAX in the before hook.
      maxPasswordLength: PASSWORD_SIGN_IN_MAX,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    advanced: {
      cookiePrefix: "fuobe",
      useSecureCookies: false,
      cookies: cookieConfig(secure),
      ipAddress: { ipAddressHeaders: ["x-fuobe-client-ip"], disableIpTracking: !site.trustedProxy },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            const intent = currentCreateIntent();
            const check = intent ? CREATE_INTENTS.get(intent) : undefined;
            if (check) {
              const code = check();
              if (code) throw new APIError("FORBIDDEN", { message: "This Fuobe's owner already has a sign-in account.", code });
              return;
            }
            if (installValue(INSTALL.multiUser) === "1") return;
            throw new APIError("FORBIDDEN", { message: "New accounts can't be created on this Fuobe.", code: "SIGN_UP_CLOSED" });
          },
          after: async (user: { id: string }) => linkPerson(user.id, currentCreateIntent()),
        },
      },
      session: {
        create: {
          before: async (session: { userId: string; userAgent?: string | null }, ctx: { path?: string } | null) => {
            const person = ensurePendingPerson(session.userId);
            for (const check of SESSION_CHECKS) {
              const code = check(person, session, ctx?.path ?? null);
              if (code) {
                const r = refusal(code);
                throw new APIError("FORBIDDEN", { message: r.message, code });
              }
            }
          },
          after: async (session: { id: string; userId: string; userAgent?: string | null; ipAddress?: string | null }) => {
            const person = personFor(session.userId);
            if (person) for (const fn of SESSION_AFTER) fn(person, session);
          },
        },
      },
    },
    hooks: {
      // New passwords stay within 8 to 128 characters; then the router allowlist.
      before: createAuthMiddleware(async (ctx) => {
        const field = NEW_PASSWORD_FIELDS[ctx.path];
        const next = field && ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>)[field] : undefined;
        if (typeof next === "string" && next.length > PASSWORD_MAX) {
          throw new APIError("BAD_REQUEST", { message: `Use at most ${PASSWORD_MAX} characters.`, code: "PASSWORD_TOO_LONG" });
        }
        // The router allowlist: only browser traffic carries ctx.request; Fuobe's auth.api calls pass.
        if (!ctx.request) return;
        if (!routerAllows(ctx.path)) throw new APIError("FORBIDDEN", { message: "That isn't available on this Fuobe.", code: "ENDPOINT_BLOCKED" });
        if (ctx.path === "/update-user" && ctx.body && typeof ctx.body === "object") {
          const body = ctx.body as Record<string, unknown>;
          // Fuobe's own avatar upload is the only way to set a picture; names stay short.
          delete body.image;
          if (typeof body.name === "string" && body.name.trim().length > 80) throw new APIError("BAD_REQUEST", { message: "Use a name of at most 80 characters.", code: "NAME_TOO_LONG" });
        }
      }),
      // A password that verified in the old auth.json format is rewritten in the current one.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const session = ctx.context.newSession;
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        if (!session || typeof password !== "string") return;
        const account = await ctx.context.internalAdapter.findCredentialAccount(session.user.id);
        if (account?.password && needsRehash(account.password)) {
          await ctx.context.internalAdapter.updatePassword(session.user.id, await hashPassword(password));
          appendAudit({ action: "auth.password_upgraded", actorId: personFor(session.user.id)?.id ?? null, via: "session", targetKind: "user", targetId: personFor(session.user.id)?.id ?? null });
        }
      }),
    },
  } satisfies BetterAuthOptions;
}

export function createFuobeAuth(site: AuthSite = currentSite()) {
  return betterAuth(buildAuthOptions(site));
}

export type FuobeAuth = ReturnType<typeof createFuobeAuth>;

let memo: { key: string; auth: FuobeAuth } | null = null;

/**
 * The Better Auth instance for the current settings, rebuilt when identity.config_version, the site address or
 * the trusted-proxy setting changes (and when a test swaps data folders).
 */
export function getAuth(): FuobeAuth {
  const site = currentSite();
  const key = [DATA_DIR, installValue(INSTALL.configVersion) ?? "0", site.siteUrl ?? "", site.trustedProxy ? "proxy" : "direct"].join("|");
  if (memo?.key !== key) memo = { key, auth: createFuobeAuth(site) };
  return memo.auth;
}
