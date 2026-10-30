/**
 * Access protection. Off until a password is set (Settings → Security, or FUOBE_PASSWORD).
 * Then every page and API call needs a session cookie (from /login) or an API token
 * (`Authorization: Bearer fuobe_…`).
 *
 * Kept in a small JSON file next to the database, not in SQLite, so the proxy's sign-in check
 * needs nothing but `fs` and `crypto`. (The proxy does open SQLite, for one primary-key lookup on
 * record pages only, so an unknown id gets a real 404: src/server/records.ts.)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));
const FILE = path.join(DATA_DIR, "auth.json");

export const SESSION_COOKIE = "fuobe_session";
const SESSION_DAYS = 30;

export interface ApiToken {
  id: string;
  name: string;
  /** sha256 of the token; the token itself is shown once. */
  hash: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface AuthFile {
  /** scrypt hash of the UI-set password ("salt:hash", hex). */
  password?: string;
  /** Signs session cookies; replaced when the password changes, which signs everyone out. */
  secret: string;
  tokens: ApiToken[];
}

let cache: { mtime: number; data: AuthFile } | null = null;

function read(): AuthFile {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (cache?.mtime === mtime) return cache.data;
    const data = JSON.parse(fs.readFileSync(FILE, "utf8")) as AuthFile;
    cache = { mtime, data };
    return data;
  } catch {
    return { secret: "", tokens: [] };
  }
}

function write(data: AuthFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cache = null;
}

function withSecret(data: AuthFile): AuthFile {
  return data.secret ? data : { ...data, secret: crypto.randomBytes(32).toString("hex") };
}

const envPassword = () => process.env.FUOBE_PASSWORD || "";

export function authStatus(): { enabled: boolean; fromEnv: boolean; tokens: Omit<ApiToken, "hash">[] } {
  const d = read();
  return { enabled: !!(envPassword() || d.password), fromEnv: !!envPassword(), tokens: d.tokens.map(publicToken) };
}

const publicToken = (t: ApiToken): Omit<ApiToken, "hash"> => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt });

export const authEnabled = () => !!(envPassword() || read().password);

// ---------------------------------------------------------------------------
// Passwords

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

export function checkPassword(pw: string): boolean {
  const env = envPassword();
  if (env) return same(crypto.createHash("sha256").update(pw).digest(), crypto.createHash("sha256").update(env).digest());
  const stored = read().password;
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  return same(crypto.scryptSync(pw, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}

/** Set, change or (with null) remove the UI password. Signs every browser out. */
export function setPassword(pw: string | null): void {
  if (envPassword()) throw new Error("The password is set by FUOBE_PASSWORD on the server");
  if (pw !== null && pw.length < 8) throw new Error("Use at least 8 characters");
  const d = read();
  write({ ...d, password: pw === null ? undefined : hashPassword(pw), secret: crypto.randomBytes(32).toString("hex") });
}

// ---------------------------------------------------------------------------
// Sessions

const sign = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export function createSession(): { value: string; maxAge: number } {
  let d = read();
  if (!d.secret) {
    d = withSecret(d);
    write(d);
  }
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  return { value: `${exp}.${sign(d.secret, String(exp))}`, maxAge: SESSION_DAYS * 86_400 };
}

export function validSession(value: string | undefined): boolean {
  if (!value) return false;
  const [exp, mac] = value.split(".");
  const secret = read().secret;
  if (!secret || !exp || !mac || Number(exp) < Date.now()) return false;
  return same(Buffer.from(mac), Buffer.from(sign(secret, exp)));
}

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
 * you trust (FUOBE_TRUST_PROXY=1; the proxy's own entry is the last one): such a client is locked
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

  /** Who is signing in: the last X-Forwarded-For hop when a trusted proxy sets it, else one shared key. */
  static clientKey(headers: Headers, trustProxy = process.env.FUOBE_TRUST_PROXY === "1"): string {
    if (!trustProxy) return LoginGuard.DIRECT;
    const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return hops.at(-1) ?? LoginGuard.DIRECT;
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
// API tokens

const tokenHash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createToken(name: string): { token: string; info: Omit<ApiToken, "hash"> } {
  const token = `fuobe_${crypto.randomBytes(24).toString("base64url")}`;
  const t: ApiToken = { id: crypto.randomBytes(6).toString("hex"), name: name.trim() || "API token", hash: tokenHash(token), prefix: token.slice(0, 12), createdAt: Date.now() };
  const d = withSecret(read());
  write({ ...d, tokens: [...d.tokens, t] });
  return { token, info: publicToken(t) };
}

export function revokeToken(id: string): void {
  const d = read();
  write({ ...d, tokens: d.tokens.filter((t) => t.id !== id) });
}

const touched = new Map<string, number>();

export function validToken(header: string | null): boolean {
  const m = /^Bearer\s+(fuobe_[\w-]+)$/i.exec(header ?? "");
  if (!m) return false;
  const h = Buffer.from(tokenHash(m[1]));
  const d = read();
  const hit = d.tokens.find((t) => same(Buffer.from(t.hash), h));
  if (!hit) return false;
  // Record use at most once an hour per token (avoids a write per request).
  if (Date.now() - (touched.get(hit.id) ?? 0) > 3_600_000) {
    touched.set(hit.id, Date.now());
    write({ ...d, tokens: d.tokens.map((t) => (t.id === hit.id ? { ...t, lastUsedAt: Date.now() } : t)) });
  }
  return true;
}
