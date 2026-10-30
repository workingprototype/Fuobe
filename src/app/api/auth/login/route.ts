import { z } from "zod";
import { LoginGuard } from "@/server/auth";
import { appendAudit } from "@/server/identity/audit-log";
import { signInOwner, type SignInResult } from "@/server/identity/owner";
import { PASSWORD_SIGN_IN_MAX } from "@/server/identity/password";
import { refusal } from "@/server/identity/refusals";
import { signInRequired } from "@/server/mode";
import { handler } from "@/server/access/route";

/**
 * Personal sign-in (docs/research/accounts-8.md §8): one password field, no email. Signs u_owner in through Better
 * Auth (its session, its cookies, the password upgrade); the page then does a full load, so nothing from before the
 * sign-in stays in memory. Kept at this path so today's page and scripts work unchanged.
 */

const Body = z.object({ password: z.string().min(1).max(PASSWORD_SIGN_IN_MAX) });

declare global {
  var __fuobeLoginGuard: LoginGuard | undefined;
}
const guard = (globalThis.__fuobeLoginGuard ??= new LoginGuard());

/** The pre-accounts session cookie: no longer accepted, cleared on the next sign-in or sign-out. */
const LEGACY_SESSION_COOKIE = "fuobe_session";

export const POST = handler({ access: "public" }, async (request: Request) => {
  if (!signInRequired()) return Response.json({ ok: true });
  const key = LoginGuard.clientKey(request.headers);
  const wait = guard.blockedFor(key);
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    // Without a trusted proxy every visitor shares one limit (the hint is for whoever runs the server).
    const hint = key === LoginGuard.DIRECT ? " Behind a reverse proxy? Set FUOBE_TRUSTED_PROXIES=1 so each visitor gets their own limit." : "";
    return Response.json(
      { error: `Too many wrong passwords. Try again in ${secs} second${secs === 1 ? "" : "s"}.${hint}` },
      { status: 429, headers: { "Retry-After": String(secs) } },
    );
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const result: SignInResult = parsed.success ? await signInOwner(parsed.data.password, request.headers) : { ok: false };
  if (!result.ok) {
    if (result.code) {
      const r = refusal(result.code);
      return Response.json({ error: r.message, code: r.code }, { status: r.status });
    }
    guard.fail(key);
    appendAudit({ action: "auth.sign_in_failed", via: "session", meta: { method: "password" }, userAgent: request.headers.get("user-agent") });
    return Response.json({ error: "That password isn't right." }, { status: 401 });
  }
  guard.succeed(key);
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const c of result.setCookies) headers.append("set-cookie", c);
  headers.append("set-cookie", `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return Response.json({ ok: true }, { headers });
});
