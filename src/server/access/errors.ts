import "server-only";

/**
 * The refusals a route handler answers for (docs/research/accounts-8.md §7.1, §7.4, §7.12): server code throws one and
 * handler() turns it into the JSON answer, `{ error, code? }` with its status. Every 403 is audited as `denied`; a
 * hidden record (a 404 for something that exists but isn't the actor's to see) as `denied.hidden`, at most once a
 * minute per person and route.
 */

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 404: no such thing — or one the actor may not know exists (`hidden`, which is audited). */
export class NotFoundError extends AccessError {
  constructor(
    message = "Not found",
    readonly hidden = false,
  ) {
    super(message, 404);
  }
}

/** 403: the actor is known and may not do this. */
export class ForbiddenError extends AccessError {
  constructor(message = "You don't have access to this.", code?: string) {
    super(message, 403, code);
  }
}

/** 401: nobody (or an invalid token) asking for something that needs a person. */
export class UnauthenticatedError extends AccessError {
  constructor(message = "Sign in, or send an API token as Authorization: Bearer fuobe_…", code?: string) {
    super(message, 401, code);
  }
}

/** 402: a limit or a credit balance stops this run (the meter and plans packages throw it with their line). */
export class PaymentRequiredError extends AccessError {
  constructor(message = "This would go over your limit.", code = "LIMIT_REACHED") {
    super(message, 402, code);
  }
}

/** 403 REAUTH: a sensitive action needs the session confirmed in the last 10 minutes ("Confirm it's you", §7.2). */
export class ReauthRequiredError extends AccessError {
  constructor(message = "Confirm it's you to continue.") {
    super(message, 403, "REAUTH");
  }
}

/**
 * For code that catches errors to answer them itself (a route's `catch (e)`, a studio's `handle()`): pass a refusal on
 * to handler(), which answers it with its status and audits it. Call it first in the catch block.
 */
export function rethrowAccess(e: unknown): void {
  if (e instanceof AccessError) throw e;
}
