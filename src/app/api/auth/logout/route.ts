import { appendAudit } from "@/server/identity/audit-log";
import { signOut } from "@/server/identity/owner";
import { resolvePrincipal } from "@/server/identity/principal";

/** Sign out: Better Auth deletes the session (so the cookie is dead everywhere) and expires the cookie. */
export async function POST(request: Request) {
  const { actor } = await resolvePrincipal(request);
  const cookies = await signOut(request.headers);
  if (actor?.via === "session") appendAudit({ action: "auth.sign_out", actorId: actor.userId, via: "session", targetKind: "session", targetId: actor.sessionId ?? null });
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  headers.append("set-cookie", "fuobe_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return Response.json({ ok: true }, { headers });
}
