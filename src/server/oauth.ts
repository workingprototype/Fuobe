import "server-only";
import crypto from "node:crypto";
import { installMac, normalizeEmail, type OAuthProvider } from "./auth";
import { getSetting } from "./settings";

/**
 * Sign-up and sign-in with Google or GitHub, for public sign-up (docs/public-signup.md "Google and GitHub"). Off unless
 * the install sets a provider's client id and secret (FUOBE_OAUTH_GOOGLE_ID and FUOBE_OAUTH_GOOGLE_SECRET,
 * FUOBE_OAUTH_GITHUB_ID and FUOBE_OAUTH_GITHUB_SECRET), and only while public sign-up is on. The owner's sign-in is the
 * install password, as before. The owner can switch either provider off in Settings → Security (oauthGoogle,
 * oauthGithub in settings.ts) without a restart.
 *
 * The authorization-code flow: the start route sends the browser to the provider with a random `state` (and a PKCE
 * challenge), kept in a short-lived HttpOnly cookie signed with the install's secret; the callback takes the code only
 * when its `state` is that cookie's, swaps it for a token from the server, and reads the user's id and a verified email.
 * Codes, tokens and secrets are never logged or stored: only the provider's user id, to find the account next time.
 */

export type { OAuthProvider };
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "github"];
export const isOAuthProvider = (s: string): s is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(s);

/** The name visitors read. */
export const PROVIDER_NAME: Record<OAuthProvider, string> = { google: "Google", github: "GitHub" };

const ENV: Record<OAuthProvider, { id: string; secret: string }> = {
  google: { id: "FUOBE_OAUTH_GOOGLE_ID", secret: "FUOBE_OAUTH_GOOGLE_SECRET" },
  github: { id: "FUOBE_OAUTH_GITHUB_ID", secret: "FUOBE_OAUTH_GITHUB_SECRET" },
};

/** The install's client id and secret for a provider, or null while either is missing (then it is off). */
export function oauthClient(p: OAuthProvider): { id: string; secret: string } | null {
  const id = process.env[ENV[p].id]?.trim();
  const secret = process.env[ENV[p].secret]?.trim();
  return id && secret ? { id, secret } : null;
}

/** The owner's switch for each provider (Settings → Security), on unless switched off. */
const SWITCH: Record<OAuthProvider, "oauthGoogle" | "oauthGithub"> = { google: "oauthGoogle", github: "oauthGithub" };
const switchedOn = (p: OAuthProvider) => getSetting(SWITCH[p]) !== "off";

/** The client id and secret, while the provider is set up and the owner hasn't switched it off; else null (it is off). */
export const oauthEnabled = (p: OAuthProvider): { id: string; secret: string } | null => (switchedOn(p) ? oauthClient(p) : null);

/** The providers that are on (public sign-up decides whether they show). */
export const oauthProviders = (): OAuthProvider[] => OAUTH_PROVIDERS.filter((p) => oauthEnabled(p));

/** For the owner's Settings: each provider, whether its id and secret are set, and its switch. */
export const oauthStatus = () => OAUTH_PROVIDERS.map((p) => ({ provider: p, configured: !!oauthClient(p), on: switchedOn(p) }));

const ENDPOINTS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    user: "https://api.github.com/user",
    emails: "https://api.github.com/user/emails",
    scope: "user:email",
  },
} as const;

/**
 * This studio's own address, as the browser reached it (behind a reverse proxy: the forwarded host and scheme). The
 * callback address is made from it, and the provider sends the browser only to an address its app has registered, so a
 * made-up Host header can't send a code anywhere else.
 */
export function siteOrigin(request: Request): string {
  const u = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || u.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() || u.protocol.replace(":", "");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** The provider's callback on this studio: the address to register with the provider. */
export const callbackUrl = (site: string, p: OAuthProvider) => `${site}/api/auth/oauth/${p}/callback`;

/** Why a provider sign-in came back to the login page (`?oauth_error=`): the page says it in plain words. */
export type OAuthErrorCode = "expired" | "cancelled" | "failed" | "unverified" | "disabled" | "busy";

// ---------------------------------------------------------------------------
// The state cookie

export const STATE_COOKIE = "fuobe_oauth";
/** Only the provider routes read it. */
export const STATE_PATH = "/api/auth/oauth";
/** Time to sign in at the provider. */
export const STATE_MS = 10 * 60_000;

/** Which form the visitor came from: a refusal goes back to it. */
export type OAuthMode = "signup" | "login";

export interface OAuthState {
  provider: OAuthProvider;
  /** Sent to the provider and back: must match. */
  state: string;
  /** The PKCE verifier (its SHA-256 went to the provider). */
  verifier: string;
  /** Where to go after: a path on this site. */
  next: string;
  /** The callback address sent at the start, which the token request must repeat. */
  redirectUri: string;
  mode: OAuthMode;
  /** When the cookie stops counting. */
  exp: number;
}

const b64 = (b: Buffer) => b.toString("base64url");

/** A new sign-in at the provider: its state, verifier and the cookie that keeps them. */
export function newState(provider: OAuthProvider, next: string, redirectUri: string, mode: OAuthMode, now = Date.now()): { state: OAuthState; cookie: string } {
  const state: OAuthState = { provider, state: b64(crypto.randomBytes(24)), verifier: b64(crypto.randomBytes(32)), next, redirectUri, mode, exp: now + STATE_MS };
  const body = b64(Buffer.from(JSON.stringify(state)));
  return { state, cookie: `${body}.${installMac("oauth-state", body)}` };
}

/** The state a cookie holds when this server signed it and it hasn't run out, else null. */
export function readState(cookie: string | undefined, now = Date.now()): OAuthState | null {
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const mac = Buffer.from(cookie.slice(dot + 1));
  const want = Buffer.from(installMac("oauth-state", body));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (!isOAuthProvider(s.provider) || typeof s.state !== "string" || typeof s.verifier !== "string" || typeof s.next !== "string" || typeof s.redirectUri !== "string") return null;
    if (typeof s.exp !== "number" || s.exp < now) return null;
    return { ...s, mode: s.mode === "signup" ? "signup" : "login" };
  } catch {
    return null;
  }
}

