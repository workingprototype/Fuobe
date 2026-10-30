import "server-only";
import { appendAudit } from "./audit-log";
import { getAuth, withCreateIntent } from "./auth";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * The one place Fuobe writes Better Auth's tables (docs/research/accounts-8.md §7.1): through the internal adapter
 * of the running instance, `(await auth.$context).internalAdapter`, so Better Auth's own hooks run and its storage
 * rules hold. Every call is audited with who did it. A test pins that the adapter and these methods are reachable
 * in the pinned version (tests/identity-better-auth.test.ts).
 */

/** Who is acting, for the audit log. */
export interface By {
  actorId: string | null;
  via: string;
}

export const SYSTEM: By = { actorId: null, via: "system" };

const adapter = async () => (await getAuth().$context).internalAdapter;

function audit(action: string, by: By, targetId: string | null, meta?: Record<string, unknown>) {
  appendAudit({ action, actorId: by.actorId, via: by.via, targetKind: "auth_user", targetId, meta });
}

/** Create a sign-in account for a person, under a create intent (claim-owner, bootstrap-import; later invite, sso…). */
export async function createAuthUser(intent: string, user: { email: string; name: string }, by: By): Promise<string> {
  const ia = await adapter();
  const made = await withCreateIntent(intent, () => ia.createUser({ email: user.email.toLowerCase(), name: user.name, emailVerified: false }, { method: `fuobe:${intent}` }));
  audit("people.auth_user_created", by, made.id, { intent });
  return made.id;
}

export async function findAuthUserByEmail(email: string): Promise<string | null> {
  return (await (await adapter()).findUserByEmail(email.toLowerCase()))?.user.id ?? null;
}

export async function authUserExists(authUserId: string): Promise<boolean> {
  return !!(await (await adapter()).findUserById(authUserId));
}

/** The person's sign-in email (the owner of a Personal install has the never-shown owner@fuobe.invalid). */
export async function authUserEmail(authUserId: string): Promise<string | null> {
  return (await (await adapter()).findUserById(authUserId))?.email ?? null;
}

/** Whether the account has a password (a credential account with a hash). */
export async function hasPassword(authUserId: string): Promise<boolean> {
  return !!(await (await adapter()).findCredentialAccount(authUserId))?.password;
}

/** Whether the account's password is stored in an older format (rewritten at the next sign-in). */
export async function passwordNeedsRehash(authUserId: string): Promise<boolean> {
  const hash = (await (await adapter()).findCredentialAccount(authUserId))?.password;
  return !!hash && needsRehash(hash);
}

/** Check a password against the account's own, without signing in. */
export async function verifyPasswordFor(authUserId: string, password: string): Promise<boolean> {
  const hash = (await (await adapter()).findCredentialAccount(authUserId))?.password;
  return !!hash && verifyPassword({ hash, password });
}

/**
 * Set a person's password: a plain password is hashed (scrypt v2); `{ hash }` stores one as is (the auth.json
 * import keeps the old salt:hash, rewritten at the next sign-in). Creates the credential account when there is none.
 */
export async function setPasswordFor(authUserId: string, password: string | { hash: string }, by: By): Promise<void> {
  const ia = await adapter();
  const hash = typeof password === "string" ? await hashPassword(password) : password.hash;
  const account = await ia.findCredentialAccount(authUserId);
  if (account) await ia.updatePassword(authUserId, hash);
  else await ia.linkAccount({ userId: authUserId, providerId: "credential", accountId: authUserId, password: hash });
  audit("auth.password_set", by, authUserId, { imported: typeof password !== "string" });
}

/** Remove a person's password (their credential account). Other sign-in methods stay. */
export async function removePasswordFor(authUserId: string, by: By): Promise<void> {
  const ia = await adapter();
  const account = await ia.findCredentialAccount(authUserId);
  if (account) await ia.deleteAccount(account.id);
  audit("auth.password_removed", by, authUserId);
}

/** Sign a person out everywhere. */
export async function revokeAllSessions(authUserId: string, by: By): Promise<void> {
  await (await adapter()).deleteUserSessions(authUserId);
  audit("auth.sessions_revoked", by, authUserId);
}

/** End one session (by its id, as session lists show it; Better Auth deletes by token). */
export async function revokeSessionById(authUserId: string, sessionId: string, by: By): Promise<boolean> {
  const ia = await adapter();
  const session = (await ia.listSessions(authUserId)).find((s) => s.id === sessionId);
  if (!session) return false;
  await ia.deleteSession(session.token);
  audit("auth.session_revoked", by, authUserId, { session: sessionId });
  return true;
}

export async function setEmail(authUserId: string, email: string, by: By): Promise<void> {
  await (await adapter()).updateUser(authUserId, { email: email.toLowerCase(), emailVerified: false });
  audit("people.email_changed", by, authUserId);
}

export async function updateName(authUserId: string, name: string, by: By): Promise<void> {
  await (await adapter()).updateUser(authUserId, { name: name.trim().slice(0, 80) });
  audit("people.name_changed", by, authUserId);
}

/** Delete the sign-in account (its sessions and linked accounts go with it). The Fuobe person stays. */
export async function deleteAuthUser(authUserId: string, by: By): Promise<void> {
  const ia = await adapter();
  await ia.deleteUserSessions(authUserId);
  await ia.deleteAccounts(authUserId);
  await ia.deleteUser(authUserId);
  audit("people.auth_user_deleted", by, authUserId);
}
