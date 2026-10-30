import { signOut } from "@/server/identity/owner";
import { maybeActor } from "@/server/access/actor";
import { audit } from "@/server/access/audit";
import { handler } from "@/server/access/route";

/** Sign out: Better Auth deletes the session (so the cookie is dead everywhere) and expires the cookie. */
export const POST = handler({ access: "public" }, async (request: Request) => {
  const actor = maybeActor();
  const cookies = await signOut(request.headers);
  if (actor?.via === "session") audit("auth.sign_out", { kind: "session", id: actor.sessionId ?? null });
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  headers.append("set-cookie", "fuobe_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return Response.json({ ok: true }, { headers });
});
