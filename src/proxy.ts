import { NextResponse, type NextRequest } from "next/server";
import { APPS } from "@/lib/catalog/apps";
import { recordForPath, unknownHubMode } from "@/lib/record-pages";
import { countsAsView, SHARE_VIEW_HEADER, shareRoute } from "@/lib/share";
import {
  ACCOUNT_LIBRARY_MESSAGE,
  accountGeneration,
  accountMayChange,
  accountOwnRead,
  CONNECT_GPU_HEADER,
  CONNECT_GPU_MESSAGE,
  GUEST_HEADER,
  GUEST_LIBRARY_MESSAGE,
  GUEST_RUN_MESSAGE,
  guestRead,
  isLibraryChange,
  isPriceCheck,
  LIBRARY_MESSAGE,
  OWN_GPU_TOOL_MESSAGE,
  ownerOnly,
  ownGpuRun,
} from "@/lib/guest-access";
import { authEnabled, crossSite, hostAllowed, LoginGuard, publicSignup, sessionCookieOf, sessionViewer, validSession, validToken, type Account, type Viewer } from "@/server/auth";
import { fileAccount, generationAccount } from "@/server/account-library";
import { hit } from "@/server/rate";
import { recordExists } from "@/server/records";
import { findShare, shareGuard, shareTargetExists } from "@/server/share-access";

/**
 * Paths that work signed out: the login page and its API (and share links: openShare). Sign-up and
 * "who am I" answer for themselves whether public sign-up is on.
 */
const OPEN = new Set(["/login", "/api/auth/login", "/api/auth/signup", "/api/auth/me"]);

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

/**
 * A 404 page made here, for a request that reached the server through an HTTPS reverse proxy. Next builds the
 * proxy's request address from its own name for the server ("localhost") and the forwarded protocol, and the address
 * it routes by from the host it listens on (`next start -H 127.0.0.1`): when they differ, a rewrite to the app's own
 * 404 page goes out as a request to another server, which fails over HTTPS and answered 500. Plain HTTP (a local
 * install) keeps the rewrite to the app's own pages.
 */
