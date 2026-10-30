import { cookies } from "next/headers";
import { z } from "zod";
import { authEnabled, createSession, LoginGuard, normalizeEmail, publicSignup, recordLogin, SESSION_COOKIE, verifyAccount, verifyPassword } from "@/server/auth";
import { hit } from "@/server/rate";

/** The install password alone (the owner), or an account's email and password (public sign-up). */
const Body = z.object({ password: z.string().min(1).max(500), email: z.string().max(254).optional() });

declare global {
  var __fuobeLoginGuard: LoginGuard | undefined;
  var __fuobeAccountLoginGuard: LoginGuard | undefined;
  var __fuobeEmailLoginGuard: LoginGuard | undefined;
}

/**
 * Three budgets, so one kind of guessing never locks the other out:
 * - the install password (the owner's sign-in): a visitor is locked for a minute after 5 misses, and past 20 misses a
 *   minute from everyone, every try waits a few seconds;
 * - account log-ins, per visitor: locked for a minute after 5 misses;
 * - account log-ins, per email: locked for 15 minutes after 10 misses in 15 minutes, from any number of addresses.
 * Account guessing has no global slowdown: the per-email lock already caps how often one password can be tried.
 */
const ownerGuard = () => (globalThis.__fuobeLoginGuard ??= new LoginGuard());
const accountGuard = () =>
  (globalThis.__fuobeAccountLoginGuard ??= new LoginGuard({ perClient: 5, global: Infinity, windowMs: 60_000, lockMs: 60_000, throttleMs: 4_000, maxClients: 5000 }));
const emailGuard = () =>
  (globalThis.__fuobeEmailLoginGuard ??= new LoginGuard({ perClient: 10, global: Infinity, windowMs: 15 * 60_000, lockMs: 15 * 60_000, throttleMs: 4_000, maxClients: 20_000 }));

/** Every account log-in is counted, a right one too (each one is a slow password check): per visitor, and per email. */
const PER_CLIENT_A_MINUTE = 30;
const PER_EMAIL_A_MINUTE = 10;

function tooMany(waitMs: number, key: string) {
  const secs = Math.max(1, Math.ceil(waitMs / 1000));
  // Without a trusted proxy every visitor shares one limit (the hint is for whoever runs the server).
  const hint = key === LoginGuard.DIRECT ? " Behind a reverse proxy? Set FUOBE_TRUST_PROXY=1 so each visitor gets their own limit." : "";
  return Response.json(
    { error: `Too many sign-in attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}.${hint}` },
    { status: 429, headers: { "Retry-After": String(secs) } },
  );
}

export async function POST(request: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const key = LoginGuard.clientKey(request.headers);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const email = parsed.success ? parsed.data.email?.trim() : undefined;
  let accountId: string | undefined;
  if (email) {
    const emailKey = `email:${normalizeEmail(email) ?? email.toLowerCase()}`;
    const wait = Math.max(accountGuard().blockedFor(key), emailGuard().blockedFor(emailKey));
    if (wait > 0) return tooMany(wait, key);
    // Counted before the password is checked, so a burst can't run more checks than the budget allows.
    const perEmail = hit(`login:${emailKey}`, PER_EMAIL_A_MINUTE, 60_000);
    if (!perEmail.ok) return tooMany(perEmail.retryAfterS * 1000, key);
    // The shared key (no trusted proxy) is every visitor at once: only the per-email budget applies to it.
    const perClient = key === LoginGuard.DIRECT ? { ok: true, retryAfterS: 0 } : hit(`login:${key}`, PER_CLIENT_A_MINUTE, 60_000);
    if (!perClient.ok) return tooMany(perClient.retryAfterS * 1000, key);
    const account = parsed.success && publicSignup(request.headers.get("host")) ? await verifyAccount(email, parsed.data.password) : null;
    if (!account) {
      accountGuard().fail(key);
      emailGuard().fail(emailKey);
      return Response.json({ error: "Wrong email or password" }, { status: 401 });
    }
    if (account.disabled) return Response.json({ error: "This account is switched off. Ask the studio's owner." }, { status: 403 });
    accountGuard().succeed(key);
    emailGuard().succeed(emailKey);
    accountId = account.id;
    recordLogin(account.id);
  } else {
    const wait = ownerGuard().blockedFor(key);
    if (wait > 0) return tooMany(wait, key);
    if (!parsed.success || !(await verifyPassword(parsed.data.password))) {
      ownerGuard().fail(key);
      return Response.json({ error: "Wrong password" }, { status: 401 });
    }
    ownerGuard().succeed(key);
  }
  const s = createSession(accountId);
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}
