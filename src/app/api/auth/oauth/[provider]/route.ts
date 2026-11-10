import { cookies } from "next/headers";
import { connection } from "next/server";
import { publicSignup } from "@/server/auth";
import { authorizeUrl, callbackUrl, isOAuthProvider, newState, oauthEnabled, siteOrigin, STATE_COOKIE, STATE_MS, STATE_PATH } from "@/server/oauth";
import { safeNext } from "@/lib/safe-redirect";

/**
 * Continue with Google or GitHub: sends the browser to the provider to sign in, with a new state kept in a short-lived
 * HttpOnly cookie (src/server/oauth.ts). `next`: a path on this site to go to after (anything else goes home); `mode`:
 * "signup" when it came from the sign-up form, so a refusal goes back to it. 404 while the provider isn't set up or
 * public sign-up is off.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/auth/oauth/[provider]">) {
  await connection();
  const { provider } = await ctx.params;
  const client = isOAuthProvider(provider) ? oauthEnabled(provider) : null;
  if (!client || !isOAuthProvider(provider) || !publicSignup(request.headers.get("host"))) {
    return Response.json({ error: "This way of signing in isn't available here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const site = siteOrigin(request);
  const next = safeNext(url.searchParams.get("next"), site);
  const { state, cookie } = newState(provider, next, callbackUrl(site, provider), url.searchParams.get("mode") === "signup" ? "signup" : "login");
  (await cookies()).set(STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: STATE_PATH,
    maxAge: STATE_MS / 1000,
  });
  return new Response(null, { status: 303, headers: { Location: authorizeUrl(state, client.id), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
