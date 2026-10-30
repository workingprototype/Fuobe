import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "../identity/principal";

/**
 * Who is acting, wherever the code runs (docs/research/accounts-8.md §7.1, §7.11). A request scope rides on
 * AsyncLocalStorage: route handlers open one through handler() (src/server/access/route.ts), runners open one per row
 * with runAs(row owner), and housekeeping runs asSystem. Server modules ask currentActor(), which throws when nothing
 * opened a scope: code that acts for nobody is a bug, never a silent "the owner".
 *
 * This module imports nothing that touches the database, so the test setup (tests/setup/actor.ts) can load it before
 * a test file has chosen its data folder.
 */

export type { Actor };

/** What a request (or a runner's turn) knows about who is acting and from where. */
export interface RequestScope {
  /** Null on a public route answered for nobody (a share file, the sign-in form). */
  actor: Actor | null;
  ip?: string | null;
  userAgent?: string | null;
  method?: string;
  path?: string;
  /** The route's pattern (`/api/generations/[id]`): the path with each dynamic segment named, for rate-limited denials. */
  route?: string;
  /**
   * The workspace the request asked to work in (an id or a slug): the tab's X-Fuobe-Workspace header, or
   * `?workspace=` where a header can't be sent (EventSource, downloads). The scoping layer checks it
   * (src/server/access/scope.ts activeWorkspace); without one, a person works in their own library.
   */
  workspace?: string | null;
}

declare global {
  var __fuobeAccessScope: AsyncLocalStorage<RequestScope> | undefined;
}

/** One store per process, shared by every bundle that loads this module (instrumentation and route handlers). */
const store = (): AsyncLocalStorage<RequestScope> => (globalThis.__fuobeAccessScope ??= new AsyncLocalStorage<RequestScope>());

/** The local owner: "Just me on this computer", and the person every test acts as unless it says otherwise. */
export const LOCAL_OWNER: Actor = Object.freeze({ userId: "u_owner", role: "owner", via: "local", scopes: ["full"] }) as Actor;

/** The server itself: housekeeping, sweeps and boot work that belong to no one. */
export const SYSTEM: Actor = Object.freeze({ userId: "system", role: "system", via: "system", scopes: ["full"] }) as Actor;

export class NoActorError extends Error {
  constructor() {
    super("No one is acting here: wrap this in handler(), runAs() or asSystem()");
    this.name = "NoActorError";
  }
}

/** The scope this code runs in, if any. */
export function requestScope(): RequestScope | undefined {
  return store().getStore();
}

/** Who is acting, or null (no scope, or a public route answered for nobody). */
export function maybeActor(): Actor | null {
  return store().getStore()?.actor ?? null;
}

/** Who is acting. Throws when no one is: every route, runner and sweep opens a scope first. */
export function currentActor(): Actor {
  const actor = maybeActor();
  if (!actor) throw new NoActorError();
  return actor;
}

/** Run `fn` inside a scope (handler() opens one per request). */
export function withScope<T>(scope: RequestScope, fn: () => T): T {
  return store().run(scope, fn);
}

/**
 * Run `fn` as `actor`: a runner working on a row its owner started, an after() continuation, Assist acting for the
 * chat's author. Timers and promises started inside keep the actor (AsyncLocalStorage follows them).
 */
export function runAs<T>(actor: Actor, fn: () => T): T {
  return store().run({ actor }, fn);
}

/** Run `fn` as the server itself: timers that sweep everyone's rows start here, then act per row with runAs. */
export function asSystem<T>(fn: () => T): T {
  return store().run({ actor: SYSTEM }, fn);
}

/**
 * The actor now, as a function that runs later work as them: `const resume = captureActor(); after(() => resume(work))`.
 * Explicit, so a continuation never depends on where the work happens to be scheduled from.
 */
export function captureActor(): <T>(fn: () => T) => T {
  const actor = currentActor();
  return (fn) => runAs(actor, fn);
}

/** For the test harness only: make the rest of this synchronous run (and what it starts) act as `actor`. */
export function enterAs(actor: Actor | null): void {
  store().enterWith({ actor });
}
