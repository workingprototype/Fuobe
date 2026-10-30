import { cookies } from "next/headers";
import { z } from "zod";
import { AccountError, createAccount, createSession, LoginGuard, publicSignup, SESSION_COOKIE } from "@/server/auth";

const Body = z.object({ email: z.string().max(254), password: z.string().max(500) });

declare global {
  var __fuobeSignupGuard: LoginGuard | undefined;
}
/** Every sign-up counts, made or not: a client makes at most 5 a minute, and everyone slows down past 20. */
const guard = (globalThis.__fuobeSignupGuard ??= new LoginGuard());

/** Public sign-up: an account from an email and a password (8+ characters, no verification), signed in at once. */
export async function POST(request: Request) {
  if (!publicSignup(request.headers.get("host"))) return Response.json({ error: "Sign-up is off on this studio" }, { status: 404 });
  const key = LoginGuard.clientKey(request.headers);
  const wait = guard.blockedFor(key);
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    return Response.json({ error: `Too many sign-ups. Try again in ${secs} second${secs === 1 ? "" : "s"}.` }, { status: 429, headers: { "Retry-After": String(secs) } });
  }
  guard.fail(key);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter an email and a password" }, { status: 400 });
  let account;
  try {
    account = createAccount(parsed.data.email, parsed.data.password);
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const s = createSession(account.id);
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true, email: account.email }, { status: 201 });
}
