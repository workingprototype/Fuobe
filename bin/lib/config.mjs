// Where the CLI finds its server and token: --url / --token, then FUOBE_URL / FUOBE_TOKEN, then
// the file `fuobe login` writes (~/.config/fuobe/config.json, readable by you only).
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

/**
 * The server and token to use, and where each came from (shown by `fuobe status`).
 * @param {{ url?: string, token?: string }} flags
 * @param {Record<string, string | undefined>} env
 * @param {{ url?: string, token?: string }} config
 */
export function resolveTarget(flags, env, config) {
  const pick = (flag, envName) =>
    flags[flag] ? { value: flags[flag], from: `--${flag}` } : env[envName] ? { value: env[envName], from: envName } : config[flag] ? { value: config[flag], from: "config" } : null;
  const url = pick("url", "FUOBE_URL");
  const token = pick("token", "FUOBE_TOKEN");
  return {
    url: normalizeUrl(url?.value ?? DEFAULT_URL),
    urlFrom: url?.from ?? "default",
    token: token?.value?.trim() || undefined,
    tokenFrom: token?.from,
  };
}
