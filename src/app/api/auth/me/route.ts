import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { authEnabled, checkAccount, deleteAccount, publicSignup, SESSION_COOKIE, sessionViewer, validToken } from "@/server/auth";
import { purgeAccount } from "@/server/account-sweep";

/** Who is looking: the owner, an account, or a guest; and whether sign-up is open. Open to everyone. */
export async function GET(request: Request) {
  await connection();
  const open = publicSignup(request.headers.get("host"));
  const session = sessionViewer((await cookies()).get(SESSION_COOKIE)?.value);
  const owner = !authEnabled() || session?.kind === "owner" || validToken(request.headers.get("authorization"));
  const account = !owner && open && session?.kind === "account" ? session.account : null;
  return Response.json(
    {
      signedIn: owner || !!account,
      owner,
      publicSignup: open,
      ...(account && { account: { email: account.email } }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** An account deletes itself (its password again, to be sure). Signs it out. */
export async function DELETE(request: Request) {
  const jar = await cookies();
  const session = sessionViewer(jar.get(SESSION_COOKIE)?.value);
  if (session?.kind !== "account") return Response.json({ error: "Sign in to the account you want to delete" }, { status: 403 });
  const parsed = z.object({ password: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !checkAccount(session.account.email, parsed.data.password)) return Response.json({ error: "Wrong password" }, { status: 403 });
  deleteAccount(session.account.id);
  jar.delete(SESSION_COOKIE);
  // Its runs and files go with it (running ones are stopped first).
  await purgeAccount(session.account.id);
  return new Response(null, { status: 204 });
}
