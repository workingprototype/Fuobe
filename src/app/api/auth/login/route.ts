import { cookies } from "next/headers";
import { z } from "zod";
import { authEnabled, checkPassword, createSession, LoginGuard, SESSION_COOKIE } from "@/server/auth";

const Body = z.object({ password: z.string().min(1).max(500) });

declare global {
  var __fuobeLoginGuard: LoginGuard | undefined;
}
const guard = (globalThis.__fuobeLoginGuard ??= new LoginGuard());

export async function POST(request: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const key = LoginGuard.clientKey(request.headers);
  const wait = guard.blockedFor(key);
  if (wait > 0) {
    return Response.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !checkPassword(parsed.data.password)) {
    guard.fail(key);
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  guard.succeed(key);
  const s = createSession();
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}
