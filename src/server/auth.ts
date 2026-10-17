/**
 * Access protection. Off until a password is set (Settings → Security, or FUOBE_PASSWORD).
 * Then every page and API call needs a session cookie (from /login) or an API token
 * (`Authorization: Bearer fuobe_…`).
 *
 * Kept in a small JSON file next to the database, not in SQLite, so the proxy can check
 * requests with nothing but `fs` and `crypto`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
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
