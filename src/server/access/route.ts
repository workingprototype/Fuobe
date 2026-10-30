import "server-only";
import { CLIENT_IP_HEADER, type Principal, resolvePrincipal } from "../identity/principal";
import { refusal } from "../identity/refusals";
import { withScope, type Actor } from "./actor";
import { auditDenied, auditHidden, auditRefused } from "./audit";
import { AccessError, ForbiddenError, NotFoundError, UnauthenticatedError } from "./errors";
import { can, permissionExists } from "./permissions";
import { pinConflict, WORKSPACE_HEADER } from "./scope";

/**
 * Every route handler goes through handler() (docs/research/accounts-8.md §7.1, §7.3, §7.18): it resolves who is
 * asking (the principal: a token, a session, or Just me on this computer), checks what the route declares, and runs
 * the route inside a request scope, so server code can ask currentActor() and audit() knows who acted. Next 16 rule:
 * the proxy is optimistic; this is where authorization is checked again, for every request.
 *
 *   export const POST = handler({ access: "perm:install.settings" }, async (request) => { … });
 *
 * Access kinds:
 * - "signed-in" (the default): any person — a session, a token, or the local owner.
 * - "browser": a session or the local owner, never an API token (tokens are managed from a browser, §7.10).
 * - "perm:<name>": a person whose install role holds that permission (src/server/access/permissions.ts).
 * - "public": anyone; the route answers for nobody when no one is signed in (sign-in, share files, the identity
 *   router). A known person is still the actor.
 *
 * Token scopes: a bearer token may call a route only when one of its scopes is listed (Full always may). By default
 * reads (GET, HEAD) take any scope, writes take Generate or Admin, and permission routes take Admin.
 *
 * Refusals thrown inside (src/server/access/errors.ts) become their answers: 404, 403, 401, 402 and 403 REAUTH. A route
 * (or a studio's error helper) that catches errors to answer them itself passes these on with rethrowAccess(e). Every
 * 403 is audited as `denied`, including one the route answers itself and a turned-off person's refused credentials;
 * the ones nobody signed in can cause are written at most once a minute per address and route (src/server/access/audit.ts).
 */

export type Access = "public" | "signed-in" | "browser" | `perm:${string}`;
export type TokenScope = "full" | "read" | "generate" | "admin";

export interface HandlerOptions {
  access?: Access;
  /** The token scopes allowed besides Full (see above for the defaults). */
  scopes?: TokenScope[];
}

// ---------------------------------------------------------------------------
// Registries

/**
 * Restricted session kinds (§7.1): a session that may only finish one step — enrolling two-step (`enroll-2fa`),
 * proving it (`verify-2fa`), looking at someone's library (`view-as`), restoring a deleted account
 * (`restore-account`), accepting new terms (`accept-terms`). Each kind's packages register the paths it may reach;
 * anywhere else the session counts as signed out.
 */
const RESTRICTED_KINDS = new Map<string, (pathname: string, method: string) => boolean>();

export function registerRestrictedKind(kind: string, allows: (pathname: string, method: string) => boolean): void {
  RESTRICTED_KINDS.set(kind, allows);
}

export function restrictedAllows(kind: string, pathname: string, method: string): boolean {
  return RESTRICTED_KINDS.get(kind)?.(pathname, method) ?? false;
}

/**
 * The substituteActor seam (§9.5 E5b view-as): given the real actor and the request, a registered substitution
 * returns who the request acts as, or null to leave it. The first that answers wins, and the real person is kept as
 * `impersonatorId` (audit entries name them; permissions and team roles treat the request as read-only). None in the
 * core.
 */
type Substitute = (actor: Actor, request: Request) => Actor | null;
const SUBSTITUTES: Substitute[] = [];

export function registerActorSubstitute(fn: Substitute): void {
  SUBSTITUTES.push(fn);
}

export function substituteActor(actor: Actor, request: Request): Actor {
  for (const fn of SUBSTITUTES) {
    const next = fn(actor, request);
    if (next) return { ...next, impersonatorId: next.impersonatorId ?? actor.userId };
  }
  return actor;
}

// ---------------------------------------------------------------------------
// The wrapper

/** Every route file's handlers, by file, for the route sweep (tests/route-sweep.test.ts). */
const WRAPPED = new WeakSet<object>();
export const isWrapped = (fn: unknown): boolean => typeof fn === "function" && WRAPPED.has(fn);

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedScopes(opts: HandlerOptions, method: string): TokenScope[] {
  if (opts.scopes) return opts.scopes;
  if (opts.access?.startsWith("perm:")) return ["admin"];
  return READS.has(method) ? ["read", "generate", "admin"] : ["generate", "admin"];
}

const json = (status: number, error: string, code?: string, headers?: HeadersInit) => Response.json({ error, ...(code && { code }) }, { status, headers });

