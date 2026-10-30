/**
 * The parts of Better Auth's options that decide its tables (docs/research/accounts-8.md §7.1): table names and
 * the plugins whose tables are frozen in Fuobe's migrations. Plain data with no imports, so scripts/auth-schema.mjs
 * reads the same values as src/server/identity/auth.ts. A package that loads a plugin with tables (two-factor,
 * passkey, sso) adds its id here and to the script's plugin map, runs the script against a database and appends
 * the SQL it prints as that package's migration.
 */

export const AUTH_TABLES = {
  user: "auth_user",
  session: "auth_session",
  account: "auth_account",
  verification: "auth_verification",
  rateLimit: "auth_rate_limit",
} as const;

/** Plugins whose tables exist in the migrations (none in the identity base). */
export const AUTH_PLUGINS_WITH_TABLES: readonly string[] = [];
