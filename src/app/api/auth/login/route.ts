import { cookies } from "next/headers";
import { z } from "zod";
import { authEnabled, checkPassword, createSession, SESSION_COOKIE } from "@/server/auth";

const Body = z.object({ password: z.string().min(1).max(500) });
const failures = new Map<string, { n: number; until: number }>();

export async function POST(request: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return Response.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !checkPassword(parsed.data.password)) {
    const n = (f?.n ?? 0) + 1;
    failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  failures.delete(ip);
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
