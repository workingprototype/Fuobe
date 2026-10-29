/**
 * Accounts in tests: set the owner's password (Personal with sign-in), sign in and get the session cookie, the way
 * Settings → Security and the /login card do. Each test file sets FUOBE_DATA_DIR before importing Fuobe.
 */
import { changeOwnerPassword, signInOwner } from "@/server/identity/owner";

const BY = { actorId: "u_owner", via: "local" };

/** Require a password (or, with null, turn sign-in off: Just me on this computer). */
export async function setOwnerPassword(password: string | null): Promise<void> {
  await changeOwnerPassword(password, BY);
}

/** Sign the owner in and return the Cookie header a browser would send next. */
export async function ownerCookie(password: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await signInOwner(password, new Headers(headers));
  if (!r.ok) throw new Error(`sign-in failed${r.code ? `: ${r.code}` : ""}`);
  return cookieHeader(r.setCookies);
}

/** Set-Cookie lines → the Cookie header (name=value pairs, skipping cookies being cleared). */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(";")[0])
    .join("; ");
}
