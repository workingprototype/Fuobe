import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db";

/**
 * The root secret (docs/research/accounts-8.md §7.1, §7.15): FUOBE_SECRET, else 32 random bytes in data/secret.key
 * (mode 0600, written once). Every key Fuobe signs or encrypts with is derived from it with HKDF-SHA256 under its
 * own label ("better-auth/v1" for sessions; later "keys/v1", "recover/v1"…), so one file backs them all and none is
 * reused for two purposes. The fingerprint (another label) is stored in the database: a server that finds a
 * different key than the one its data was made with refuses to start, instead of silently signing everyone out
 * and losing every encrypted key.
 */

export const SECRET_FILE = "secret.key";
const MIN_ENV_LENGTH = 32;

/** FUOBE_SECRET as bytes: 64 hex characters are read as hex, anything else (at least 32 characters) as text. */
function envSecret(): Buffer | null {
  const raw = (process.env.FUOBE_SECRET ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < MIN_ENV_LENGTH) throw new Error(`FUOBE_SECRET is too short: use at least ${MIN_ENV_LENGTH} random characters (openssl rand -hex 32).`);
  return Buffer.from(raw, "utf8");
}

export const secretPath = () => path.join(DATA_DIR, SECRET_FILE);

/** Where the root secret comes from: the environment or the data folder's file. */
export const secretSource = (): "env" | "file" => ((process.env.FUOBE_SECRET ?? "").trim() ? "env" : "file");

let cached: { key: string; secret: Buffer } | null = null;

/** The root secret, creating data/secret.key on first use when FUOBE_SECRET isn't set. */
export function rootSecret(): Buffer {
  const fromEnv = envSecret();
  if (fromEnv) return fromEnv;
  const file = secretPath();
  if (cached?.key === file) return cached.secret;
  let secret: Buffer;
  try {
    secret = fs.readFileSync(file);
  } catch {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    secret = crypto.randomBytes(32);
    try {
      // "wx": never overwrite a key another process wrote first; read theirs instead.
      fs.writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
    } catch {
      secret = fs.readFileSync(file);
    }
  }
  if (secret.length < 32) throw new Error(`${file} is damaged (shorter than 32 bytes). Restore it from a backup, or delete it and start with FUOBE_ACCEPT_NEW_SECRET=1 (everyone signs in again).`);
  cached = { key: file, secret };
  return secret;
}

/** A key for one purpose: HKDF-SHA256(root, salt "fuobe", info). */
export function deriveKey(info: string, length = 32): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootSecret(), "fuobe", info, length));
}

/** What the database remembers about the root secret: never the secret, only a derived value. */
export function secretFingerprint(): string {
  return deriveKey("secret-check/v1", 16).toString("hex");
}

/** Forget the cached file (tests swap data folders and secrets). */
export function resetSecretCache(): void {
  cached = null;
}
