import "server-only";
import { isAPIError } from "better-auth/api";
import { REFUSAL_COPY } from "@/lib/sign-in-refusals";
import { db } from "../db";
import { bumpIdentityConfig, envOwnerPassword, INSTALL, setInstallValue } from "../mode";
import * as ops from "./admin-ops";
import { appendAudit } from "./audit-log";
import { getAuth } from "./auth";
import { passwordProblem } from "./password";

/**
 * The owner of a Personal install: one password, no email (docs/research/accounts-8.md §8). Their Better Auth user
 * carries the placeholder owner@fuobe.invalid, which is never shown; the sign-in card asks for the password only and
 * the /api/auth/login shim signs u_owner in with it. Settings → Security sets, changes and removes that password as
 * it always has; removing it turns sign-in off (Just me on this computer).
 */

export const OWNER_EMAIL = "owner@fuobe.invalid";
export const OWNER_NAME = "Owner";

/** The owner's Better Auth user, when one is linked. */
export function ownerAuthUserId(): string | null {
  return (db().prepare("SELECT auth_user_id FROM users WHERE id = 'u_owner'").get() as { auth_user_id: string | null } | undefined)?.auth_user_id ?? null;
}

/**
 * The owner's Better Auth user, created (under `intent`) and linked when there is none yet. A user left by an
 * interrupted run (the placeholder email exists but isn't linked) is linked rather than duplicated.
 */
export async function ensureOwnerAuthUser(intent: "claim-owner" | "bootstrap-import", by: ops.By): Promise<string> {
  const linked = ownerAuthUserId();
  if (linked && (await ops.authUserExists(linked))) return linked;
  const id = (await ops.findAuthUserByEmail(OWNER_EMAIL)) ?? (await ops.createAuthUser(intent, { email: OWNER_EMAIL, name: OWNER_NAME }, by));
  db().prepare("UPDATE users SET auth_user_id = ?, updated_at = ? WHERE id = 'u_owner'").run(id, Date.now());
  return id;
}

/** Whether `password` is the owner's (false when the owner has none). */
export async function checkOwnerPassword(password: string): Promise<boolean> {
  const id = ownerAuthUserId();
  return !!id && ops.verifyPasswordFor(id, password);
}

export type SignInResult = { ok: true; setCookies: string[] } | { ok: false; code?: string; message?: string };

/**
 * Sign the owner in through Better Auth (its session checks, cookies and the password upgrade run as for anyone).
 * The Set-Cookie headers go on the shim's answer.
 */
export async function signInOwner(password: string, headers: Headers): Promise<SignInResult> {
  const id = ownerAuthUserId();
  const email = id ? await ops.authUserEmail(id) : null;
  if (!email) return { ok: false };
  try {
    const res = await getAuth().api.signInEmail({ body: { email, password, rememberMe: true }, headers, returnHeaders: true });
    return { ok: true, setCookies: res.headers?.getSetCookie() ?? [] };
  } catch (e) {
    if (isAPIError(e)) {
      // A refusal with its own copy (pending, turned off, dormant…); anything else reads as a wrong password.
      const code = (e.body as { code?: string } | undefined)?.code;
      if (code && code in REFUSAL_COPY) return { ok: false, code, message: e.message };
      return { ok: false };
    }
    throw e;
  }
}

/** Sign out: the session row goes (so the cookie is dead everywhere), and the answer expires the cookie. */
export async function signOut(headers: Headers): Promise<string[]> {
  try {
    const res = await getAuth().api.signOut({ headers, returnHeaders: true });
    return res.headers?.getSetCookie() ?? [];
  } catch {
    return [];
  }
}

/** Settings → Security's view: whether a password is required, and whether the server sets it. */
export function ownerPasswordStatus(): { fromEnv: boolean } {
  return { fromEnv: !!envOwnerPassword() };
}

/**
 * Set, change or (with null) remove the owner's password. Signs every browser out; the caller signs this one back
 * in. Setting one turns sign-in on; removing it turns sign-in off.
 */
export async function changeOwnerPassword(next: string | null, by: ops.By): Promise<void> {
  if (envOwnerPassword()) throw new Error("The password is set by FUOBE_PASSWORD on the server");
  if (next !== null) {
    const problem = passwordProblem(next);
    if (problem) throw new Error(problem);
    const id = await ensureOwnerAuthUser("claim-owner", by);
    await ops.setPasswordFor(id, next, by);
    await ops.revokeAllSessions(id, by);
    setInstallValue(INSTALL.signin, "on");
  } else {
    const id = ownerAuthUserId();
    if (id) {
      await ops.removePasswordFor(id, by);
      await ops.revokeAllSessions(id, by);
    }
    setInstallValue(INSTALL.signin, "off");
  }
  bumpIdentityConfig();
  appendAudit({ action: next === null ? "install.sign_in_off" : "install.sign_in_on", actorId: by.actorId, via: by.via });
}
