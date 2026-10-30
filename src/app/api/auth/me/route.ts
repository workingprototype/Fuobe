import { cookies } from "next/headers";
import { connection } from "next/server";
import { authEnabled, publicSignup, SESSION_COOKIE, sessionViewer, validToken } from "@/server/auth";

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
