import "server-only";
import { NextRequest } from "next/server";
import { GUEST_HEADER, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { proxy } from "@/proxy";
import { authEnabled, crossSite, hostAllowed, publicSignup, requestViewer, type Account } from "./auth";

/**
 * The proxy's checks, for a route the proxy doesn't run on (src/proxy.ts config.matcher leaves /api/uploads out, so a
 * large upload streams to the route instead of being held in the proxy's memory). In the proxy's order: a host this
 * install answers (without a password), a request from this site, then who is asking. Returns the viewer, or the
 * answer the proxy would have given.
 */
/**
 * The proxy's whole answer, for a route the proxy's matcher leaves out because it takes a file in a form (src/proxy.ts
 * config): the proxy runs here on the request's address, method and headers (never its body), so every rule it has
 * applies, the same way. Null when the proxy would let the request through; else its answer.
 */
export function gateAsProxy(request: Request): Response | null {
  const res = proxy(new NextRequest(request.url, { method: request.method, headers: request.headers }));
  return res.headers.get("x-middleware-next") === "1" ? null : res;
}

export function gateDirect(request: Request): { kind: "owner" } | { kind: "account"; account: Account } | Response {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  // DNS rebinding: a page whose own name now points at this machine (no password: the sign-in check can't stop it).
  if (!authEnabled() && !hostAllowed(host)) {
    return Response.json(
      { error: `Blocked a request for ${host}, which isn't a local address. If that's how you reach Fuobe, add it to FUOBE_ALLOWED_ORIGINS (or set a password).` },
      { status: 403 },
    );
  }
  if (crossSite(request, url.host)) {
    return Response.json({ error: "Blocked a request from another website. Use Fuobe from its own address (or add it to FUOBE_ALLOWED_ORIGINS)." }, { status: 403 });
  }
  const viewer = requestViewer(request);
  if (viewer.kind === "owner" || viewer.kind === "account") return viewer;
  if (publicSignup(host)) return Response.json({ error: GUEST_RUN_MESSAGE }, { status: 401, headers: { [GUEST_HEADER]: "1", "Cache-Control": "no-store" } });
  return Response.json({ error: "Sign in, or send an API token as Authorization: Bearer fuobe_…" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fuobe"' } });
}