function plain404(title: string, text: string, home: boolean): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Fuobe</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#111113;--muted:#6b6b73;--btn:#111113;--btn-fg:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--fg:#ededef;--muted:#9a9aa2;--btn:#ededef;--btn-fg:#0b0b0c}}
body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
main{max-width:460px;padding:24px 16px 10vh}h1{margin:0;font-size:30px;line-height:1.2;font-weight:600;text-wrap:balance}
p{margin:10px 0 0;color:var(--muted);text-wrap:pretty}a{display:inline-block;margin-top:22px;padding:9px 16px;border-radius:10px;background:var(--btn);color:var(--btn-fg);text-decoration:none;font-weight:500}
</style></head><body><main><h1>${title}</h1><p>${text}</p>${home ? '<a href="/">Back to Home</a>' : ""}</main></body></html>`;
  return new NextResponse(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const behindHttps = (request: NextRequest) => request.nextUrl.protocol === "https:";

const notFound = (request: NextRequest) =>
  behindHttps(request)
    ? plain404("Nothing here", "The page you’re looking for moved, or never existed. Everything you made is still in your library.", true)
    : NextResponse.rewrite(new URL("/_fuobe-not-found", request.url), { status: 404 });

const shareGone = (request: NextRequest) =>
  behindHttps(request)
    ? plain404("This link isn’t available", "It may have expired or been turned off, or what it shared was removed. Ask the person who sent it for a new link.", false)
    : NextResponse.rewrite(new URL("/s/gone", request.url), { status: 404 });

/** Share pages and their files: never indexed, and the token never leaks to another site in a Referer. */
const SHARE_HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

/** The owner: the install password's session, or an API token. */
const signedIn = (request: NextRequest) => validSession(sessionCookieOf(request)) || validToken(request.headers.get("authorization"));

/** The owner, an account (only while public sign-up is on), or null (a guest). */
function viewerOf(request: NextRequest, open: boolean): Viewer | null {
  const session = sessionViewer(sessionCookieOf(request));
  if (session?.kind === "owner" || validToken(request.headers.get("authorization"))) return { kind: "owner" };
  return open && session?.kind === "account" ? session : null;
}

const guestHeaders = { [GUEST_HEADER]: "1", "Cache-Control": "no-store" };

/** Price checks a guest (per address) or an account may send a minute: free, but each one plans a run. A page sends far fewer. */
const PRICE_CHECKS_PER_MINUTE = 120;

/**
 * Without a trusted proxy (FUOBE_TRUST_PROXY) every guest is one shared key: they share a budget ten times larger, so
 * one busy page or script can't stop every other guest's prices, and the 429 says how to give each visitor their own.
 */
const SHARED_PRICE_CHECKS_PER_MINUTE = 10 * PRICE_CHECKS_PER_MINUTE;
const SHARED_GUEST = `guest:${LoginGuard.DIRECT}`;

/** A guest's or an account's price check, within its budget (the owner's are never counted). */
function priceCheck(request: NextRequest, who: string): NextResponse {
  const shared = who === SHARED_GUEST;
  const r = hit(`price:${who}`, shared ? SHARED_PRICE_CHECKS_PER_MINUTE : PRICE_CHECKS_PER_MINUTE, 60_000);
  if (r.ok) return pass(request);
  const hint = shared ? " Behind a reverse proxy? Set FUOBE_TRUST_PROXY=1 so each visitor gets their own limit." : "";
  return NextResponse.json({ error: `Too many price checks. Try again in a minute.${hint}` }, { status: 429, headers: { "Retry-After": String(r.retryAfterS), "Cache-Control": "no-store" } });
}

/**
 * A guest (public sign-up on, signed out): every page and the catalog reads, the owner's lists
 * empty, the rest of the library 401, and every change 401 (the client offers to sign up).
 */
function guest(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (request.method === "GET" || request.method === "HEAD") return readAsGuest(request, false);
  if (isPriceCheck(request.method, pathname, search)) return priceCheck(request, `guest:${LoginGuard.clientKey(request.headers)}`);
  return NextResponse.json({ error: GUEST_RUN_MESSAGE }, { status: 401, headers: guestHeaders });
}

/**
 * A read by a guest or an account: pages and catalog reads go through, the owner's lists come back
 * empty, and the rest of the owner's library is refused (401 for a guest, who can sign up; 403 for an account).
 */
function readAsGuest(request: NextRequest, isAccount: boolean): NextResponse {
  const read = guestRead(request.nextUrl.pathname);
  if (read.kind === "pass") return pass(request);
  if (read.kind === "filtered") {
    const headers = new Headers(request.headers);
    headers.set(GUEST_HEADER, "1");
    return NextResponse.next({ request: { headers } });
  }
  if (read.kind === "empty") return NextResponse.json(read.body, { headers: guestHeaders });
  if (read.kind === "none") return NextResponse.json({ error: "Not for guests" }, { status: 404, headers: guestHeaders });
  if (isAccount) return NextResponse.json({ error: ACCOUNT_LIBRARY_MESSAGE }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ error: GUEST_LIBRARY_MESSAGE }, { status: 401, headers: guestHeaders });
}

/**
 * An account sees the owner's studio as a guest does: every page, the catalog, and none of the
 * owner's library or projects (hidden, and every change to them refused). Its own runs are its own
 * (accountGeneration, accountOwnRead: only what it made). Install-wide settings, keys and tokens are
 * the owner's, and it never runs on the owner's cloud keys or GPU: with its own ComfyUI connected
 * ("Your GPU") the studios' generations run there, and anything else that would reach a model is
 * refused ("Connect your GPU" until it has one).
 */
const notYours = () => NextResponse.json({ error: ACCOUNT_LIBRARY_MESSAGE }, { status: 403, headers: { "Cache-Control": "no-store" } });

function account(request: NextRequest, who: Account): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (ownerOnly(request.method, pathname)) {
    return NextResponse.json({ error: "Only the studio's owner can change settings, keys and tokens." }, { status: 403 });
  }
  // Its own runs and their files: only what it made.
  const gen = accountGeneration(request.method, pathname);
  if (gen !== undefined) return generationAccount(gen) === who.id ? pass(request) : notYours();
  const file = request.method === "GET" || request.method === "HEAD" ? /^\/api\/files\/(.+)$/.exec(pathname)?.[1] : undefined;
  if (file !== undefined) return fileAccount(safeDecode(file)) === who.id ? pass(request) : notYours();
  if (request.method === "GET" || request.method === "HEAD") return accountOwnRead(pathname) ? pass(request) : readAsGuest(request, true);
  if (isPriceCheck(request.method, pathname, search)) return priceCheck(request, `account:${who.id}`);
  if (accountMayChange(request.method, pathname, search)) return pass(request);
  if (isLibraryChange(request.method, pathname)) return NextResponse.json({ error: LIBRARY_MESSAGE, code: "library" }, { status: 403 });
  if (!who.gpu) return NextResponse.json({ error: CONNECT_GPU_MESSAGE, code: "connect-gpu" }, { status: 403, headers: { [CONNECT_GPU_HEADER]: "1" } });
  if (ownGpuRun(request.method, pathname)) return pass(request);
  return NextResponse.json({ error: OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" }, { status: 403 });
}

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
    res = shareGone(request);
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
  const open = publicSignup(request.headers.get("host") ?? request.nextUrl.host);
  const viewer = viewerOf(request, open);
  if (viewer?.kind === "owner") return pass(request);
  if (viewer?.kind === "account") return account(request, viewer.account);
  if (open) return guest(request);
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in, or send an API token as Authorization: Bearer fuobe_…" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fuobe"' } });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except build assets and the public folder's own files: the favicon and app icons,
  // the demo samples, the preset covers, vendored scripts (the 3D viewer's meshopt decoder) and the
  // SVGs at the root. Generated SVGs under /api/files stay behind sign-in. The routes that take a file in a form
  // (/api/uploads, a Soul finish, a Layers render, a skill upload, an Assist source, an explainer document) make the
  // same checks themselves (src/server/direct-gate.ts): the proxy would hold the whole file in memory first.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico$|apple-icon\\.png$|samples/|previews/|vendor/|api/uploads$|api/generations/[^/]+/finish$|api/layers/renders$|api/assist/skills/upload$|api/assist/projects/[^/]+/sources$|api/explainer/document$|[^/]+\\.svg$).*)",
  ],
};
