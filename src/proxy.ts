import { NextResponse, type NextRequest } from "next/server";
import { APPS } from "@/lib/catalog/apps";
import { recordForPath, unknownHubMode } from "@/lib/record-pages";
import { countsAsView, SHARE_VIEW_HEADER, shareRoute } from "@/lib/share";
import { clientIp, crossSite, hostAllowed, LoginGuard } from "@/server/auth";
import { refreshSession, resolvePrincipal } from "@/server/identity/principal";
import { refusal } from "@/server/identity/refusals";
import { signInRequired } from "@/server/mode";
import { recordExists } from "@/server/records";
import { findShare, shareGuard, shareTargetExists } from "@/server/share-access";

/**
 * The perimeter, on every request (docs/research/accounts-8.md §7.1, §5.4). It is optimistic: route handlers
 * authorize for themselves (acc-2). In order: DNS rebinding (sign-in off), cross-site writes, share links, then
 * who is signing in — an API token, Better Auth's session cookie, or "Just me on this computer" (Personal with
 * sign-in off) — and pages for records that don't exist (a real 404).
 *
 * Packages add their public paths to OPEN (setup, sign-in, recovery, invites, webhooks) and the paths that
 * legitimately receive cross-site POSTs to CROSS_SITE_EXEMPT (a SAML assertion consumer, a payment webhook).
 */

/** A path rule: an exact path, or a prefix ending in "/" (every path under it). */
type PathRule = string;
const ruleMatches = (rule: PathRule, pathname: string) => (rule.endsWith("/") ? pathname.startsWith(rule) : pathname === rule);

/** Paths that work signed out (share links are handled on their own, by openShare). */
export const OPEN: PathRule[] = ["/login", "/api/auth/login", "/api/identity/"];

/** Paths whose POSTs come from other sites by design (each one verifies its own signature). */
export const CROSS_SITE_EXEMPT: PathRule[] = [];

/** Sign-in pages and their APIs: never cached by a browser or a proxy. */
export const NO_STORE: PathRule[] = ["/login", "/api/auth/", "/api/identity/"];

const isOpen = (pathname: string) => OPEN.some((r) => ruleMatches(r, pathname));
const crossSiteExempt = (pathname: string) => CROSS_SITE_EXEMPT.some((r) => ruleMatches(r, pathname));
const noStore = (pathname: string) => NO_STORE.some((r) => ruleMatches(r, pathname));

/** The header Better Auth reads the client's address from; only this proxy may write it. */
export const CLIENT_IP_HEADER = "x-fuobe-client-ip";

/**
 * The request headers handed on: any x-fuobe-client-ip a client sent is dropped, and one is written only when a
 * trusted proxy reports the address. Null when nothing changes (the request goes on as it came).
 */
function forwardHeaders(request: NextRequest): Headers | null {
  const ip = clientIp(request.headers);
  if (!ip && !request.headers.has(CLIENT_IP_HEADER)) return null;
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return headers;
}

const next = (headers: Headers | null) => (headers ? NextResponse.next({ request: { headers } }) : NextResponse.next());

const APP_IDS = new Set(APPS.map((a) => a.id));

/**
 * Let the request through — except a page for something that doesn't exist (an unknown app or hub
 * mode, a project / canvas / channel… id that isn't stored), which gets a real 404. The page can't
 * send one itself: the studio's loading.tsx streams the shell (with a 200) before the page knows
 * the id is unknown. (The proxy can't tell a client-side navigation from a page load, so a link to
 * a deleted id reloads into the same 404 page.)
 */
function pass(request: NextRequest, headers: Headers | null): NextResponse {
  const { pathname } = request.nextUrl;
  const app = /^\/apps\/([^/]+)\/?$/.exec(pathname)?.[1];
  if ((app && !APP_IDS.has(safeDecode(app))) || unknownHubMode(pathname)) return notFound(request);
  const record = recordForPath(pathname);
  if (record && !recordExists(record)) return notFound(request);
  return next(headers);
}

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL("/_fuobe-not-found", request.url), { status: 404 });

/** Share pages and their files: never indexed, and the token never leaks to another site in a Referer. */
const SHARE_HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

const tooMany = (seconds: number) =>
  new NextResponse("Too many wrong links. Try again in a minute.", { status: 429, headers: { ...SHARE_HEADERS, "Retry-After": String(seconds) } });

