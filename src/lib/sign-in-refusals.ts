/**
 * Why a sign-in or a request was refused, in the words /login shows (docs/research/accounts-8-screens.md §S2.7).
 * Pure, so the sign-in card and the server share one table. `{contact}` is the install's contact ("the Fuobe
 * admin" by default) and `{name}` its name; the server fills them (src/server/identity/refusals.ts). Packages add
 * their codes to REFUSAL_COPY when they add the check that refuses (SEAT_WAIT, SSO_REQUIRED, ACCOUNT_BANNED…).
 */

export interface RefusalCopy {
  /** HTTP status an API request gets. */
  status: number;
  message: string;
}

export const REFUSAL_COPY: Record<string, RefusalCopy> = {
  ACCOUNT_PENDING: { status: 403, message: "Your account is waiting for approval. Ask {contact} to approve it." },
  ACCOUNT_DISABLED: { status: 403, message: "This account is turned off. Ask an admin to turn it back on." },
  ACCOUNT_DORMANT: { status: 403, message: "This Fuobe is in personal mode right now, so other accounts can't sign in. Ask {contact} to switch it back." },
  PASSWORD_LOCKED: { status: 423, message: "Too many wrong passwords. Run fuobe recover on the computer where Fuobe runs." },
};

/** The copy for a code with its placeholders filled; null for a code nobody registered. */
export function refusalMessage(code: string, vars: { contact?: string; name?: string } = {}): string | null {
  const copy = REFUSAL_COPY[code];
  if (!copy) return null;
  const name = vars.name || "Fuobe";
  return copy.message.replaceAll("{contact}", vars.contact || `the ${name} admin`).replaceAll("{name}", name);
}
