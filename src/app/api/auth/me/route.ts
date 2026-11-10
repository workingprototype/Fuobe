import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import {
  AccountError,
  accountGpu,
  accountHasPassword,
  accountProviders,
  authEnabled,
  createSession,
  publicSignup,
  SESSION_COOKIE,
  sessionCookieOf,
  sessionIssuedAt,
  sessionViewer,
  setAccountPassword,
  setFirstAccountPassword,
  validToken,
  verifyAccount,
  type Account,
} from "@/server/auth";
import { oauthProviders, PROVIDER_NAME } from "@/server/oauth";
import { runnerFacts } from "@/server/computer/tasks";
import { getSetting } from "@/server/settings";
import { soundLive } from "@/server/sound-live";
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
  // The sound features that have passed a real run (src/server/sound-live.ts): their switches start on and show to everyone.
  const live = Object.entries(soundLive()).flatMap(([k, v]) => (v ? [k] : []));
  // Continue with Google or GitHub: the providers this install set up, while sign-up is open.
  const oauth = open ? oauthProviders() : [];
  const linked = account ? accountProviders(account.id) : [];
  return Response.json(
    {
      signedIn: owner || !!account,
      owner,
      publicSignup: open,
      ...(oauth.length && { oauth }),
      ...(account && {
        account: {
          email: account.email,
          ...(linked.length && { providers: linked }),
          ...(!accountHasPassword(account) && { noPassword: true }),
        },
      }),
      ...(computer && { computer: true, ...(comfyPort && { comfyPort }) }),
      ...(live.length && { soundLive: live }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Five password checks a minute per account, deleting it and changing its password together: each is a slow check on
 * purpose, and either one tells whether a guess was right.
 */
const passwordCheck = (id: string) => hit(`password-check:${id}`, 5, 60_000);

/**
 * A request from no account: signed out (no session, or one that ended when the password was changed in another browser)
 * is a 401, so the page can show Log in; the owner, whose password isn't an account's, a 403.
 */
function notAnAccount(request: Request, signedOut: string, owner: string): Response {
  const isOwner = !authEnabled() || validToken(request.headers.get("authorization"));
  return Response.json({ error: isOwner ? owner : signedOut }, { status: isOwner ? 403 : 401 });
}

/**
 * An account made with Google or GitHub has no password to enter again: deleting it or setting its first password asks
 * for a sign-in with the provider in the last 10 minutes instead.
 */
const RECENT_SIGN_IN_MS = 10 * 60_000;

/** This session's sign-in was in the last 10 minutes. */
const recentSignIn = (cookie: string | undefined) => (sessionIssuedAt(cookie) ?? 0) >= Date.now() - RECENT_SIGN_IN_MS;

/** 403 `sign-in-again`: the page offers the account's provider, and comes back here. */
function signInAgain(account: Account, then: string): Response {
  const p = accountProviders(account.id).find((x) => oauthProviders().includes(x));
  const name = p ? PROVIDER_NAME[p] : "your provider";
  return Response.json(
    { error: `To keep your account safe, continue with ${name} again, then ${then} within 10 minutes.`, code: "sign-in-again", ...(p && { provider: p }) },
    { status: 403 },
  );
}

/** An account deletes itself (its password again, to be sure; or a recent sign-in with its provider). Signs it out. */
export async function DELETE(request: Request) {
  const jar = await cookies();
  const cookie = sessionCookieOf(request);
  const session = sessionViewer(cookie);
  const ownerRefusal = "This deletes an account, not the studio";
  if (!session) return notAnAccount(request, "You're signed out. Log in again to delete your account.", ownerRefusal);
  if (session.kind !== "account") return Response.json({ error: ownerRefusal }, { status: 403 });
  if (!accountHasPassword(session.account)) {
    if (!recentSignIn(cookie)) return signInAgain(session.account, "delete your account");
  } else {
    const parsed = z.object({ password: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Wrong password" }, { status: 403 });
    const rate = passwordCheck(session.account.id);
    if (!rate.ok) return Response.json({ error: "Too many tries. Wait a minute, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
    if (!(await verifyAccount(session.account.email, parsed.data.password))) return Response.json({ error: "Wrong password" }, { status: 403 });
  }
  // Switched off at once, its running jobs stopped (on its own keys), then its runs, files and record go.
  await removeAccount(session.account.id);
  jar.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}

const NewPassword = z.object({
  /** Left out by an account setting its first password (made with Google or GitHub). */
  current: z.string().max(500).optional(),
  next: z.string().min(8, "Use at least 8 characters").max(500, "Use at most 500 characters"),
});

/**
 * An account changes its password (the current one first, to be sure), or sets its first one (made with Google or
 * GitHub: a recent sign-in with the provider instead). Its other sign-ins end; this browser gets a new session cookie.
 */
export async function PATCH(request: Request) {
  const jar = await cookies();
  const cookie = sessionCookieOf(request);
  const session = sessionViewer(cookie);
  const ownerRefusal = "This changes an account's password, not the studio's";
  if (!session) return notAnAccount(request, "You're signed out. Log in again to change your password.", ownerRefusal);
  if (session.kind !== "account") return Response.json({ error: ownerRefusal }, { status: 403 });
  const parsed = NewPassword.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const next = parsed.error.issues.find((i) => i.path[0] === "next");
    return Response.json({ error: next?.message ?? "Enter your current password and a new one" }, { status: 400 });
  }
  // Made with Google or GitHub: its first password, after a recent sign-in with the provider (no current one to enter).
  const first = !accountHasPassword(session.account);
  if (first && !recentSignIn(cookie)) return signInAgain(session.account, "set your password");
  const current = parsed.data.current;
  if (!first && current === undefined) return Response.json({ error: "Enter your current password and a new one" }, { status: 400 });
  // Not a change: it would sign the other browsers out for nothing. (Two of the request's own words: no password check.)
  if (!first && parsed.data.next === current) return Response.json({ error: "Choose a new password, not the one you use now" }, { status: 400 });
  const rate = passwordCheck(session.account.id);
  if (!rate.ok) return Response.json({ error: "Too many tries. Wait a minute, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  try {
    if (first) await setFirstAccountPassword(session.account.id, parsed.data.next);
    else await setAccountPassword(session.account.id, current ?? "", parsed.data.next);
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const s = createSession(session.account.id);
  jar.set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: s.maxAge });
  return Response.json({ ok: true });
}
