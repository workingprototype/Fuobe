import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db } from "./db";

/**
 * How this Fuobe runs (docs/research/accounts-8.md §7.9): the mode (Personal, In-house studio or Platform), whether
 * sign-in is on, and the setup state, as install values in the `settings` table (outside SETTINGS, so the settings
 * API never lists or writes them). UI and API gates read feature flags, never the mode string: each package
 * registers its flags as functions of (mode, sign-in, install values).
 *
 * Until the first-run setup package (acc-14), a fresh data folder boots as Personal with sign-in off and setup done:
 * "Just me on this computer", exactly as before accounts. A password (auth.json, Settings → Security or
 * FUOBE_PASSWORD) means Personal with sign-in. Studio is not selectable yet, and Platform is a development mode
 * (FUOBE_DEV_PLATFORM=1) until the launch package (acc-57).
 */

export type InstallMode = "personal" | "studio" | "platform";
export const INSTALL_MODES: readonly InstallMode[] = ["personal", "studio", "platform"];

/** Install values this package reads and writes (more arrive with their packages). */
export const INSTALL = {
  mode: "install.mode",
  signin: "install.signin",
  setupState: "setup.state",
  siteUrl: "install.site_url",
  name: "install.name",
  /** "1" lets Better Auth create people without a Fuobe intent: set only by the meter package (acc-8). */
  multiUser: "accounts.multi_user",
  /** Bumped whenever sign-in settings change: getAuth() rebuilds Better Auth on the next call. */
  configVersion: "identity.config_version",
  /** HKDF fingerprint of the root secret (src/server/identity/secret.ts): a server finding another key refuses to start. */
  secretCheck: "identity.secret_check",
  /** When the bootstrap imported auth.json (its password and API tokens), so it does so once. */
  legacyImported: "identity.legacy_imported",
} as const;

export function installValue(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setInstallValue(key: string, value: string | null): void {
  if (value === null) db().prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Sign-in settings changed (password set or removed, site address, trusted proxies): the next getAuth() rebuilds. */
export function bumpIdentityConfig(): void {
  setInstallValue(INSTALL.configVersion, String(Number(installValue(INSTALL.configVersion) ?? "0") + 1));
}

/** FUOBE_MODE as written, or null when unset. An unknown value is an error the bootstrap reports. */
export function envMode(): InstallMode | null {
  const v = (process.env.FUOBE_MODE ?? "").trim().toLowerCase();
  return v ? ((INSTALL_MODES as readonly string[]).includes(v) ? (v as InstallMode) : null) : null;
}

export function installMode(): InstallMode {
  const fromEnv = envMode();
  if (fromEnv) return fromEnv;
  const stored = installValue(INSTALL.mode);
  return stored && (INSTALL_MODES as readonly string[]).includes(stored) ? (stored as InstallMode) : "personal";
}

const ON = new Set(["1", "on", "true", "yes"]);
const OFF = new Set(["0", "off", "false", "no"]);

/** FUOBE_SIGNIN=on|off, or null when unset (or unreadable). */
export function envSignIn(): boolean | null {
  const v = (process.env.FUOBE_SIGNIN ?? "").trim().toLowerCase();
  return ON.has(v) ? true : OFF.has(v) ? false : null;
}

/** The break-glass owner password (FUOBE_OWNER_PASSWORD, or its older name FUOBE_PASSWORD). Synced at every boot. */
export function envOwnerPassword(): string {
  return process.env.FUOBE_OWNER_PASSWORD || process.env.FUOBE_PASSWORD || "";
}

/** Which variable the break-glass password came from, for messages. */
export function envOwnerPasswordName(): "FUOBE_OWNER_PASSWORD" | "FUOBE_PASSWORD" {
  return process.env.FUOBE_OWNER_PASSWORD ? "FUOBE_OWNER_PASSWORD" : "FUOBE_PASSWORD";
}

/** A password in the pre-accounts auth.json: the install had sign-in before this build. */
export function legacyPasswordSet(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "auth.json"), "utf8")) as { password?: unknown };
    return typeof data.password === "string" && data.password.length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether people sign in. FUOBE_SIGNIN wins; a break-glass password turns it on; then the stored value. With nothing
 * stored yet (a build whose bootstrap hasn't run, or a test), a password in auth.json still means on: never open.
 */
export function signInOn(): boolean {
  const env = envSignIn();
  if (env !== null) return env;
  if (envOwnerPassword()) return true;
  if (installMode() !== "personal") return true;
  const stored = installValue(INSTALL.signin);
  if (stored !== null) return ON.has(stored);
  return legacyPasswordSet();
}

export type SetupState = "fresh" | "in-progress" | "done";

/** Until acc-14 there is no setup wizard: every install reads as done, and the proxy's setup gate stays inert. */
export function setupState(): SetupState {
  const v = installValue(INSTALL.setupState);
  return v === "fresh" || v === "in-progress" ? v : "done";
}

/** The public site address (FUOBE_SITE_URL, else Settings), without a trailing slash; null when unset. */
export function siteUrl(): string | null {
  const raw = (process.env.FUOBE_SITE_URL || installValue(INSTALL.siteUrl) || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function installName(): string {
  return (process.env.FUOBE_INSTALL_NAME || installValue(INSTALL.name) || "Fuobe").trim() || "Fuobe";
}

// ---------------------------------------------------------------------------
// Feature flags

/** Core flags (§7.9). Mode packages register more (passkeys, twoStep, sso, plans, payments…). */
export type CoreFlag = "signInRequired" | "signUp" | "teams" | "invites" | "admin" | "limits" | "ownKeys" | "teamKeys" | "credits" | "enterprise";

export type FlagFn = (mode: InstallMode, signin: boolean, value: (key: string) => string | null) => boolean;

const studioOrPlatform: FlagFn = (mode) => mode !== "personal";

/**
 * The registry. Core flags are what each mode turns on; the packages that build a feature refine its flag (sign-up
 * policy, plans). A flag nobody registered reads as off.
 */
const FEATURES = new Map<string, FlagFn>([
  ["signInRequired", (mode, signin) => mode !== "personal" || signin],
  ["signUp", studioOrPlatform],
  ["teams", studioOrPlatform],
  ["invites", studioOrPlatform],
  ["admin", studioOrPlatform],
  ["limits", studioOrPlatform],
  ["ownKeys", (mode) => mode === "studio"],
  ["teamKeys", studioOrPlatform],
  ["credits", (mode) => mode === "platform"],
  ["enterprise", (mode) => mode === "studio"],
]);

/** Add or replace a flag (a package's own, or a refinement of a core one). */
export function registerFeature(name: string, fn: FlagFn): void {
  FEATURES.set(name, fn);
}

export type Flags = Record<CoreFlag, boolean> & Record<string, boolean>;

export function features(): Flags {
  const mode = installMode();
  const signin = signInOn();
  const out: Record<string, boolean> = {};
  for (const [name, fn] of FEATURES) out[name] = fn(mode, signin, installValue);
  return out as Flags;
}

/** The one flag the proxy reads on every request. */
export const signInRequired = (): boolean => features().signInRequired;
