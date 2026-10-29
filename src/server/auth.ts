/**
 * The perimeter checks the proxy runs on every request, whoever is signed in: cross-site writes, DNS rebinding,
 * the client's address behind a trusted reverse proxy, and the wrong-password throttle. Who is signed in is
 * src/server/identity (Better Auth sessions, API tokens, "Just me on this computer"); whether sign-in is on is
 * src/server/mode.ts.
 *
 * Before accounts, the password, the session secret and the API tokens lived in data/auth.json. The identity
 * bootstrap imports them once (src/server/identity/bootstrap.ts) and leaves the file in place, unread, for one
 * release as a rollback aid: readLegacyAuth is the only reader left.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { signInRequired } from "./mode";

const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));

/** An API token as auth.json kept it. */
export interface LegacyToken {
  id: string;
  name: string;
  /** sha256 of the token, hex. */
  hash: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
}

/** The pre-accounts auth.json: a scrypt hash ("salt:hash", hex) and the API tokens. Null when there is none. */
export function readLegacyAuth(): { password?: string; tokens: LegacyToken[] } | null {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "auth.json"), "utf8")) as { password?: unknown; tokens?: unknown };
    const tokens = Array.isArray(data.tokens)
      ? (data.tokens as LegacyToken[]).filter((t) => t && typeof t.hash === "string" && /^[0-9a-f]{64}$/i.test(t.hash) && typeof t.id === "string")
      : [];
    return { password: typeof data.password === "string" && data.password ? data.password : undefined, tokens };
  } catch {
    return null;
  }
}

/** Whether every page and API call needs a session or a token (Personal with sign-in, Studio, Platform). */
export const authEnabled = (): boolean => signInRequired();

// ---------------------------------------------------------------------------
// Cross-site requests

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Extra addresses this studio is reached at (FUOBE_ALLOWED_ORIGINS="https://fuobe.example.com,studio.lan:3000", or "*" for any). */
function allowedHosts(): string[] {
  return (process.env.FUOBE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return s.includes("://") ? new URL(s).host : s;
      } catch {
        return s;
      }
    });
}

/**
 * Changes must come from Fuobe's own pages, or from a client that isn't a browser (those send no
 * Origin). Without this check any web page could post to a password-less local install — set its
 * password, start paid generations — with a "simple" text/plain request that needs no preflight.
 */
export function crossSite(request: Request, ownHost: string): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true; // "null" (sandboxed frames, file://) or garbage
  }
  if (!host) return true;
  const own = [request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0].trim(), ownHost, ...allowedHosts()];
  return !own.includes(host);
}

// ---------------------------------------------------------------------------
// DNS rebinding

/** Host header → lower-case name without port or trailing dot ("[::1]:3000" → "::1"). */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") >>> 0);
  const colon = h.indexOf(":");
  return (colon >= 0 && colon === h.lastIndexOf(":") ? h.slice(0, colon) : h).replace(/\.$/, "");
}

/** Names nobody on the internet can point at this machine: this machine, the LAN, reserved suffixes. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal", ".localdomain"];

/**
 * Is this a name the studio may be reached at without a password? A page on attacker.example can
 * re-point its own DNS name at 127.0.0.1 (DNS rebinding); the browser then treats the local studio
 * as attacker.example and lets the page read and change it. Such a request carries the attacker's
 * name in Host, so only addresses that can't be rebound pass: IP literals, localhost, single-label
 * and LAN names (.local, .lan, .home.arpa, .internal), this machine's hostname, and
 * FUOBE_ALLOWED_ORIGINS. X-Forwarded-Host is not trusted here: a rebound page can set it.
 */
export function hostAllowed(host: string | null): boolean {
  if (!host) return true; // HTTP/1.0 clients and tools; browsers always send Host
  const name = hostName(host);
  if (!name || net.isIP(name) || !name.includes(".") || LOCAL_SUFFIXES.some((s) => name.endsWith(s))) return true;
  const self = os.hostname().toLowerCase();
  if (name === self || name === self.split(".")[0]) return true;
  return allowedHosts().some((a) => {
    const entry = a.toLowerCase();
    return entry === "*" || entry === host.trim().toLowerCase() || (!entry.includes(":") && entry === name);
  });
}

// ---------------------------------------------------------------------------
// Sign-in attempts

/**
 * Wrong-password limits. Route handlers can't see the socket address, and Next keeps any
 * X-Forwarded-For a client sends, so that header only identifies a client behind a reverse proxy
 * you trust (FUOBE_TRUSTED_PROXIES or FUOBE_TRUST_PROXY=1, see clientIp): such a client is locked
 * out for a minute after 5 misses. Otherwise every client shares the "direct" key, and a lock
 * would let anyone keep the owner out, so a spent budget slows sign-in down to one attempt every
 * few seconds instead (about 15 guesses a minute). Past the global budget the same throttle
 * applies to everyone, however the key is spoofed.
 */
