import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, crossSite, hostAllowed, SESSION_COOKIE, validSession, validToken } from "@/server/auth";

/** Paths that work signed out: the login page and its API. */
const OPEN = new Set(["/login", "/api/auth/login"]);

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
  if (!authEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (OPEN.has(pathname)) return NextResponse.next();
  if (validSession(request.cookies.get(SESSION_COOKIE)?.value) || validToken(request.headers.get("authorization"))) return NextResponse.next();
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
