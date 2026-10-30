import "server-only";

/**
 * A sliding-window limiter in memory, keyed by a string ("up:<accountId>", "run:<accountId>", "gpu:<accountId>"). Each
 * key keeps the times of its recent hits. One server process: a restart starts every count again, which is fine for
 * limits that only keep one account from crowding out the others.
 */

declare global {
  var __fuobeRate: Map<string, number[]> | undefined;
  var __fuobeRateBusy: Map<string, number> | undefined;
}

const hits = (): Map<string, number[]> => (globalThis.__fuobeRate ??= new Map());

/** What a key's hits look like now: ok when another fits; retryAfterS when it doesn't. */
export function peek(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const list = (hits().get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length < limit) return { ok: true, retryAfterS: 0 };
  return { ok: false, retryAfterS: Math.max(1, Math.ceil((list[list.length - limit] + windowMs - now) / 1000)) };
}

/** Count a hit when it fits under `limit` in `windowMs`; else refuse it, with the seconds until one fits. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const map = hits();
  const list = (map.get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length >= limit) {
    map.set(key, list);
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((list[list.length - limit] + windowMs - now) / 1000)) };
  }
  list.push(now);
  map.set(key, list);
  // Keys nobody uses any more go (a rough sweep, so the map can't grow without end).
  if (map.size > 20_000) for (const [k, v] of map) if (!v.length || v[v.length - 1] < now - 24 * 60 * 60_000) map.delete(k);
  return { ok: true, retryAfterS: 0 };
}

/** Take back the last hit of a key (a request refused for another reason after it was counted). */
export function unhit(key: string): void {
  hits().get(key)?.pop();
}

/** At most `limit` at once for a key: returns a release function, or null when the key is full. */
export function enter(key: string, limit: number): (() => void) | null {
  const busy = (globalThis.__fuobeRateBusy ??= new Map());
  const n = busy.get(key) ?? 0;
  if (n >= limit) return null;
  busy.set(key, n + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (busy.get(key) ?? 1) - 1;
    if (left > 0) busy.set(key, left);
    else busy.delete(key);
  };
}

/** Tests: forget every count. */
export function resetRates(): void {
  globalThis.__fuobeRate?.clear();
  globalThis.__fuobeRateBusy?.clear();
}
