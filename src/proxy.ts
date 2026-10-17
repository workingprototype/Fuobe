import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, validSession, validToken } from "@/server/auth";

/** Paths that work signed out: the login page and its API. */
const OPEN = new Set(["/login", "/api/auth/login"]);

export function proxy(request: NextRequest) {
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
  // Everything except build assets and the public folder's files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|samples/|.*\\.svg$).*)"],
};
