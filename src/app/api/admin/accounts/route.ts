import { cookies } from "next/headers";
import { connection } from "next/server";
import { accountsCsv, isOwnerRequest, listAccounts, SESSION_COOKIE } from "@/server/auth";

/** Settings → Accounts (owner only): everyone who signed up, newest first. `?format=csv` downloads them. */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, (await cookies()).get(SESSION_COOKIE)?.value)) return Response.json({ error: "Only the studio's owner sees accounts" }, { status: 403 });
  const items = listAccounts();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const day = new Date().toISOString().slice(0, 10);
    return new Response(accountsCsv(items), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fuobe-accounts-${day}.csv"`, "Cache-Control": "no-store" },
    });
  }
  return Response.json({ total: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