export class LoginGuard {
  static readonly DIRECT = "direct";
  private failures = new Map<string, { n: number; first: number; until: number }>();
  private recent: number[] = [];

  constructor(
    private readonly o = { perClient: 5, global: 20, windowMs: 60_000, lockMs: 60_000, throttleMs: 4_000, maxClients: 5000 },
  ) {}

  /** Who is signing in: the client's address when a trusted proxy reports it (clientIp), else one shared key. */
  static clientKey(headers: Headers, trust: boolean | TrustedProxies | null = trustedProxies()): string {
    const t = trust === true ? { hops: 1 } : trust === false ? null : trust;
    return clientIp(headers, t) ?? LoginGuard.DIRECT;
  }

  /** Milliseconds until this client may try again (0 = now). */
  blockedFor(key: string, now = Date.now()): number {
    this.recent = this.recent.filter((t) => now - t < this.o.windowMs);
    const f = this.failures.get(key);
    const own = f && f.until > now ? f.until - now : 0;
    const shared = key === LoginGuard.DIRECT && !!f && now - f.first <= this.o.windowMs && f.n >= this.o.perClient;
    const last = this.recent.at(-1);
    const throttle = (shared || this.recent.length >= this.o.global) && last !== undefined ? Math.max(0, last + this.o.throttleMs - now) : 0;
    return Math.max(own, throttle);
  }

  fail(key: string, now = Date.now()): void {
    this.recent.push(now);
    const f = this.failures.get(key);
    const fresh = !f || now - f.first > this.o.windowMs;
    const n = fresh ? 1 : f.n + 1;
    this.failures.delete(key);
    // The shared key is throttled (blockedFor), never locked.
    const locks = key !== LoginGuard.DIRECT && n >= this.o.perClient;
    this.failures.set(key, { n, first: fresh ? now : f.first, until: locks ? now + this.o.lockMs : 0 });
    // Forget old entries; never let the map grow without bound.
    for (const [k, v] of this.failures) {
      if (this.failures.size <= this.o.maxClients && now - v.first < this.o.windowMs * 10) break;
      if (v.until < now) this.failures.delete(k);
      else if (this.failures.size > this.o.maxClients) this.failures.delete(k);
    }
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  get size() {
    return this.failures.size;
  }
}

// ---------------------------------------------------------------------------
// The client's address behind a trusted reverse proxy

/**
 * Which reverse proxies in front of Fuobe are trusted to tell the client's address (§7.2): FUOBE_TRUSTED_PROXIES
 * as a hop count ("1", "2": the address that many entries from the right of X-Forwarded-For) or a list of
 * addresses and CIDR ranges (entries from the right that fall inside them are skipped). FUOBE_TRUST_PROXY=1 keeps
 * meaning one hop. Null when nothing is trusted: X-Forwarded-For is then whatever the client wrote.
 */
export type TrustedProxies = { hops: number } | { ranges: net.BlockList; list: string[] };

export function trustedProxies(): TrustedProxies | null {
  const raw = (process.env.FUOBE_TRUSTED_PROXIES ?? "").trim();
  if (raw) {
    if (/^\d+$/.test(raw)) return Number(raw) > 0 ? { hops: Math.min(Number(raw), 10) } : null;
    const ranges = new net.BlockList();
    const list: string[] = [];
    for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [addr, bits] = entry.split("/");
      const family = net.isIP(addr);
      if (!family) continue;
      const type = family === 6 ? "ipv6" : "ipv4";
      if (bits === undefined) ranges.addAddress(addr, type);
      else if (/^\d+$/.test(bits) && Number(bits) <= (family === 6 ? 128 : 32)) ranges.addSubnet(addr, Number(bits), type);
      else continue;
      list.push(entry);
    }
    return list.length ? { ranges, list } : null;
  }
  return process.env.FUOBE_TRUST_PROXY === "1" ? { hops: 1 } : null;
}

/** The client's address as a trusted proxy reported it; null without one (or when the header doesn't hold up). */
export function clientIp(headers: Headers, trust: TrustedProxies | null = trustedProxies()): string | null {
  if (!trust) return null;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if ("hops" in trust) {
    const ip = hops[hops.length - trust.hops];
    return ip && net.isIP(ip) ? ip : null;
  }
  for (let i = hops.length - 1; i >= 0; i--) {
    const family = net.isIP(hops[i]);
    if (!family) return null;
    if (!trust.ranges.check(hops[i], family === 6 ? "ipv6" : "ipv4")) return hops[i];
  }
  return null;
}
