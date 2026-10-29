import "server-only";
import crypto from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashes (docs/research/accounts-8.md §7.2). New hashes are scrypt with N=2^15, r=8, p=3 and a 64-byte key
 * (the OWASP table's choice), stored as `scrypt$v2$N$r$p$salt$hash` with base64url salt and hash, so the cost can
 * rise later without losing old hashes. The pre-accounts `salt:hash` from auth.json (hex; N=2^14, r=8, p=1, 32
 * bytes) still verifies and is rewritten in the new format on the next successful sign-in (needsRehash).
 *
 * Better Auth calls hashPassword and verifyPassword for every password it handles (emailAndPassword.password).
 */

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const V2 = { N: 2 ** 15, r: 8, p: 3, keyLength: 64 } as const;
const LEGACY = { N: 2 ** 14, r: 8, p: 1, keyLength: 32 } as const;
// scrypt needs 128·N·r bytes; Node's default limit (32 MiB) is exactly that for N=2^15, r=8, so give it room.
const MAXMEM = 128 * 1024 * 1024;

/** The first thing wrong with a new password, in words a person can act on; null when it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, V2.keyLength, { N: V2.N, r: V2.r, p: V2.p, maxmem: MAXMEM });
  return `scrypt$v2$${V2.N}$${V2.r}$${V2.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const LEGACY_FORMAT = /^([0-9a-f]{32}):([0-9a-f]{64})$/i;

/** Which format a stored hash is in. */
export function hashFormat(stored: string): "v2" | "legacy" | "unknown" {
  if (stored.startsWith("scrypt$v2$")) return "v2";
  return LEGACY_FORMAT.test(stored) ? "legacy" : "unknown";
}

/** Whether a hash that just verified should be rewritten in the current format. */
export const needsRehash = (stored: string): boolean => hashFormat(stored) !== "v2";

const same = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

// Bounds on a stored v2 hash's parameters, so a damaged row can't ask for gigabytes of memory.
const sane = (N: number, r: number, p: number, len: number) => Number.isInteger(Math.log2(N)) && N >= 2 ** 14 && N <= 2 ** 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16 && len >= 32 && len <= 128;

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    if (hash.startsWith("scrypt$v2$")) {
      const [, , n, r, p, salt, key] = hash.split("$");
      const N = Number(n), R = Number(r), P = Number(p);
      const expected = Buffer.from(key ?? "", "base64url");
      if (!salt || !sane(N, R, P, expected.length)) return false;
      const got = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N, r: R, p: P, maxmem: MAXMEM });
      return same(got, expected);
    }
    const legacy = LEGACY_FORMAT.exec(hash);
    if (legacy) {
      // auth.json hashed the password exactly as typed (no normalisation): keep that, or old passwords stop working.
      const got = await scrypt(password, Buffer.from(legacy[1], "hex"), LEGACY.keyLength, { N: LEGACY.N, r: LEGACY.r, p: LEGACY.p, maxmem: MAXMEM });
      return same(got, Buffer.from(legacy[2], "hex"));
    }
  } catch {
    // An unreadable hash never signs anyone in.
  }
  return false;
}
