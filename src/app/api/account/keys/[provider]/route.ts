import { z } from "zod";
import { isCloudProvider, NOT_ACCOUNT_KEYS, type CloudProvider } from "@/lib/your-keys";
import { accountKeyInfo, cleanKey, removeAccountKey, saveAccountKey } from "@/server/account-keys";
import { accountKeyRecord, requestAccount } from "@/server/auth";
import { hit, unhit } from "@/server/rate";
import { SecretBoxError } from "@/server/secret-box";
import { checkKey, runsGoingMessage, runsOnKey, stopRunsOnKey } from "@/server/your-keys";

/**
 * Settings → Your keys: add, replace or remove the account's own fal.ai key or Replicate token. PUT checks the key with
 * the provider first (a free call that runs nothing; `?test=1` checks only), then seals and saves it. A key is never
 * logged, and never answered with: only its last 4 characters. Removing or replacing a key that runs are going on asks
 * first (409 runs-going); with `stopRuns` they are stopped at the provider, with the old key, before it changes.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const answer = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

/** Checks a minute: per account, and for every account together (the server is no key checker for stolen keys). */
const CHECKS_PER_MINUTE = 10;
const CHECKS_PER_MINUTE_ALL = 120;

const Body = z.object({ key: z.string().max(400), stopRuns: z.boolean().optional() });

/** The account asking and the provider named, or the answer for anyone else. */
async function who(request: Request, ctx: RouteContext<"/api/account/keys/[provider]">): Promise<{ refused: Response } | { id: string; provider: CloudProvider }> {
  const a = requestAccount(request);
  if (!a) return { refused: answer(400, { error: NOT_ACCOUNT_KEYS }) };
  const { provider } = await ctx.params;
  if (!isCloudProvider(provider)) return { refused: answer(404, { error: "Keys are for fal.ai or Replicate" }) };
  return { id: a.id, provider };
}

export async function PUT(request: Request, ctx: RouteContext<"/api/account/keys/[provider]">): Promise<Response> {
  const w = await who(request, ctx);
  if ("refused" in w) return w.refused;
  const { id, provider } = w;
  const mine = hit(`keys:${id}`, CHECKS_PER_MINUTE, 60_000);
  const all = mine.ok ? hit("keys:all", CHECKS_PER_MINUTE_ALL, 60_000) : mine;
  if (!all.ok) {
    if (mine.ok) unhit(`keys:${id}`);
    return answer(429, { error: "Too many checks. Wait a minute." }, { "Retry-After": String(all.retryAfterS) });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const key = parsed.success ? cleanKey(parsed.data.key) : null;
  if (!parsed.success || !key) return answer(400, { error: "Paste the whole key, without spaces." });
  const check = await checkKey(provider, key);
  if (!check.ok) return answer(check.status, { error: check.error });
  if (new URL(request.url).searchParams.get("test") === "1") return answer(200, { provider, ok: true, detail: check.detail });
  // Replacing a key runs are going on: they stop first, with the key they were sent with.
  const going = accountKeyRecord(id, provider) ? runsOnKey(id, provider) : [];
  if (going.length && !parsed.data.stopRuns) return answer(409, { code: "runs-going", count: going.length, error: runsGoingMessage(going.length, true) });
  if (going.length) await stopRunsOnKey(id, provider);
  try {
    const info = saveAccountKey(id, provider, key);
    return answer(200, { provider, ...info, detail: check.detail });
  } catch (e) {
    if (e instanceof SecretBoxError) return answer(503, { error: e.message });
    throw e;
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/account/keys/[provider]">): Promise<Response> {
  const w = await who(request, ctx);
  if ("refused" in w) return w.refused;
  const { id, provider } = w;
  const body = (await request.json().catch(() => null)) as { stopRuns?: unknown } | null;
  const stopRuns = body?.stopRuns === true || new URL(request.url).searchParams.get("stopRuns") === "1";
  const going = accountKeyRecord(id, provider) ? runsOnKey(id, provider) : [];
  if (going.length && !stopRuns) return answer(409, { code: "runs-going", count: going.length, error: runsGoingMessage(going.length, false) });
  if (going.length) await stopRunsOnKey(id, provider);
  removeAccountKey(id, provider);
  return answer(200, { keys: accountKeyInfo(id) });
}
