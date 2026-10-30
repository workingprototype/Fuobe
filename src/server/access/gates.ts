import "server-only";
import type { Actor } from "./actor";
import { ForbiddenError } from "./errors";

/**
 * Gates for actions that cost nothing but still have limits (docs/research/accounts-8.md §7.12): creating an API
 * token, a share link, an upload, a team, adding one's own keys. The core registers no checks, so every gate is open
 * (a no-op); the entitlements and plans packages register theirs ("Your plan doesn't include share links."). A check
 * returns a refusal or null.
 */

export type GateKind = "token.create" | "share.create" | "upload" | "team.create" | "keys.own" | (string & {});

export interface GateRefusal {
  code: string;
  message: string;
}

type GateCheck = (actor: Actor) => GateRefusal | null;

const CHECKS = new Map<string, GateCheck[]>();

export function registerGate(kind: GateKind, check: GateCheck): void {
  CHECKS.set(kind, [...(CHECKS.get(kind) ?? []), check]);
}

/** The first refusal for this action, or null when it may go ahead. */
export function gateRefusal(kind: GateKind, actor: Actor): GateRefusal | null {
  for (const check of CHECKS.get(kind) ?? []) {
    const r = check(actor);
    if (r) return r;
  }
  return null;
}

/** Refuse (a 403 the route handler answers and audits) when a check says no. */
export function gate(kind: GateKind, actor: Actor): void {
  const r = gateRefusal(kind, actor);
  if (r) throw new ForbiddenError(r.message, r.code);
}