/** Nobody (or a refused person) asking for a route that needs someone: the same answers the proxy gives. */
function signedOut(principal: Principal): Response {
  if (principal.code && principal.code !== "INVALID_TOKEN") {
    const r = refusal(principal.code);
    // A pending, turned-off or dormant person's own credentials: a denial, audited under their name.
    if (r.status === 403 && principal.refused) auditRefused(principal.refused.userId, principal.refused.via, r.code ?? principal.code);
    return json(r.status, r.message, r.code);
  }
  const error = principal.code === "INVALID_TOKEN" ? "That API token isn't valid. Create a new one in Settings → Security." : new UnauthenticatedError().message;
  return json(401, error, undefined, { "WWW-Authenticate": 'Bearer realm="fuobe"' });
}

/** Why this actor may not call this route, or null. */
function refusedFor(actor: Actor, opts: HandlerOptions, method: string): ForbiddenError | null {
  const access = opts.access ?? "signed-in";
  if (actor.via === "token" && !actor.scopes.includes("full") && !actor.scopes.some((s) => (allowedScopes(opts, method) as string[]).includes(s))) {
    return new ForbiddenError("This API token's scope doesn't allow that.", "TOKEN_SCOPE");
  }
  if (access === "browser" && actor.via !== "session" && actor.via !== "local") {
    return new ForbiddenError("Do this from a signed-in browser: an API token can't.", "BROWSER_ONLY");
  }
  if (access.startsWith("perm:")) {
    const permission = access.slice(5);
    if (!permissionExists(permission)) throw new Error(`Unknown permission ${permission}`);
    if (!can(actor, permission)) return new ForbiddenError("You don't have access to this. Ask an admin.", "FORBIDDEN");
  }
  return null;
}

/** Turn a thrown refusal into its answer (others are rethrown: a 500, as before). */
function answer(e: unknown): Response {
  if (!(e instanceof AccessError)) throw e;
  if (e instanceof NotFoundError && e.hidden) auditHidden();
  if (e.status === 403) auditDenied(e.code ?? "forbidden", { message: e.message });
  return json(e.status, e.message, e.code);
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * The route's pattern from the params Next matched: `/api/generations/g_123` with `{ id: "g_123" }` is
 * `/api/generations/[id]`, and a catch-all's run of segments is `[...path]`. Rate-limited denials are counted per
 * route, so probing ids or paths doesn't make each one new.
 */
export async function routePattern(pathname: string, ctx: unknown): Promise<string> {
  const raw = ctx && typeof ctx === "object" && "params" in ctx ? (ctx as { params: unknown }).params : undefined;
  const params = raw ? await Promise.resolve(raw).catch(() => null) : null;
  if (!params || typeof params !== "object") return pathname;
  let segs = pathname.split("/");
  for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const n = value.length;
      for (let i = segs.length - n; n && i >= 1; i--) {
        if (value.every((v, j) => decode(segs[i + j]) === String(v))) {
          segs = [...segs.slice(0, i), `[...${name}]`, ...segs.slice(i + n)];
          break;
        }
      }
    } else if (typeof value === "string" && value) {
      segs = segs.map((s) => (s && decode(s) === value ? `[${name}]` : s));
    }
  }
  return segs.join("/");
}

/**
 * Wrap a route handler. The request scope it opens carries the actor (null on a public route answered for nobody), the
 * client's address (only when a trusted proxy reported it) and user agent, the method, the path and the route.
 */
export function handler<Req extends Request = Request, C = unknown>(
  opts: HandlerOptions,
  fn: (request: Req, ctx: C) => Response | Promise<Response>,
): (request: Req, ctx?: C) => Promise<Response> {
  const access = opts.access ?? "signed-in";
  if (access.startsWith("perm:") && !permissionExists(access.slice(5))) throw new Error(`Unknown permission ${access.slice(5)}`);
  // Next always passes the context; a route without params (or a test calling one) may leave it out.
  const wrapped = async (request: Req, ctx?: C): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const principal = await resolvePrincipal(request);
    let actor = principal.actor;
    // A restricted session (finishing two-step, accepting terms…) outside its own routes is signed out.
    if (actor?.restricted && !restrictedAllows(actor.restricted, url.pathname, method)) actor = null;
    if (actor) actor = substituteActor(actor, request);
    const scope = {
      actor,
      ip: request.headers.get(CLIENT_IP_HEADER),
      userAgent: request.headers.get("user-agent"),
      method,
      path: url.pathname,
      route: await routePattern(url.pathname, ctx),
      // The workspace the tab works in (src/server/access/scope.ts): its header, or ?workspace= where no header goes.
      workspace: request.headers.get(WORKSPACE_HEADER) ?? url.searchParams.get("workspace"),
    };
    return withScope(scope, async () => {
      if (!actor && access !== "public") return signedOut(principal);
      if (actor) {
        const refused = refusedFor(actor, opts, method);
        if (refused) return answer(refused);
        // A token pinned to a workspace works there only: asking for another one is refused, not quietly narrowed.
        if (pinConflict(actor, scope.workspace)) return answer(new ForbiddenError("This API token is pinned to another workspace.", "WORKSPACE_PIN"));
      }
      let res: Response;
      try {
        res = await fn(request, ctx as C);
      } catch (e) {
        return answer(e);
      }
      // A 403 the route answered itself (a wrong current password, MCP's Origin check) is a denial too.
      if (res.status === 403) auditDenied("route");
      return res;
    });
  };
  WRAPPED.add(wrapped);
  return wrapped;
}
