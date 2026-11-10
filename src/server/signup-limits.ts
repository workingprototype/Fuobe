import "server-only";
import { LoginGuard } from "./auth";
import { hit, peek } from "./rate";

declare global {
  var __fuobeSignupGuard: LoginGuard | undefined;
}

/**
 * Every sign-up that could make an account counts, made or not: a client makes at most 5 a minute, and everyone slows
 * down past 20. Sign-up with an email and a password and sign-up with Google or GitHub share these budgets.
 */
const guard = () => (globalThis.__fuobeSignupGuard ??= new LoginGuard());
/**
 * Accounts a day from one address. One address can be a whole office, class or mobile network, so this is a ceiling
 * for scripts, not for people: all accounts together keep at most a share of the disk anyway (account-files.ts).
 */
export const SIGNUPS_A_DAY = 20;
const DAY = 24 * 60 * 60_000;

export interface SignupRefusal {
  error: string;
  retryAfterS: number;
}

/**
 * Before an account is made for the client with this key (LoginGuard.clientKey): null when it may go on (the try is
 * counted), else why not. The shared key (no trusted proxy) is everyone: it isn't capped by the day.
 */
export function beginSignup(key: string): SignupRefusal | null {
  const wait = guard().blockedFor(key);
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    return { error: `Too many sign-ups. Try again in ${secs} second${secs === 1 ? "" : "s"}.`, retryAfterS: secs };
  }
  guard().fail(key);
  const today = key === LoginGuard.DIRECT ? null : peek(`signup-day:${key}`, SIGNUPS_A_DAY, DAY);
  if (today && !today.ok) return { error: "That's a lot of new accounts from one network today. Try again tomorrow.", retryAfterS: today.retryAfterS };
  return null;
}

/** An account was made for this client: it counts toward the day's. */
export function signupMade(key: string): void {
  if (key !== LoginGuard.DIRECT) hit(`signup-day:${key}`, SIGNUPS_A_DAY, DAY);
}
