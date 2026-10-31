import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { accountGpu, authEnabled, publicSignup, SESSION_COOKIE, sessionCookieOf, sessionViewer, validToken, verifyAccount } from "@/server/auth";
import { runnerFacts } from "@/server/computer/tasks";
import { getSetting } from "@/server/settings";
import { removeAccount } from "@/server/account-sweep";
import { hit } from "@/server/rate";

/** Who is looking: the owner, an account, or a guest; and whether sign-up is open. Open to everyone. */
export async function GET(request: Request) {
  await connection();
  const open = publicSignup(request.headers.get("host"));
  const session = sessionViewer(sessionCookieOf(request));
  const owner = !authEnabled() || session?.kind === "owner" || validToken(request.headers.get("authorization"));
  const account = !owner && open && session?.kind === "account" ? session.account : null;
  // Runs go to the ComfyUI on this person's own computer: their Fuobe tab runs them (never for an API token: a script isn't a tab).
  const computer = account ? accountGpu(account.id)?.mode === "computer" : owner && !validToken(request.headers.get("authorization")) && getSetting("comfyWhere") === "computer";
  // Where that computer's tab last found ComfyUI (another browser of theirs starts looking there).
  const comfyPort = computer ? runnerFacts(account ? `acct:${account.id}` : "owner")?.port : undefined;
  return Response.json(
    {
      signedIn: owner || !!account,
      owner,
      publicSignup: open,
      ...(account && { account: { email: account.email } }),
      ...(computer && { computer: true, ...(comfyPort && { comfyPort }) }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * An account deletes itself (its password again, to be sure). Signs it out. Five password checks a minute per account:
 * each is a slow check on purpose.
 */
export async function DELETE(request: Request) {
  const jar = await cookies();
  const session = sessionViewer(sessionCookieOf(request));
  if (session?.kind !== "account") return Response.json({ error: "Sign in to the account you want to delete" }, { status: 403 });
  const parsed = z.object({ password: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Wrong password" }, { status: 403 });
  const rate = hit(`delete-me:${session.account.id}`, 5, 60_000);
  if (!rate.ok) return Response.json({ error: "Too many tries. Wait a minute, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  if (!(await verifyAccount(session.account.email, parsed.data.password))) return Response.json({ error: "Wrong password" }, { status: 403 });
  // Switched off at once, its running jobs stopped (on its own keys), then its runs, files and record go.
  await removeAccount(session.account.id);
  jar.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
