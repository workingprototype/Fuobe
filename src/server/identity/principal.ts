import "server-only";
import { hostAllowed } from "../auth";
import { db } from "../db";
import { installMode, signInOn } from "../mode";
import { ensurePendingPerson, getAuth, sessionCookieName } from "./auth";
import { tokenFromHeader } from "./tokens";

/**
 * Who is making a request (docs/research/accounts-8.md §7.1), memoised per request:
 *
 * 1. `Authorization: Bearer fuobe_…` → api_tokens. An invalid bearer is 401, except in Just me, where it is
 *    ignored (a valid one still names its owner).
 * 2. The Better Auth session cookie → auth.api.getSession → the Fuobe person. A missing link is created pending.
 *    A person who is pending, turned off or dormant gets no actor, only the refusal code.
 * 3. Just me (Personal, sign-in off, a local address) → the owner, via `local`.
 * 4. Otherwise nobody.
 *
 * The proxy uses it optimistically; route handlers that need a person ask again (acc-2 puts an actor on every
 * route).
 */

export type ActorVia = "session" | "token" | "local" | "system" | "runner" | "scim";

export interface Actor {
  userId: string;
  role: string;
  via: ActorVia;
  sessionId?: string;
  tokenId?: string;
  scopes: string[];
  workspacePin?: string | null;
  /** A restricted session kind (enroll-2fa, verify-2fa, view-as, restore-account, accept-terms): only its routes. */
  restricted?: string;
  impersonatorId?: string;
}

export interface Principal {
  actor: Actor | null;
  /** Why there is no actor: INVALID_TOKEN (401), or a refusal code (ACCOUNT_PENDING…). */
  code?: string;
  /** The session is due for its daily refresh, which only a POST performs (deferSessionRefresh). */
  needsRefresh?: boolean;
}

/**
 * Restricted session kinds and the routes each may reach (packages add theirs: two-step enrolment, view-as…). A
 * restricted actor outside its routes is treated as signed out.
 */
export const RESTRICTED_KINDS = new Map<string, (pathname: string) => boolean>();

interface PersonRow {
  id: string;
  role: string;
  status: string;
  dormant: number;
}

const person = (id: string) => db().prepare("SELECT id, role, status, dormant FROM users WHERE id = ?").get(id) as PersonRow | undefined;

/** Why an existing person may not act right now, or null. */
function blocked(p: PersonRow): string | null {
  if (p.status === "pending") return "ACCOUNT_PENDING";
  if (p.status === "disabled" || p.status === "deleted") return "ACCOUNT_DISABLED";
  if (p.dormant) return "ACCOUNT_DORMANT";
  return null;
}

/** Just me on this computer: Personal with sign-in off, reached at an address that can't be rebound. */
export function justMe(request: Request): boolean {
  return installMode() === "personal" && !signInOn() && hostAllowed(request.headers.get("host"));
}

/** Whether the request carries Better Auth's session cookie (checked before asking Better Auth anything). */
export function hasSessionCookie(request: Request): boolean {
  const name = sessionCookieName();
  return (request.headers.get("cookie") ?? "").split(";").some((c) => c.trim().startsWith(`${name}=`));
}

const LOCAL: Actor = { userId: "u_owner", role: "owner", via: "local", scopes: ["full"] };

async function resolve(request: Request): Promise<Principal> {
  const local = justMe(request);
  const bearer = tokenFromHeader(request.headers.get("authorization"));
  if (bearer === "invalid") {
    if (!local) return { actor: null, code: "INVALID_TOKEN" };
  } else if (bearer !== "missing") {
    const p = person(bearer.userId);
    if (!p) return { actor: null, code: "INVALID_TOKEN" };
    const code = blocked(p);
    if (code) return { actor: null, code };
    return { actor: { userId: p.id, role: p.role, via: "token", tokenId: bearer.tokenId, scopes: bearer.scopes, workspacePin: bearer.workspacePin } };
  }
  if (hasSessionCookie(request)) {
    const found = await getAuth()
      .api.getSession({ headers: request.headers })
      .catch(() => null);
    if (found) {
      const p = ensurePendingPerson(found.user.id);
      const code = blocked(p);
      if (code) return { actor: null, code };
      return {
        actor: { userId: p.id, role: p.role, via: "session", sessionId: found.session.id, scopes: ["full"] },
        needsRefresh: !!(found as { needsRefresh?: boolean }).needsRefresh,
      };
    }
  }
  if (local) return { actor: LOCAL };
  return { actor: null };
}

const memo = new WeakMap<Request, Promise<Principal>>();

export function resolvePrincipal(request: Request): Promise<Principal> {
  let p = memo.get(request);
  if (!p) {
    p = resolve(request);
    memo.set(request, p);
  }
  return p;
}

/** Act as someone else for this request (view-as, §9.5 E5b). The real actor is kept as the impersonator. */
export function substituteActor(actor: Actor, request: Request): void {
  const real = memo.get(request);
  memo.set(
    request,
    (real ?? Promise.resolve({ actor: null } as Principal)).then((r) => ({ actor: { ...actor, impersonatorId: r.actor?.userId ?? actor.impersonatorId } })),
  );
}

/**
 * Refresh a session that is due (once a day), on a POST: Better Auth extends it and sends the cookie again. Returns
 * the Set-Cookie headers to add to the response (none when nothing was due or it failed).
 */
export async function refreshSession(request: Request): Promise<string[]> {
  try {
    const { headers } = await getAuth().api.getSession({ headers: request.headers, method: "POST", returnHeaders: true });
    return headers?.getSetCookie() ?? [];
  } catch {
    return [];
  }
}
