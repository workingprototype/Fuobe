import { NextResponse, type NextRequest } from "next/server";
import { APPS } from "@/lib/catalog/apps";
import { recordForPath, unknownHubMode } from "@/lib/record-pages";
import { countsAsView, SHARE_VIEW_HEADER, shareRoute } from "@/lib/share";
import { authEnabled, crossSite, hostAllowed, LoginGuard, SESSION_COOKIE, validSession, validToken } from "@/server/auth";
import { recordExists } from "@/server/records";
import { findShare, shareGuard, shareTargetExists } from "@/server/share-access";

/** Paths that work signed out: the login page and its API (and share links: openShare). */
const OPEN = new Set(["/login", "/api/auth/login"]);

const APP_IDS = new Set(APPS.map((a) => a.id));

/**
 * Let the request through — except a page for something that doesn't exist (an unknown app or hub
 * mode, a project / canvas / channel… id that isn't stored), which gets a real 404. The page can't
 * send one itself: the studio's loading.tsx streams the shell (with a 200) before the page knows
 * the id is unknown. (The proxy can't tell a client-side navigation from a page load, so a link to
 * a deleted id reloads into the same 404 page.)
 */
function pass(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const app = /^\/apps\/([^/]+)\/?$/.exec(pathname)?.[1];
  if ((app && !APP_IDS.has(safeDecode(app))) || unknownHubMode(pathname)) return notFound(request);
  const record = recordForPath(pathname);
  if (record && !recordExists(record)) return notFound(request);
  return NextResponse.next();
}

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL("/_fuobe-not-found", request.url), { status: 404 });

/** Share pages and their files: never indexed, and the token never leaks to another site in a Referer. */
const SHARE_HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

const signedIn = (request: NextRequest) => validSession(request.cookies.get(SESSION_COOKIE)?.value) || validToken(request.headers.get("authorization"));

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
function openShare(request: NextRequest, token: string, file: boolean): NextResponse {
  const owner = authEnabled() && signedIn(request);
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
    const headers = new Headers(request.headers);
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

export function proxy(request: NextRequest) {
  // DNS rebinding: a page whose own name now points at this machine. Every method, reads too. With a
  // password set the sign-in check below already stops it (the session cookie belongs to the real name).
  if (!authEnabled() && !hostAllowed(request.headers.get("host") ?? request.nextUrl.host)) {
    const host = request.headers.get("host") ?? request.nextUrl.host;
    return NextResponse.json(
      { error: `Blocked a request for ${host}, which isn't a local address. If that's how you reach Fuobe, add it to FUOBE_ALLOWED_ORIGINS (or set a password).` },
      { status: 403 },
    );
  }
  // Before the sign-in check: a password-less install needs this most.
  if (crossSite(request, request.nextUrl.host)) {
    return NextResponse.json({ error: "Blocked a request from another website. Use Fuobe from its own address (or add it to FUOBE_ALLOWED_ORIGINS)." }, { status: 403 });
  }
  const { pathname, search } = request.nextUrl;
  // Share links are read-only and public, password or not: exactly a share's page and its files.
  const share = (request.method === "GET" || request.method === "HEAD") && shareRoute(pathname);
  if (share) return openShare(request, share.token, !!share.file);
  if (!authEnabled()) return pass(request);
  if (OPEN.has(pathname)) return NextResponse.next();
  if (signedIn(request)) return pass(request);
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in, or send an API token as Authorization: Bearer fuobe_…" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fuobe"' } });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except build assets and the public folder's own files: the favicon, the demo
  // samples and the SVGs at the root. Generated SVGs under /api/files stay behind sign-in.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|samples/|[^/]+\\.svg$).*)"],
};
