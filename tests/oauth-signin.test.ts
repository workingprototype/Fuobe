import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";
import { authDb } from "./helpers/auth-db";
// Route handlers call connection(); outside a request scope it would throw.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
// Route handlers set cookies through cookies() (no request scope in a test): a jar that only records.
const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn(), get: vi.fn() }));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => jar }));
// What the optional billing service would hear (no service is set: the real one sends nothing).
const events = vi.hoisted(() => ({ accountEvent: vi.fn() }));
vi.mock("@/server/billing", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/billing")>()), accountEvent: events.accountEvent }));

const dir = tempDir("fuobe-oauth-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_TRUST_PROXY;
const auth = await import("@/server/auth");
const oauth = await import("@/server/oauth");
const { proxy } = await import("@/proxy");
const start = await import("@/app/api/auth/oauth/[provider]/route");
const callback = await import("@/app/api/auth/oauth/[provider]/callback/route");
const me = await import("@/app/api/auth/me/route");
const { hit } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const { accountFacts } = await import("@/server/billing");
const publicRoute = await import("@/app/api/auth/public/route");

const SITE = "http://localhost:3000";
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) }) as never;

function req(url: string, init: { method?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { host: "localhost:3000", ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`${SITE}${url}`, { method, headers, ...(init.body !== undefined && { body: JSON.stringify(init.body) }) });
}

/** The value the route set for a cookie in this test (the last one). */
const setCookie = (name: string) => jar.set.mock.calls.filter((c) => c[0] === name).at(-1) as [string, string, Record<string, unknown>] | undefined;
const location = (r: Response) => new URL(r.headers.get("location") ?? "", SITE);

/** The provider's answers: a token for the code, then who signed in. */
type Who = { google?: { sub: string; email?: string; email_verified?: unknown }; github?: { id: number; emails: { email: string; primary: boolean; verified: boolean }[] } };
let who: Who = {};
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url === "https://oauth2.googleapis.com/token" || url === "https://github.com/login/oauth/access_token") {
    const form = new URLSearchParams(String(init?.body));
    if (form.get("code") !== "good-code" || !form.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: "provider-token-123", token_type: "Bearer" });
  }
  const bearer = new Headers(init?.headers).get("authorization");
  if (bearer !== "Bearer provider-token-123") return json({ message: "Bad credentials" }, 401);
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") return who.google ? json(who.google) : json({}, 401);
  if (url === "https://api.github.com/user") return who.github ? json({ id: who.github.id, login: "someone" }) : json({}, 401);
  if (url === "https://api.github.com/user/emails") return who.github ? json(who.github.emails) : json([], 401);
  return json({ error: "unexpected" }, 500);
});

/** Start a sign-in and come back from the provider: the callback's answer. */
async function signIn(provider: "google" | "github", opts: { next?: string; mode?: string; code?: string; state?: (s: string) => string; cookie?: (c: string) => string; headers?: Record<string, string> } = {}) {
  const q = new URLSearchParams();
  if (opts.next !== undefined) q.set("next", opts.next);
  if (opts.mode) q.set("mode", opts.mode);
  const began = await start.GET(req(`/api/auth/oauth/${provider}?${q}`, { headers: opts.headers }), ctx(provider));
  expect(began.status).toBe(303);
  const state = new URL(began.headers.get("location")!).searchParams.get("state")!;
  const cookie = setCookie(oauth.STATE_COOKIE)![1];
  jar.set.mockClear();
  const back = new URLSearchParams({ code: opts.code ?? "good-code", state: opts.state ? opts.state(state) : state });
  const c = opts.cookie ? opts.cookie(cookie) : cookie;
  return callback.GET(req(`/api/auth/oauth/${provider}/callback?${back}`, { cookie: `${oauth.STATE_COOKIE}=${c}`, headers: opts.headers }), ctx(provider));
}

const sessionAccount = () => {
  const s = setCookie(auth.SESSION_COOKIE);
  const v = s ? auth.sessionViewer(s[1]) : null;
  return v?.kind === "account" ? v.account : null;
};

