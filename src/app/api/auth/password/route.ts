import { connection } from "next/server";
import { z } from "zod";
import { checkOwnerPassword, changeOwnerPassword, ownerPasswordStatus, signInOwner } from "@/server/identity/owner";
import { PASSWORD_SIGN_IN_MAX } from "@/server/identity/password";
import { resolvePrincipal } from "@/server/identity/principal";
import { listTokens } from "@/server/identity/tokens";
import { signInRequired } from "@/server/mode";

/**
 * Settings → Security in Personal: whether a password is required, and setting, changing or removing it (removing
 * it turns sign-in off: Just me on this computer). Changing it needs the current one and a signed-in browser, signs
 * every other browser out and keeps this one signed in.
 */

const Body = z.object({ current: z.string().max(PASSWORD_SIGN_IN_MAX).optional(), password: z.string().max(PASSWORD_SIGN_IN_MAX).nullable() });

async function status(request: Request) {
  const { actor } = await resolvePrincipal(request);
  return { enabled: signInRequired(), ...ownerPasswordStatus(), tokens: actor ? listTokens(actor.userId) : [] };
}

export async function GET(request: Request) {
  await connection();
  return Response.json(await status(request));
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { current, password } = parsed.data;
  const { actor } = await resolvePrincipal(request);
  if (signInRequired()) {
    if (actor?.via !== "session" || actor.role !== "owner") return Response.json({ error: "Change the password from a signed-in browser" }, { status: 403 });
    if (!(await checkOwnerPassword(current ?? ""))) return Response.json({ error: "The current password is wrong" }, { status: 403 });
  } else if (actor?.via !== "local") {
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
  return Response.json(await status(request), { headers });
}