/**
 * A share link (/s/<token>, /s/<token>/f/<file>): open without a session when the token is a live
 * share whose result, folder or project still exists, else a 404 (a "link unavailable" page). A
 * live link always opens: wrong tokens count against ShareGuard, which answers them 429 past its
 * budget and locks out only a client it can tell apart (never everyone, never the signed-in owner).
 * The page and the files route check the token again, and the files route serves only files that
 * page shows. A page view by a visitor (a browser's GET, not a prefetch, a HEAD or a link-preview
 * bot) is passed on to the page as SHARE_VIEW_HEADER, which the page counts.
 */
async function openShare(request: NextRequest, token: string, file: boolean): Promise<NextResponse> {
  const owner = signInRequired() && !!(await resolvePrincipal(request)).actor;
  const guard = shareGuard();
  const key = LoginGuard.clientKey(request.headers);
  if (!owner) {
    const wait = guard.blockedFor(key);
    if (wait > 0) return tooMany(Math.ceil(wait / 1000));
  }
  const row = findShare(token);
  let res: NextResponse;
  if (!row || !shareTargetExists(row)) {
    if (!row && !owner) {
      const spent = guard.saturated();
      guard.miss(key, token, key === LoginGuard.DIRECT);
      if (spent) return tooMany(60);
    }
    res = NextResponse.rewrite(new URL("/s/gone", request.url), { status: 404 });
  } else {
    // Only the proxy says what counts as a view: a visitor can't send the header themselves.
    const headers = forwardHeaders(request) ?? new Headers(request.headers);
    headers.delete(SHARE_VIEW_HEADER);
    if (!file && !owner && countsAsView(request.method, request.headers)) headers.set(SHARE_VIEW_HEADER, "1");
    res = NextResponse.next({ request: { headers } });
  }
  for (const [k, v] of Object.entries(SHARE_HEADERS)) res.headers.set(k, v);
  return res;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function guard(request: NextRequest): Promise<NextResponse> {
  const signIn = signInRequired();
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const { pathname, search } = request.nextUrl;
  // DNS rebinding: a page whose own name now points at this machine. Every method, reads too. With sign-in on
  // the check below already stops it (the session cookie belongs to the real name).
  if (!signIn && !hostAllowed(host)) {
    return NextResponse.json(
      { error: `Blocked a request for ${host}, which isn't a local address. If that's how you reach Fuobe, add it to FUOBE_ALLOWED_ORIGINS (or set a password).` },
      { status: 403 },
    );
  }
  // Before the sign-in check: a password-less install needs this most.
  if (!crossSiteExempt(pathname) && crossSite(request, request.nextUrl.host)) {
    return NextResponse.json({ error: "Blocked a request from another website. Use Fuobe from its own address (or add it to FUOBE_ALLOWED_ORIGINS)." }, { status: 403 });
  }
  // Share links are read-only and public, password or not: exactly a share's page and its files.
  const share = (request.method === "GET" || request.method === "HEAD") && shareRoute(pathname);
  if (share) return openShare(request, share.token, !!share.file);
  const headers = forwardHeaders(request);
  if (!signIn) {
    // Just me on this computer: there is nothing to sign in to.
    if (pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return pass(request, headers);
  }
  if (isOpen(pathname)) return next(headers);
  const principal = await resolvePrincipal(request);
  if (principal.actor) {
    const res = pass(request, headers);
    // Sessions roll forward once a day, on a POST (GET stays read-only).
    if (principal.needsRefresh && !SAFE_METHODS.has(request.method)) for (const c of await refreshSession(request)) res.headers.append("set-cookie", c);
    return res;
  }
  if (pathname.startsWith("/api/")) {
    if (principal.code && principal.code !== "INVALID_TOKEN") {
      const r = refusal(principal.code);
      return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    }
    const error = principal.code === "INVALID_TOKEN" ? "That API token isn't valid. Create a new one in Settings → Security." : "Sign in, or send an API token as Authorization: Bearer fuobe_…";
    return NextResponse.json({ error }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fuobe"' } });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  if (principal.code && principal.code !== "INVALID_TOKEN") login.searchParams.set("code", principal.code);
  return NextResponse.redirect(login);
}

export async function proxy(request: NextRequest) {
  const res = await guard(request);
  if (noStore(request.nextUrl.pathname)) res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Everything except build assets and the public folder's own files: the favicon, the demo
  // samples and the SVGs at the root. Generated SVGs under /api/files stay behind sign-in.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|samples/|[^/]+\\.svg$).*)"],
};
