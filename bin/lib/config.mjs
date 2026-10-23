// Where the CLI finds its server and token: --url / --token, then FUOBE_URL / FUOBE_TOKEN, then
// the file `fuobe login` writes (~/.config/fuobe/config.json, readable by you only). The saved
// token is only ever sent to the saved server.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./args.mjs";

export const DEFAULT_URL = "http://localhost:3000";

/** The config file: FUOBE_CONFIG, else $XDG_CONFIG_HOME/fuobe/config.json, else ~/.config/fuobe/config.json. */
export function configPath(env, home) {
  if (env.FUOBE_CONFIG) return env.FUOBE_CONFIG;
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "fuobe", "config.json");
}

/** @returns {{ url?: string, token?: string }} */
export function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" ? { ...(typeof data.url === "string" && { url: data.url }), ...(typeof data.token === "string" && { token: data.token }) } : {};
  } catch {
    throw new Error(`${file} isn't valid JSON. Run "fuobe login" again, or delete the file.`);
  }
}

/** Save the config readable by you only (the folder 0700, the file 0600, also when it existed). */
export function writeConfig(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function removeConfig(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** "localhost:3000" → "http://localhost:3000"; no trailing slash, no path beyond the server's own. */
export function normalizeUrl(raw) {
  const text = String(raw).trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    throw new UsageError(`“${raw}” isn't a server address — use something like http://localhost:3000`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UsageError(`The server address must start with http:// or https://, not ${u.protocol}//`);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** The saved config's server, normalized (null when the saved address isn't one). */
function savedServer(config) {
  try {
    return normalizeUrl(config.url ?? DEFAULT_URL);
  } catch {
    return null;
  }
}

/**
 * The server and token to use, and where each came from (shown by `fuobe status`). The token
 * `fuobe login` saved belongs to the server it was saved with: a --url or FUOBE_URL that names
 * another server doesn't get it (`savedTokenFor` then says whose it is). --token and FUOBE_TOKEN
 * go to whichever server the command talks to.
 * @param {{ url?: string, token?: string }} flags
 * @param {Record<string, string | undefined>} env
 * @param {{ url?: string, token?: string }} config
 */
export function resolveTarget(flags, env, config) {
  const url = flags.url ? { value: flags.url, from: "--url" } : env.FUOBE_URL ? { value: env.FUOBE_URL, from: "FUOBE_URL" } : config.url ? { value: config.url, from: "config" } : null;
  const resolved = normalizeUrl(url?.value ?? DEFAULT_URL);
  const saved = config.token?.trim() ? savedServer(config) : null;
  const token = flags.token
    ? { value: flags.token, from: "--token" }
    : env.FUOBE_TOKEN
      ? { value: env.FUOBE_TOKEN, from: "FUOBE_TOKEN" }
      : saved && saved === resolved
        ? { value: config.token, from: "config" }
        : null;
  const value = token?.value?.trim() || undefined;
  return {
    url: resolved,
    urlFrom: url?.from ?? "default",
    token: value,
    tokenFrom: value ? token?.from : undefined,
    ...(!value && config.token?.trim() && saved !== resolved && { savedTokenFor: saved ?? String(config.url) }),
  };
}
