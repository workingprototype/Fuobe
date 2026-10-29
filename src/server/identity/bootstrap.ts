import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { readLegacyAuth } from "../auth";
import { snapshotDatabase, type Snapshot } from "../backup/snapshot";
import { DATA_DIR, db, IDENTITY_MIGRATION } from "../db";
import { envMode, envOwnerPassword, envOwnerPasswordName, envSignIn, INSTALL, installValue, legacyPasswordSet, setInstallValue } from "../mode";
import * as ops from "./admin-ops";
import { appendAudit } from "./audit-log";
import { ensureOwnerAuthUser, ownerAuthUserId } from "./owner";
import { PASSWORD_SIGN_IN_MAX } from "./password";
import { resetSecretCache, secretFingerprint } from "./secret";
import { importLegacyToken } from "./tokens";

/**
 * The identity bootstrap, awaited in instrumentation.ts before the server takes requests (docs/research/accounts-8.md
 * §7.16). It runs at every start and does only what is still missing:
 *
 * 1. An existing database that predates accounts: a WAL checkpoint, then a "pre-accounts" snapshot (sessions
 *    stripped), before the identity migration runs.
 * 2. The root secret (data/secret.key or FUOBE_SECRET) and its fingerprint: a server that finds a different key
 *    than its data was made with refuses to start, unless FUOBE_ACCEPT_NEW_SECRET=1.
 * 3. Install values: Personal; sign-in on when the install had a password (auth.json or FUOBE_PASSWORD), else off
 *    (Just me on this computer); setup done. A fresh data folder boots exactly as before accounts.
 * 4. auth.json, once: its password becomes the owner's (the old salt:hash verifies and is rewritten at the next
 *    sign-in) and its API tokens become legacy Full tokens with the same hashes, so the CLI and MCP keep working.
 *    The file stays in place, unread, for one release as a rollback aid. Old session cookies are not accepted:
 *    password installs sign in once more.
 * 5. FUOBE_PASSWORD (or FUOBE_OWNER_PASSWORD), at every start: the owner's break-glass password. A changed value
 *    replaces the old one and signs every browser out. It stays the owner's password after the variable is unset
 *    (sign-in stays on), and can then be changed or removed in Settings → Security.
 * 6. FUOBE_SIGNIN=on needs a password to sign in with: without one the server doesn't start.
 *
 * A bad value stops the server with one line naming it (StartupError), never a stack trace.
 */

export class StartupError extends Error {}

export interface BootstrapReport {
  snapshot: Snapshot | null;
  importedPassword: boolean;
  importedTokens: number;
  syncedEnvPassword: boolean;
  signin: "on" | "off";
}

const SYSTEM: ops.By = { actorId: null, via: "system" };

/** Before the identity migration: is there an older database to keep a copy of? */
function preAccountsSnapshot(): Snapshot | null {
  const file = path.join(DATA_DIR, "fuobe.db");
  if (globalThis.__fuobeDb || !fs.existsSync(file)) return null;
  const raw = new Database(file);
  try {
    const hasMigrations = raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get();
    if (!hasMigrations) return null;
    if (raw.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(IDENTITY_MIGRATION)) return null;
    raw.pragma("wal_checkpoint(TRUNCATE)");
    return snapshotDatabase({ kind: "pre-accounts", source: raw });
  } finally {
    raw.close();
  }
}

function checkModeEnv(): void {
  const raw = (process.env.FUOBE_MODE ?? "").trim();
  if (!raw) return;
  const mode = envMode();
  if (!mode) throw new StartupError(`FUOBE_MODE=${raw} isn't a mode: use personal (studio and platform arrive with accounts).`);
  if (mode === "studio") throw new StartupError("FUOBE_MODE=studio needs the first-run setup, which isn't in this version yet. Use FUOBE_MODE=personal.");
  if (mode === "platform" && process.env.FUOBE_DEV_PLATFORM !== "1") {
    throw new StartupError("FUOBE_MODE=platform isn't ready in this version yet. For development only, set FUOBE_DEV_PLATFORM=1.");
  }
}

/** FUOBE_PASSWORD must fit the sign-in form (it did before accounts too), or nobody could ever type it in. */
function checkEnvPassword(): void {
  const pw = envOwnerPassword();
  if (pw.length > PASSWORD_SIGN_IN_MAX) {
    throw new StartupError(`${envOwnerPasswordName()} is longer than ${PASSWORD_SIGN_IN_MAX} characters, so it could never be typed in to sign in. Use a shorter one.`);
  }
}

