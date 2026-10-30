import { connection } from "next/server";
import { z } from "zod";
import { checkOwnerPassword, changeOwnerPassword, ownerPasswordStatus, signInOwner } from "@/server/identity/owner";
import { PASSWORD_SIGN_IN_MAX } from "@/server/identity/password";
import { listTokens } from "@/server/identity/tokens";
import { signInRequired } from "@/server/mode";
import { currentActor } from "@/server/access/actor";
import { handler } from "@/server/access/route";

/**
 * Settings → Security in Personal: whether a password is required, and setting, changing or removing it (removing
 * it turns sign-in off: Just me on this computer). Changing it needs the current one and a signed-in browser, signs
 * every other browser out and keeps this one signed in.
 */

const Body = z.object({ current: z.string().max(PASSWORD_SIGN_IN_MAX).optional(), password: z.string().max(PASSWORD_SIGN_IN_MAX).nullable() });

function status() {
  return { enabled: signInRequired(), ...ownerPasswordStatus(), tokens: listTokens(currentActor().userId) };
}

export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json(status());
});

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { current, password } = parsed.data;
  const actor = currentActor();
  if (signInRequired()) {
    if (actor.via !== "session" || actor.role !== "owner") return Response.json({ error: "Change the password from a signed-in browser" }, { status: 403 });
    if (!(await checkOwnerPassword(current ?? ""))) return Response.json({ error: "The current password is wrong" }, { status: 403 });
  } else if (actor.via !== "local") {
    return Response.json({ error: "Set a password from the computer Fuobe runs on" }, { status: 403 });
  }
  try {
    await changeOwnerPassword(password, { actorId: actor.userId, via: actor.via });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (password) {
    // Every browser was signed out; this one signs straight back in with the new password.
    const signedIn = await signInOwner(password, request.headers);
    if (signedIn.ok) for (const c of signedIn.setCookies) headers.append("set-cookie", c);
  }
  headers.append("set-cookie", "fuobe_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return Response.json(status(), { headers });
});