beforeAll(() => {
  auth.setPassword("install password");
  vi.stubGlobal("fetch", fetchMock);
});
beforeEach(() => {
  process.env.FUOBE_PUBLIC_SIGNUP = "1";
  process.env.FUOBE_OAUTH_GOOGLE_ID = "google-client";
  process.env.FUOBE_OAUTH_GOOGLE_SECRET = "google-secret-value";
  process.env.FUOBE_OAUTH_GITHUB_ID = "github-client";
  process.env.FUOBE_OAUTH_GITHUB_SECRET = "github-secret-value";
  jar.set.mockClear();
  fetchMock.mockClear();
  events.accountEvent.mockClear();
  who = {};
  // Sign-up's per-minute budget starts again (a test makes several accounts from the one shared address).
  delete (globalThis as Record<string, unknown>).__fuobeSignupGuard;
});
afterEach(() => {
  for (const k of ["FUOBE_PUBLIC_SIGNUP", "FUOBE_OAUTH_GOOGLE_ID", "FUOBE_OAUTH_GOOGLE_SECRET", "FUOBE_OAUTH_GITHUB_ID", "FUOBE_OAUTH_GITHUB_SECRET", "FUOBE_TRUST_PROXY"]) delete process.env[k];
});

describe("switching it on", () => {
  it("is off without a provider's id and secret: both routes answer 404 and the login page offers nothing", async () => {
    delete process.env.FUOBE_OAUTH_GOOGLE_SECRET;
    expect((await start.GET(req("/api/auth/oauth/google"), ctx("google"))).status).toBe(404);
    expect((await callback.GET(req("/api/auth/oauth/google/callback?code=x&state=y"), ctx("google"))).status).toBe(404);
    expect(oauth.oauthProviders()).toEqual(["github"]);
    delete process.env.FUOBE_OAUTH_GITHUB_ID;
    const body = (await (await me.GET(req("/api/auth/me"))).json()) as { oauth?: string[] };
    expect(body.oauth).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a provider it doesn't know, and while public sign-up is off", async () => {
    expect((await start.GET(req("/api/auth/oauth/twitter"), ctx("twitter"))).status).toBe(404);
    process.env.FUOBE_PUBLIC_SIGNUP = "0";
    expect((await start.GET(req("/api/auth/oauth/google"), ctx("google"))).status).toBe(404);
    expect((await callback.GET(req("/api/auth/oauth/github/callback?code=x&state=y"), ctx("github"))).status).toBe(404);
    const body = (await (await me.GET(req("/api/auth/me"))).json()) as { oauth?: string[] };
    expect(body.oauth).toBeUndefined();
  });

  it("lets the owner switch a provider off and on again in Settings, without a restart", async () => {
    setSetting("oauthGoogle", "off");
    try {
      expect(oauth.oauthProviders()).toEqual(["github"]);
      expect((await start.GET(req("/api/auth/oauth/google"), ctx("google"))).status).toBe(404);
      expect((await callback.GET(req("/api/auth/oauth/google/callback?code=x&state=y"), ctx("google"))).status).toBe(404);
      expect((await start.GET(req("/api/auth/oauth/github"), ctx("github"))).status).toBe(303);
      const body = (await (await me.GET(req("/api/auth/me"))).json()) as { oauth?: string[] };
      expect(body.oauth).toEqual(["github"]);
      // The owner's Settings see both: set up, and the switch.
      const status = (await (await publicRoute.GET(req("/api/auth/public"))).json()) as { oauth: unknown };
      expect(status.oauth).toEqual([
        { provider: "google", configured: true, on: false },
        { provider: "github", configured: true, on: true },
      ]);
    } finally {
      setSetting("oauthGoogle", "");
    }
    expect(oauth.oauthProviders()).toEqual(["google", "github"]);
  });

  it("names the providers that are on, while sign-up is open", async () => {
    const body = (await (await me.GET(req("/api/auth/me"))).json()) as { oauth?: string[] };
    expect(body.oauth).toEqual(["google", "github"]);
  });

  it("lets a guest reach the routes through the proxy", () => {
    for (const p of ["/api/auth/oauth/google", "/api/auth/oauth/github/callback?code=x&state=y"]) expect(proxy(req(p)).headers.get("x-middleware-next"), p).toBe("1");
    // Signed out with public sign-up off too: the routes answer for themselves (404).
    process.env.FUOBE_PUBLIC_SIGNUP = "0";
    expect(proxy(req("/api/auth/oauth/google")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the start", () => {
  it("sends the browser to Google with a state, a PKCE challenge and this studio's callback, kept in an HttpOnly cookie", async () => {
    const r = await start.GET(req("/api/auth/oauth/google?next=/apps&mode=signup"), ctx("google"));
    expect(r.status).toBe(303);
    const to = new URL(r.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("client_id")).toBe("google-client");
    expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/oauth/google/callback`);
    expect(to.searchParams.get("scope")).toBe("openid email");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(to.searchParams.get("state")).toMatch(/^[\w-]{32}$/);
    // The secret never leaves the server.
    expect(to.toString()).not.toContain("google-secret-value");
    const [, value, opts] = setCookie(oauth.STATE_COOKIE)!;
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/auth/oauth", maxAge: 600 });
    const saved = oauth.readState(value)!;
    expect(saved).toMatchObject({ provider: "google", state: to.searchParams.get("state"), next: "/apps", mode: "signup" });
    // The verifier is in the cookie only: the provider got its SHA-256.
    expect(to.toString()).not.toContain(saved.verifier);
  });

  it("uses the forwarded host and scheme behind a reverse proxy", async () => {
    const r = await start.GET(req("/api/auth/oauth/github", { headers: { "x-forwarded-host": "studio.example.com", "x-forwarded-proto": "https" } }), ctx("github"));
    const to = new URL(r.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(to.searchParams.get("redirect_uri")).toBe("https://studio.example.com/api/auth/oauth/github/callback");
    expect(to.searchParams.get("scope")).toBe("user:email");
  });

  it("keeps only a path on this site as next", async () => {
    for (const [asked, kept] of [
      ["https://evil.example/x", "/"],
      ["//evil.example", "/"],
      ["/\\evil.example", "/"],
      ["/.//evil.example", "/"],
      ["javascript:alert(1)", "/"],
      ["/shorts?x=1", "/shorts?x=1"],
    ]) {
      jar.set.mockClear();
      await start.GET(req(`/api/auth/oauth/google?next=${encodeURIComponent(asked)}`), ctx("google"));
      expect(oauth.readState(setCookie(oauth.STATE_COOKIE)![1])?.next, asked).toBe(kept);
    }
  });
});

describe("the callback", () => {
  it("refuses a state that isn't this browser's, a missing or changed cookie, and never calls the provider", async () => {
    who.google = { sub: "g-state", email: "state@example.com", email_verified: true };
    for (const r of [
      await signIn("google", { state: () => "someone-elses-state" }),
      await signIn("google", { cookie: () => "" }),
      await signIn("google", { cookie: (c) => c.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")) }),
      // A state for GitHub doesn't count at Google's callback.
      await (async () => {
        await start.GET(req("/api/auth/oauth/github"), ctx("github"));
        const cookie = setCookie(oauth.STATE_COOKIE)![1];
        const state = oauth.readState(cookie)!.state;
        return callback.GET(req(`/api/auth/oauth/google/callback?code=good-code&state=${state}`, { cookie: `${oauth.STATE_COOKIE}=${cookie}` }), ctx("google"));
      })(),
    ]) {
      expect(r.status).toBe(303);
      const to = location(r);
      expect(to.pathname).toBe("/login");
      expect(to.searchParams.get("oauth_error")).toBe("expired");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookie(auth.SESSION_COOKIE)).toBeUndefined();
    expect(auth.accountWithEmail("state@example.com")).toBeUndefined();
  });

  it("refuses a state cookie that ran out", async () => {
    const { state, cookie } = oauth.newState("google", "/", `${SITE}/api/auth/oauth/google/callback`, "login", Date.now() - oauth.STATE_MS - 1000);
    const r = await callback.GET(req(`/api/auth/oauth/google/callback?code=good-code&state=${state.state}`, { cookie: `${oauth.STATE_COOKIE}=${cookie}` }), ctx("google"));
    expect(location(r).searchParams.get("oauth_error")).toBe("expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes back to the form it came from when the visitor cancels at the provider", async () => {
    const r = await signIn("github", { mode: "signup", next: "/apps", code: "" });
    const to = location(r);
    expect(to.searchParams.get("oauth_error")).toBe("failed");
    const began = await start.GET(req("/api/auth/oauth/github?mode=signup&next=/apps"), ctx("github"));
    const state = new URL(began.headers.get("location")!).searchParams.get("state")!;
    const cookie = setCookie(oauth.STATE_COOKIE)![1];
    const cancelled = await callback.GET(req(`/api/auth/oauth/github/callback?error=access_denied&state=${state}`, { cookie: `${oauth.STATE_COOKIE}=${cookie}` }), ctx("github"));
    const back = location(cancelled);
    expect(back.pathname).toBe("/login");
    expect(Object.fromEntries(back.searchParams)).toEqual({ oauth_error: "cancelled", provider: "github", signup: "1", next: "/apps" });
  });

  it("uses each state once: the cookie is cleared on the way back", async () => {
    who.google = { sub: "g-once", email: "once@example.com", email_verified: true };
    await signIn("google");
    expect(setCookie(oauth.STATE_COOKIE)).toEqual([oauth.STATE_COOKIE, "", expect.objectContaining({ maxAge: 0, path: "/api/auth/oauth" })]);
  });

  it("refuses an email Google hasn't verified, and makes no account", async () => {
    who.google = { sub: "g-unverified", email: "unverified@example.com", email_verified: false };
    const r = await signIn("google", { mode: "signup" });
    expect(Object.fromEntries(location(r).searchParams)).toMatchObject({ oauth_error: "unverified", provider: "google", signup: "1" });
    expect(setCookie(auth.SESSION_COOKIE)).toBeUndefined();
    expect(auth.accountWithEmail("unverified@example.com")).toBeUndefined();
    who.google = { sub: "g-no-email" };
    expect(location(await signIn("google")).searchParams.get("oauth_error")).toBe("unverified");
  });

  it("takes only GitHub's primary verified email", async () => {
    who.github = {
      id: 501,
      emails: [
        { email: "primary-unverified@example.com", primary: true, verified: false },
        { email: "other-verified@example.com", primary: false, verified: true },
      ],
    };
    expect(location(await signIn("github")).searchParams.get("oauth_error")).toBe("unverified");
    expect(auth.accountWithEmail("other-verified@example.com")).toBeUndefined();
    who.github.emails[0].verified = true;
    const r = await signIn("github");
    expect(location(r).pathname).not.toBe("/login");
    expect(sessionAccount()?.email).toBe("primary-unverified@example.com");
  });

  it("makes a new account as sign-up does, signed in, linked to the provider, with no password", async () => {
    who.google = { sub: "g-new", email: "New.Person@Example.com", email_verified: true };
    const r = await signIn("google", { mode: "signup", next: "/apps" });
    expect(r.status).toBe(303);
    const to = location(r);
    // A new account goes to the welcome page first, then where it was headed.
    expect(to.origin).toBe(SITE);
    expect(to.pathname).toBe("/connect");
    expect(Object.fromEntries(to.searchParams)).toEqual({ welcome: "1", next: "/apps" });
    const [, , opts] = setCookie(auth.SESSION_COOKIE)!;
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const a = sessionAccount()!;
    expect(a.email).toBe("new.person@example.com");
    expect(authDb().prepare("SELECT provider, subject, made_account FROM auth_oauth_links WHERE account_id = ?").all(a.id)).toEqual([{ provider: "google", subject: "g-new", made_account: 1 }]);
    expect(auth.accountHasPassword(a)).toBe(false);
    // No password logs in to it.
    expect(await auth.verifyAccount("new.person@example.com", "")).toBeNull();
    expect(await auth.verifyAccount("new.person@example.com", "long enough")).toBeNull();
    // The token and the code are never stored.
    expect(JSON.stringify(authDb().prepare("SELECT * FROM auth_oauth_links").all())).not.toContain("provider-token-123");
    // Settings: it can set a password, and names its provider.
    const body = (await (await me.GET(req("/api/auth/me", { cookie: `${auth.SESSION_COOKIE}=${setCookie(auth.SESSION_COOKIE)![1]}` }))).json()) as { account?: unknown };
    expect(body.account).toEqual({ email: "new.person@example.com", providers: ["google"], noPassword: true });
  });

  /** An account whose email is confirmed already (as a provider's sign-in or the billing side would say). */
  const confirmed = (id: string) => authDb().prepare("UPDATE auth_accounts SET extra_json = json_set(COALESCE(extra_json, '{}'), '$.emailVerifiedAt', 1) WHERE id = ?").run(id);

  it("signs in to the account with the same email, and later finds it by the provider's id", async () => {
    const a = auth.createAccount("existing@example.com", "long enough");
    confirmed(a.id);
    who.github = { id: 777, emails: [{ email: "Existing@example.com", primary: true, verified: true }] };
    const r = await signIn("github", { next: "/shorts" });
    expect(location(r).pathname + location(r).search).toBe("/shorts");
    expect(sessionAccount()?.id).toBe(a.id);
    expect(authDb().prepare("SELECT provider, subject, made_account FROM auth_oauth_links WHERE account_id = ?").all(a.id)).toEqual([{ provider: "github", subject: "777", made_account: 0 }]);
    // Its email was confirmed: its password still works, and it still has one.
    expect((await auth.verifyAccount("existing@example.com", "long enough"))?.id).toBe(a.id);
    expect(auth.accountHasPassword(auth.accountById(a.id)!)).toBe(true);
    // The owner changes its email: GitHub's user still signs in to it.
    auth.setAccountEmailAsOwner(a.id, "renamed@example.com");
    jar.set.mockClear();
    await signIn("github");
    expect(sessionAccount()?.id).toBe(a.id);
  });

  it("takes over an account whose email was never confirmed: its password stops working and its other sign-ins end", async () => {
    // Someone signed up with this address and a password before its owner came with Google.
    const a = auth.createAccount("taken-first@example.com", "someone else's");
    const before = auth.createSession(a.id).value;
    expect(auth.sessionViewer(before)?.kind).toBe("account");
    who.google = { sub: "g-real-owner", email: "taken-first@example.com", email_verified: true };
    await signIn("google");
    expect(sessionAccount()?.id).toBe(a.id);
    // The password set before stops working, and the sign-in made with it ends.
    expect(await auth.verifyAccount("taken-first@example.com", "someone else's")).toBeNull();
    expect(auth.sessionViewer(before)).toBeNull();
    // It reads as an account made with Google: no password, its email confirmed, and its owner can set a password.
    const now = auth.accountById(a.id)!;
    expect(auth.accountHasPassword(now)).toBe(false);
    expect(accountFacts(now)).toMatchObject({ emailVerified: true, signIn: "google" });
    // Google's user signs in again (found by its id now): nothing more changes, and that sign-in stays.
    const kept = setCookie(auth.SESSION_COOKIE)![1];
    jar.set.mockClear();
    await signIn("google");
    expect(sessionAccount()?.id).toBe(a.id);
    expect(auth.sessionViewer(kept)?.kind).toBe("account");
  });

  it("keeps a switched-off account out, found by email or by id", async () => {
    const a = auth.createAccount("off@example.com", "long enough");
    auth.setAccountDisabled(a.id, true);
    who.google = { sub: "g-off", email: "off@example.com", email_verified: true };
    const r = await signIn("google");
    expect(location(r).pathname).toBe("/login");
    expect(location(r).searchParams.get("oauth_error")).toBe("disabled");
    expect(setCookie(auth.SESSION_COOKIE)).toBeUndefined();
    // Linked before it was switched off.
    auth.setAccountDisabled(a.id, false);
    await signIn("google");
    expect(sessionAccount()?.id).toBe(a.id);
    auth.setAccountDisabled(a.id, true);
    jar.set.mockClear();
    expect(location(await signIn("google")).searchParams.get("oauth_error")).toBe("disabled");
    expect(setCookie(auth.SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses a code the provider doesn't take, and logs no code, token or secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    who.google = { sub: "g-bad", email: "bad-code@example.com", email_verified: true };
    const r = await signIn("google", { code: "bad-code-xyz" });
    expect(location(r).searchParams.get("oauth_error")).toBe("failed");
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    for (const s of ["bad-code-xyz", "google-secret-value", "provider-token-123"]) expect(logged).not.toContain(s);
    warn.mockRestore();
  });

  it("goes only to a path on this site after signing in, whatever the cookie was made with", async () => {
    who.google = { sub: "g-next", email: "next@example.com", email_verified: true };
    await signIn("google");
    // A state signed by this server with an outside address (it never makes one): still a path on this site.
    const { state, cookie } = oauth.newState("google", "//evil.example/x", `${SITE}/api/auth/oauth/google/callback`, "login");
    const r = await callback.GET(req(`/api/auth/oauth/google/callback?code=good-code&state=${state.state}`, { cookie: `${oauth.STATE_COOKIE}=${cookie}` }), ctx("google"));
    expect(location(r).origin).toBe(SITE);
    expect(location(r).pathname).toBe("/");
  });

  it("counts a new account against sign-up's limits for that address", async () => {
    process.env.FUOBE_TRUST_PROXY = "1";
    const headers = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 20; i++) hit("signup-day:198.51.100.7", 20, 24 * 60 * 60_000);
    who.google = { sub: "g-limit", email: "limit@example.com", email_verified: true };
    expect(location(await signIn("google", { headers })).searchParams.get("oauth_error")).toBe("busy");
    expect(auth.accountWithEmail("limit@example.com")).toBeUndefined();
    // Signing in to an account that is there isn't a sign-up.
    auth.createAccount("limit@example.com", "long enough");
    const r = await signIn("google", { headers });
    expect(location(r).pathname).toBe("/");
    expect(sessionAccount()?.email).toBe("limit@example.com");
  });
});

describe("what the billing service hears", () => {
  it("an account made with Google: created, its email confirmed, signed in with Google", async () => {
    who.google = { sub: "g-facts", email: "facts@example.com", email_verified: true };
    await signIn("google");
    const a = sessionAccount()!;
    expect(accountFacts(a)).toMatchObject({ id: a.id, email: "facts@example.com", emailVerified: true, signIn: "google" });
    expect(events.accountEvent).toHaveBeenCalledTimes(1);
    expect(events.accountEvent).toHaveBeenCalledWith("created", expect.objectContaining({ id: a.id, emailVerified: true, signIn: "google" }));
    // Kept with the account (a later read says the same).
    expect(accountFacts(auth.accountById(a.id)!)).toMatchObject({ emailVerified: true, signIn: "google" });
  });

  it("an account made with GitHub, then signed in again: signed-in, with GitHub", async () => {
    who.github = { id: 9001, emails: [{ email: "gh-facts@example.com", primary: true, verified: true }] };
    await signIn("github");
    const a = sessionAccount()!;
    expect(events.accountEvent).toHaveBeenLastCalledWith("created", expect.objectContaining({ id: a.id, emailVerified: true, signIn: "github" }));
    await signIn("github");
    expect(events.accountEvent).toHaveBeenLastCalledWith("signed-in", expect.objectContaining({ id: a.id, emailVerified: true, signIn: "github" }));
  });

  it("a password account that signs in with a provider: its email counts as confirmed; a password log-in says password again", async () => {
    const a = auth.createAccount("pw-then-google@example.com", "long enough");
    expect(accountFacts(a)).toMatchObject({ emailVerified: false, signIn: "password" });
    // Confirmed before (an unconfirmed one is taken over instead, and loses its password).
    authDb().prepare("UPDATE auth_accounts SET extra_json = json_set(COALESCE(extra_json, '{}'), '$.emailVerifiedAt', 1) WHERE id = ?").run(a.id);
    who.google = { sub: "g-pw", email: "pw-then-google@example.com", email_verified: true };
    await signIn("google");
    expect(events.accountEvent).toHaveBeenLastCalledWith("signed-in", expect.objectContaining({ id: a.id, emailVerified: true, signIn: "google" }));
    const login = await import("@/app/api/auth/login/route");
    const r = await login.POST(req("/api/auth/login", { method: "POST", body: { email: "pw-then-google@example.com", password: "long enough" } }));
    expect(r.status).toBe(200);
    expect(events.accountEvent).toHaveBeenLastCalledWith("signed-in", expect.objectContaining({ id: a.id, emailVerified: true, signIn: "password" }));
    // A new email from the owner isn't confirmed.
    auth.setAccountEmailAsOwner(a.id, "pw-renamed@example.com");
    expect(accountFacts(auth.accountById(a.id)!)).toMatchObject({ emailVerified: false });
  });
});

describe("an account made with a provider", () => {
  async function made(sub: string, email: string) {
    who.google = { sub, email, email_verified: true };
    await signIn("google");
    return { account: sessionAccount()!, cookie: setCookie(auth.SESSION_COOKIE)![1] };
  }

  it("sets its first password after a recent sign-in, without a current one, and logs in with it", async () => {
    const { account, cookie } = await made("g-first", "first@example.com");
    const r = await me.PATCH(req("/api/auth/me", { method: "PATCH", cookie: `${auth.SESSION_COOKIE}=${cookie}`, body: { next: "a new password" } }));
    expect(r.status).toBe(200);
    expect((await auth.verifyAccount("first@example.com", "a new password"))?.id).toBe(account.id);
    expect(auth.accountHasPassword(auth.accountById(account.id)!)).toBe(true);
    // Now it is a password change like any other: the current one first.
    const again = setCookie(auth.SESSION_COOKIE)![1];
    const wrong = await me.PATCH(req("/api/auth/me", { method: "PATCH", cookie: `${auth.SESSION_COOKIE}=${again}`, body: { current: "", next: "another password" } }));
    expect(wrong.status).toBe(403);
  });

  it("asks for a new sign-in with the provider when the session is older than 10 minutes", async () => {
    const { account } = await made("g-old", "old-session@example.com");
    vi.useFakeTimers({ now: Date.now() - 11 * 60_000, toFake: ["Date"] });
    const old = auth.createSession(account.id).value;
    vi.useRealTimers();
    const patch = await me.PATCH(req("/api/auth/me", { method: "PATCH", cookie: `${auth.SESSION_COOKIE}=${old}`, body: { current: "", next: "a new password" } }));
    expect(patch.status).toBe(403);
    expect(await patch.json()).toMatchObject({ code: "sign-in-again", provider: "google" });
    const del = await me.DELETE(req("/api/auth/me", { method: "DELETE", cookie: `${auth.SESSION_COOKIE}=${old}`, body: {} }));
    expect(del.status).toBe(403);
    expect(auth.accountById(account.id)).toBeDefined();
  });

  it("deletes itself after a recent sign-in, with its provider link", async () => {
    const { account, cookie } = await made("g-delete", "delete-me@example.com");
    const r = await me.DELETE(req("/api/auth/me", { method: "DELETE", cookie: `${auth.SESSION_COOKIE}=${cookie}`, body: {} }));
    expect(r.status).toBe(204);
    expect(auth.accountById(account.id)).toBeUndefined();
    expect(authDb().prepare("SELECT COUNT(*) AS n FROM auth_oauth_links WHERE account_id = ?").get(account.id)).toEqual({ n: 0 });
    // The same Google user later makes a new account.
    jar.set.mockClear();
    await signIn("google");
    expect(sessionAccount()?.email).toBe("delete-me@example.com");
    expect(sessionAccount()?.id).not.toBe(account.id);
  });
});
