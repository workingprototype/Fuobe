import { cookies } from "next/headers";
import { connection } from "next/server";
import { welcomePath } from "@/lib/after-signup";
import { safeNext } from "@/lib/safe-redirect";
import {
  AccountError,
  accountWithEmail,
  createOAuthAccount,
  createSession,
  claimUnconfirmedAccount,
  linkOAuth,
  LoginGuard,
  noteSignIn,
  oauthLinkedAccount,
  publicSignup,
  recordLogin,
  SESSION_COOKIE,
  type Account,
} from "@/server/auth";
import { accountEvent, accountFacts } from "@/server/billing";
import { hostedRunsOn } from "@/server/hosted-switch";
import {
  identityFor,
  isOAuthProvider,
  oauthEnabled,
  readState,
  sameState,
  siteOrigin,
  STATE_COOKIE,
  STATE_PATH,
  stateCookieFrom,
  type OAuthErrorCode,
  type OAuthState,
} from "@/server/oauth";
import { hit } from "@/server/rate";
import { beginSignup, signupMade } from "@/server/signup-limits";

/**
 * Provider callbacks a minute (each one calls the provider from this server): per visitor behind a trusted proxy, and
 * for everyone together without one.
 */
const PER_CLIENT_A_MINUTE = 30;
const SHARED_A_MINUTE = 300;

/**
 * The provider sends the browser back here after its sign-in. The code counts only with the state this browser's cookie
 * holds (a code meant for another browser, or a link someone sent, signs nobody in). The account is found by the
 * provider's user id, then by its verified email; with neither, one is made as sign-up makes one (the same limits). A
 * switched-off account stays out. Then the session cookie is set as a log-in sets it, and the browser goes on to `next`
 * (a new account first to the welcome page). Anything that doesn't work goes back to the login page, which says why.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/auth/oauth/[provider]/callback">) {
  await connection();
  const { provider } = await ctx.params;
  if (!isOAuthProvider(provider) || !oauthEnabled(provider) || !publicSignup(request.headers.get("host"))) {
    return Response.json({ error: "This way of signing in isn't available here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const site = siteOrigin(request);
  const secure = url.protocol === "https:";
  const jar = await cookies();
  const saved = readState(stateCookieFrom(request.headers.get("cookie")));
  // A state counts once.
  jar.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: STATE_PATH, maxAge: 0 });
  const go = (path: string) => new Response(null, { status: 303, headers: { Location: `${site}${path}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  const back = (code: OAuthErrorCode) => go(loginPath(code, provider, saved));

  if (!saved || saved.provider !== provider || !sameState(url.searchParams.get("state"), saved.state)) return back("expired");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) return back("failed");
  const key = LoginGuard.clientKey(request.headers);
  const rate = key === LoginGuard.DIRECT ? hit("oauth:shared", SHARED_A_MINUTE, 60_000) : hit(`oauth:${key}`, PER_CLIENT_A_MINUTE, 60_000);
  if (!rate.ok) return back("busy");

  const who = await identityFor(saved, code);
  if (!who.ok) return back(who.reason);
  // Public sign-up may have been switched off while the visitor was at the provider.
  if (!publicSignup(request.headers.get("host"))) return back("failed");

  const linked = oauthLinkedAccount(provider, who.subject);
  let account: Account | undefined = linked ?? accountWithEmail(who.email);
  let made = false;
  if (!account) {
    const refused = beginSignup(key);
    if (refused) return back("busy");
    try {
      account = createOAuthAccount(who.email, provider, who.subject);
      made = true;
      signupMade(key);
    } catch (e) {
      // Made a moment ago by another request with the same email: that account is this one's.
      if (!(e instanceof AccountError) || e.status !== 409) throw e;
      account = accountWithEmail(who.email);
      if (!account) return back("failed");
    }
  }
  if (account.disabled) return back("disabled");
  if (made) {
    // An optional billing service hears of it (none set: nothing is sent).
    accountEvent("created", accountFacts(account));
  } else {
    // Found by its email, never confirmed: the provider's verified user takes it over, and a password someone else may
    // have set stops working (claimUnconfirmedAccount).
    if (!linked) account = claimUnconfirmedAccount(account, provider, who.subject);
    linkOAuth(account.id, provider, who.subject);
    recordLogin(account.id);
    // Signed in with the provider, whose email is verified: the account's email counts as confirmed from now on.
    account = noteSignIn(account, provider);
    accountEvent("signed-in", accountFacts(account));
  }
  const s = createSession(account.id);
  jar.set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: s.maxAge });
  const after = safeNext(saved.next, site);
  // With hosted runs on, a GPU of its own is optional: straight back to where it was.
  return go(made && !hostedRunsOn() ? welcomePath(after, site) : after);
}

/** The form the visitor came from, with why it came back, and where it was headed. */
function loginPath(code: OAuthErrorCode, provider: string, saved: OAuthState | null): string {
  const q = new URLSearchParams({ oauth_error: code, provider });
  if (saved?.mode === "signup") q.set("signup", "1");
  if (saved && saved.next !== "/") q.set("next", saved.next);
  return `/login?${q}`;
}
