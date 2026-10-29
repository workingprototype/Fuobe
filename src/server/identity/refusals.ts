import "server-only";
import { REFUSAL_COPY, refusalMessage, type RefusalCopy } from "@/lib/sign-in-refusals";
import { installName, installValue } from "../mode";

/**
 * Refusal codes (docs/research/accounts-8.md §7.1): a check that turns a person away — at sign-in
 * (session.create.before) or on a request (the principal) — answers with a code and the sign-in card's words for
 * it. Core codes are ACCOUNT_PENDING, ACCOUNT_DISABLED and ACCOUNT_DORMANT; packages register theirs.
 */

export interface Refusal {
  code: string;
  status: number;
  message: string;
}

/** Add a code (or reword one). */
export function registerRefusal(code: string, copy: RefusalCopy): void {
  REFUSAL_COPY[code] = copy;
}

/** The refusal for a code, with the install's name and contact filled in. */
export function refusal(code: string): Refusal {
  const copy = REFUSAL_COPY[code];
  const message = refusalMessage(code, { name: installName(), contact: installValue("install.contact") ?? undefined }) ?? "You can't sign in right now.";
  return { code, status: copy?.status ?? 403, message };
}

/** A JSON answer for an API request. */
export function refusalResponse(code: string, init: ResponseInit = {}): Response {
  const r = refusal(code);
  return Response.json({ error: r.message, code: r.code }, { ...init, status: r.status });
}
