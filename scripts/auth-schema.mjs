#!/usr/bin/env node
/**
 * Better Auth's tables, frozen as SQL for Fuobe's migrations (docs/research/accounts-8.md §5.2, §7.1).
 *
 * Fuobe never lets Better Auth change the database at run time: its tables are created by an ordinary migration in
 * src/server/db.ts, with exactly the SQL Better Auth would have run. This prints that SQL.
 *
 *   node scripts/auth-schema.mjs                  the full SQL for an empty database (what the identity base froze)
 *   node scripts/auth-schema.mjs --db <file>      what that database still lacks: append it as a new migration
 *   node scripts/auth-schema.mjs --db <file> --check
 *                                                 exit 1 when anything is missing (the schema-guard test does the
 *                                                 same against the running configuration)
 *
 * The table names and plugin list come from src/server/identity/schema.ts, the file auth.ts reads them from. A
 * package that loads a plugin with tables adds it there and in PLUGINS below.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getMigrations } from "better-auth/db/migration";

// schema.ts is plain TypeScript Node can strip; it only warns that package.json names no module type.
process.removeAllListeners("warning");
process.on("warning", (w) => w.code !== "MODULE_TYPELESS_PACKAGE_JSON" && console.warn(w));
const { AUTH_PLUGINS_WITH_TABLES, AUTH_TABLES } = await import("../src/server/identity/schema.ts");

/** Plugin id → a factory with the options that matter for its tables. Empty until a package loads one. */
const PLUGINS = {};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = value("--db");
if (file && !fs.existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(2);
}
const missing = AUTH_PLUGINS_WITH_TABLES.filter((id) => !PLUGINS[id]);
if (missing.length) {
  console.error(`scripts/auth-schema.mjs doesn't know how to load: ${missing.join(", ")}. Add them to PLUGINS.`);
  process.exit(2);
}

const database = new Database(file ?? ":memory:", { readonly: !!file });
const options = {
  database,
  telemetry: { enabled: false },
  logger: { disabled: true },
  user: { modelName: AUTH_TABLES.user },
  session: { modelName: AUTH_TABLES.session },
  account: { modelName: AUTH_TABLES.account },
  verification: { modelName: AUTH_TABLES.verification },
  rateLimit: { enabled: true, storage: "database", modelName: AUTH_TABLES.rateLimit },
  emailAndPassword: { enabled: true },
  plugins: AUTH_PLUGINS_WITH_TABLES.map((id) => PLUGINS[id]()),
};

const m = await getMigrations(options, { throwOnUnsafe: false });
const pending = m.toBeCreated.length + m.toBeAdded.length + m.toBeAddedIndexes.length;
const sql = pending ? (await m.compileMigrations()).trim() : "";
database.close();

const self = path.relative(process.cwd(), fileURLToPath(import.meta.url));
if (flag("--check")) {
  if (pending) {
    console.error(`Better Auth wants schema changes in ${file ?? "an empty database"}:\n\n${sql}\n\nFreeze them in a new migration (node ${self} --db ${file ?? "<file>"}).`);
    process.exit(1);
  }
  console.log("Better Auth's tables match.");
} else if (!pending) {
  console.log(`-- Nothing to freeze: ${file ?? "the database"} already has every table and column Better Auth uses.`);
} else {
  console.log(sql);
  for (const u of m.unsafeChanges) console.error(`warning: ${u}`);
}