function checkSecret(): void {
  resetSecretCache();
  let fingerprint: string;
  try {
    fingerprint = secretFingerprint();
  } catch (e) {
    // A FUOBE_SECRET that is too short, or a damaged data/secret.key: one line naming it.
    throw new StartupError((e as Error).message);
  }
  const stored = installValue(INSTALL.secretCheck);
  if (stored === fingerprint) return;
  if (stored && process.env.FUOBE_ACCEPT_NEW_SECRET !== "1") {
    throw new StartupError(
      "The secret key doesn't match this data folder (data/secret.key or FUOBE_SECRET changed). Restore the original key, or start once with FUOBE_ACCEPT_NEW_SECRET=1 to accept the new one: everyone signs in again.",
    );
  }
  setInstallValue(INSTALL.secretCheck, fingerprint);
  if (stored) {
    // Sessions were signed with the old key; they are dead anyway.
    db().prepare("DELETE FROM auth_session").run();
    appendAudit({ action: "install.secret_accepted", via: "system" });
  }
}

/** Run the bootstrap. Throws StartupError when the server must not start. */
export async function bootstrapIdentity(): Promise<BootstrapReport> {
  checkModeEnv();
  checkEnvPassword();
  const snapshot = preAccountsSnapshot();
  db();
  checkSecret();

  const legacy = readLegacyAuth();
  const envPassword = envOwnerPassword();
  if (installValue(INSTALL.mode) === null) setInstallValue(INSTALL.mode, "personal");
  if (installValue(INSTALL.setupState) === null) setInstallValue(INSTALL.setupState, "done");
  if (installValue(INSTALL.signin) === null) setInstallValue(INSTALL.signin, legacyPasswordSet() || envPassword ? "on" : "off");

  const report: BootstrapReport = { snapshot, importedPassword: false, importedTokens: 0, syncedEnvPassword: false, signin: "off" };

  // auth.json, once.
  if (legacy && installValue(INSTALL.legacyImported) === null) {
    if (legacy.password) {
      const id = await ensureOwnerAuthUser("bootstrap-import", SYSTEM);
      if (!(await ops.hasPassword(id))) {
        await ops.setPasswordFor(id, { hash: legacy.password }, SYSTEM);
        report.importedPassword = true;
      }
      db().prepare("UPDATE users SET source = 'legacy', updated_at = ? WHERE id = 'u_owner' AND source = 'setup'").run(Date.now());
    }
    for (const t of legacy.tokens) if (importLegacyToken("u_owner", t)) report.importedTokens++;
    setInstallValue(INSTALL.legacyImported, String(Date.now()));
    appendAudit({ action: "install.legacy_imported", via: "system", meta: { password: report.importedPassword, tokens: report.importedTokens } });
  }

  // The break-glass password, at every start.
  if (envPassword) {
    const id = await ensureOwnerAuthUser(ownerAuthUserId() ? "claim-owner" : "bootstrap-import", SYSTEM);
    if (!(await ops.verifyPasswordFor(id, envPassword))) {
      const had = await ops.hasPassword(id);
      await ops.setPasswordFor(id, envPassword, SYSTEM);
      if (had) await ops.revokeAllSessions(id, SYSTEM);
      report.syncedEnvPassword = true;
      db().prepare("UPDATE users SET source = 'env', updated_at = ? WHERE id = 'u_owner' AND source IN ('setup', 'legacy')").run(Date.now());
    }
    setInstallValue(INSTALL.signin, "on");
  }

  // FUOBE_SIGNIN=on with nothing to sign in with would turn every visitor away, the owner too.
  if (envSignIn() === true) {
    const id = ownerAuthUserId();
    if (!id || !(await ops.hasPassword(id))) {
      throw new StartupError("FUOBE_SIGNIN=on needs the owner's password: set FUOBE_PASSWORD as well, or set a password in Settings → Security before turning FUOBE_SIGNIN on.");
    }
  }

  report.signin = installValue(INSTALL.signin) === "on" ? "on" : "off";
  return report;
}

/** The bootstrap as the server runs it (instrumentation.ts): a few lines for the terminal, or one line and exit. */
export async function startIdentity(): Promise<void> {
  try {
    const report = await bootstrapIdentity();
    if (report.snapshot) console.log(`Fuobe saved a copy of the database before accounts: ${report.snapshot.db}`);
    if (report.importedPassword) console.log("Fuobe moved the password to accounts: sign in once more in each browser.");
    if (report.syncedEnvPassword) {
      console.log(`Fuobe set the owner's password from ${envOwnerPasswordName()}. It stays the password if you unset the variable: change or remove it in Settings → Security.`);
    }
  } catch (e) {
    console.error(e instanceof StartupError ? `Fuobe can't start: ${e.message}` : e);
    process.exit(1);
  }
}
