import { connection } from "next/server";
import { NOT_ACCOUNT_KEYS, type YourKeys } from "@/lib/your-keys";
import { accountEngineMode, accountKeyInfo, paidAllowed } from "@/server/account-keys";
import { requestAccount } from "@/server/auth";

/**
 * Settings → Your keys (public sign-up): the account's own fal.ai key and Replicate token, as their last 4 characters,
 * when they were added, and whether this server can still open them. Never a key. Accounts only: the studio's own keys
 * are in Settings → Paid API configuration. PUT and DELETE are on /api/account/keys/[provider].
 */
export async function GET(request: Request) {
  await connection();
  const a = requestAccount(request);
  if (!a) return Response.json({ error: NOT_ACCOUNT_KEYS }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const body: YourKeys = { keys: accountKeyInfo(a.id), engineMode: accountEngineMode(a.id), paidAllowed: paidAllowed() };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
