import { cookies } from "next/headers";
import { z } from "zod";
import { accountEvent, accountFacts } from "@/server/billing";
import { AccountError, createAccount, createSession, LoginGuard, publicSignup, SESSION_COOKIE } from "@/server/auth";
import { beginSignup, signupMade } from "@/server/signup-limits";

const Body = z.object({ email: z.string().max(254), password: z.string().max(500) });

/**
 * Public sign-up: an account from an email and a password (8+ characters, no verification), signed in at once. A request
 * without an email and a password counts for nothing, so it can't slow anyone else down (src/server/signup-limits.ts).
 */
export async function POST(request: Request) {
  if (!publicSignup(request.headers.get("host"))) return Response.json({ error: "Sign-up is closed right now." }, { status: 404 });
  const key = LoginGuard.clientKey(request.headers);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter an email and a password" }, { status: 400 });
  const refused = beginSignup(key);
  if (refused) return Response.json({ error: refused.error }, { status: 429, headers: { "Retry-After": String(refused.retryAfterS) } });
  let account;
  try {
    account = createAccount(parsed.data.email, parsed.data.password);
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  signupMade(key);
  // An optional billing service hears of it (none set: nothing is sent).
  accountEvent("created", accountFacts(account));
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
