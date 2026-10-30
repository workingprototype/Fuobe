import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR, db, MIGRATION_COUNT } from "../db";
import { secretPath, secretSource } from "../identity/secret";

/**
 * Database snapshots (docs/research/accounts-8.md §7.9, §7.16): a consistent copy of data/fuobe.db with the root
 * secret beside it and a manifest, as data/backups/fuobe-<UTC>-<kind>.{db,secret.key,json}. Taken before accounts
 * arrive ("pre-accounts"), before a mode switch ("before-studio"…) and, with the backup package, on a schedule.
 *
 * A snapshot never carries live credentials: session, verification, step-up, CLI-login and idempotency rows are
 * deleted from the copy (with secure_delete and a VACUUM, so not even free pages keep them), and restoring one
 * signs everyone out. Files are 0600 in a 0700 folder.
 */

/** Tables whose rows are credentials or short-lived request state; packages add theirs. */
export const STRIPPED_TABLES = ["auth_session", "auth_verification", "session_step_up", "cli_connect_requests", "request_keys"];

export interface Snapshot {
  kind: string;
  createdAt: number;
  db: string;
  /** The copy of data/secret.key, or null when the root secret comes from FUOBE_SECRET. */
  secret: string | null;
  manifest: string;
}

export const backupsDir = () => path.join(DATA_DIR, "backups");

const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Copy the database (from `source`, Fuobe's own connection by default) into data/backups. `kind` names why
 * ("pre-accounts", "before-studio", "manual"); letters, digits and dashes only.
 */
export function snapshotDatabase(opts: { kind: string; source?: Database.Database; dir?: string; now?: number }): Snapshot {
  if (!/^[a-z0-9-]{1,40}$/.test(opts.kind)) throw new Error(`Bad snapshot kind "${opts.kind}"`);
  const source = opts.source ?? db();
  const dir = opts.dir ?? backupsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const createdAt = opts.now ?? Date.now();
  const base = path.join(dir, `fuobe-${utc(createdAt)}-${opts.kind}`);
  const tmp = `${base}.db.partial`;
  fs.rmSync(tmp, { force: true });
  // VACUUM INTO writes a consistent, compacted copy from one read transaction, WAL and all.
  source.prepare("VACUUM INTO ?").run(tmp);

  const copy = new Database(tmp);
  try {
    copy.pragma("journal_mode = DELETE");
    copy.pragma("secure_delete = ON");
    const tables = new Set((copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const stripped = STRIPPED_TABLES.filter((t) => tables.has(t));
    copy.transaction(() => {
      for (const t of stripped) copy.prepare(`DELETE FROM "${t}"`).run();
    })();
    copy.exec("VACUUM");
    const migrations = tables.has("_migrations") ? ((copy.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number }).n ?? 0) : 0;
    copy.close();

    const dbFile = `${base}.db`;
    fs.renameSync(tmp, dbFile);
    fs.chmodSync(dbFile, 0o600);

    let secret: string | null = null;
    if (secretSource() === "file" && fs.existsSync(secretPath())) {
      secret = `${base}.secret.key`;
      fs.copyFileSync(secretPath(), secret);
      fs.chmodSync(secret, 0o600);
    }

    const manifest = `${base}.json`;
    const body = {
      kind: opts.kind,
      createdAt: new Date(createdAt).toISOString(),
      database: path.basename(dbFile),
      sha256: sha256(dbFile),
      migrations,
      buildMigrations: MIGRATION_COUNT,
      secret: secret ? path.basename(secret) : secretSource() === "env" ? "FUOBE_SECRET (not copied)" : null,
      stripped,
    };
    fs.writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    return { kind: opts.kind, createdAt, db: dbFile, secret, manifest };
  } catch (e) {
    if (copy.open) copy.close();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