/** The state cookie from a Cookie header (one only: two mean none). */
export function stateCookieFrom(header: string | null | undefined): string | undefined {
  let found: string | undefined;
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0 || part.slice(0, eq).trim() !== STATE_COOKIE) continue;
    if (found !== undefined) return undefined;
    found = part.slice(eq + 1).trim();
  }
  return found && /^[\w.-]+$/.test(found) ? found : undefined;
}

/** The `state` the provider sent back is the cookie's (compared in constant time). */
export function sameState(a: string | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Where the browser goes to sign in at the provider. */
export function authorizeUrl(s: OAuthState, clientId: string): string {
  const e = ENDPOINTS[s.provider];
  const u = new URL(e.authorize);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", s.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", e.scope);
  u.searchParams.set("state", s.state);
  u.searchParams.set("code_challenge", b64(crypto.createHash("sha256").update(s.verifier).digest()));
  u.searchParams.set("code_challenge_method", "S256");
  if (s.provider === "google") u.searchParams.set("prompt", "select_account");
  else u.searchParams.set("allow_signup", "true");
  return u.toString();
}

// ---------------------------------------------------------------------------
// The provider's answer

/** Who signed in at the provider: its own user id, and a verified email (or why there is none). */
export type OAuthIdentity = { ok: true; provider: OAuthProvider; subject: string; email: string } | { ok: false; reason: "unverified" | "failed" };

const TIMEOUT_MS = 10_000;

/** A provider call that failed: its status only (never its body, which can hold a token or a code). */
class ProviderError extends Error {}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store" });
  if (!res.ok) throw new ProviderError(`${new URL(url).host}${new URL(url).pathname} answered ${res.status}`);
  return res.json();
}

/** Swap the code for an access token at the provider, from this server, with the install's secret and the PKCE verifier. */
async function accessToken(s: OAuthState, code: string, client: { id: string; secret: string }): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: s.redirectUri,
    client_id: client.id,
    client_secret: client.secret,
    code_verifier: s.verifier,
  });
  const body = (await call(ENDPOINTS[s.provider].token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  })) as { access_token?: unknown; error?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new ProviderError(`${PROVIDER_NAME[s.provider]} sent no access token${typeof body.error === "string" ? ` (${body.error.slice(0, 40)})` : ""}`);
  return body.access_token;
}

/** Google's userinfo: the user's id (`sub`) and email, taken only when Google says it is verified. */
async function googleIdentity(token: string): Promise<OAuthIdentity> {
  const u = (await call(ENDPOINTS.google.userinfo, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
  };
  if (typeof u.sub !== "string" || !u.sub) throw new ProviderError("Google sent no user id");
  const verified = u.email_verified === true || u.email_verified === "true";
  const email = typeof u.email === "string" ? normalizeEmail(u.email) : null;
  return verified && email ? { ok: true, provider: "google", subject: u.sub, email } : { ok: false, reason: "unverified" };
}

/** GitHub: the user's id, and its primary email when GitHub says it is verified (/user/emails). */
async function githubIdentity(token: string): Promise<OAuthIdentity> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Fuobe", "X-GitHub-Api-Version": "2022-11-28" };
  const user = (await call(ENDPOINTS.github.user, { headers })) as { id?: unknown };
  if ((typeof user.id !== "number" && typeof user.id !== "string") || user.id === "") throw new ProviderError("GitHub sent no user id");
  const emails = (await call(ENDPOINTS.github.emails, { headers })) as unknown;
  const primary = Array.isArray(emails)
    ? (emails as { email?: unknown; primary?: unknown; verified?: unknown }[]).find((e) => e && e.primary === true && e.verified === true && typeof e.email === "string")
    : undefined;
  const email = primary ? normalizeEmail(primary.email as string) : null;
  return email ? { ok: true, provider: "github", subject: String(user.id), email } : { ok: false, reason: "unverified" };
}

/** Who the code is for: the provider's user id and verified email. A failure is logged by its status only. */
export async function identityFor(s: OAuthState, code: string): Promise<OAuthIdentity> {
  const client = oauthEnabled(s.provider);
  if (!client) return { ok: false, reason: "failed" };
  try {
    const token = await accessToken(s, code, client);
    return s.provider === "google" ? await googleIdentity(token) : await githubIdentity(token);
  } catch (e) {
    const why = e instanceof ProviderError ? e.message : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "no answer in time" : "the request failed";
    console.warn(`[auth] ${PROVIDER_NAME[s.provider]} sign-in didn't finish: ${why}`);
    return { ok: false, reason: "failed" };
  }
}
