// The REST client: the API token goes to the Fuobe server only, and every failure becomes a
// sentence that says what to do (start the server, create a token, fix the address).
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A request the server refused or couldn't be reached: `message` is for people, `status` for scripts. */
export class ApiError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Why a fetch never got an answer, in words. */
export function networkMessage(err, url) {
  const code = err?.cause?.code ?? err?.code;
  const host = new URL(url).host;
  if (code === "ECONNREFUSED") return `Can't reach Fuobe at ${url} (connection refused). Is the server running? Start it with "pnpm dev" or "pnpm start" in the Fuobe folder, or point FUOBE_URL at it.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Can't find ${host}. Check the address (FUOBE_URL, --url or "fuobe login").`;
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return `Fuobe at ${url} didn't answer in time. Is the address right, and is the server running?`;
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return `Fuobe at ${url} closed the connection. Try again; if it keeps happening, check the server's log.`;
  if (/certificate|CERT|SSL/i.test(String(code ?? err?.cause?.message ?? ""))) return `Couldn't check ${host}'s HTTPS certificate (${err?.cause?.message ?? code}).`;
  return `Couldn't reach Fuobe at ${url}: ${err?.cause?.message ?? err?.message ?? err}`;
}

/** What an error answer means, with the fix where there is one. */
export function statusMessage(status, body, ctx) {
  // The server's own sentence ({error}), or a short plain-text answer; never an HTML error page.
  const said = body && typeof body === "object" && typeof body.error === "string" ? body.error : typeof body === "string" && body.trim() && body.length < 300 && !/^\s*</.test(body) ? body.trim() : "";
  if (status === 401) {
    return ctx.token
      ? `Fuobe at ${ctx.url} refused the API token${ctx.tokenFrom ? ` (from ${ctx.tokenFrom})` : ""}. It may have been revoked: create a new one in Settings → Security → API tokens (${ctx.url}/settings#security), then run "fuobe login".`
      : ctx.savedTokenFor
        ? `Fuobe at ${ctx.url} has a password, so the CLI needs an API token. The token "fuobe login" saved is for ${ctx.savedTokenFor}, so it isn't sent here: pass --token, set FUOBE_TOKEN, or run "fuobe login --url ${ctx.url}" (create a token in Settings → Security → API tokens, ${ctx.url}/settings#security).`
        : `Fuobe at ${ctx.url} has a password, so the CLI needs an API token. Create one in Settings → Security → API tokens (${ctx.url}/settings#security), then run "fuobe login" or set FUOBE_TOKEN.`;
  }
  if (status === 404 && !said) return `Not found on ${ctx.url}. Is it a Fuobe server, and up to date?`;
  return said || `Fuobe answered HTTP ${status}${status >= 500 ? " — check the server's log" : ""}`;
}

/**
 * @param {{ url: string, token?: string, tokenFrom?: string, savedTokenFor?: string, fetch?: typeof fetch }} target
 */
export function createClient(target) {
  const { url, token } = target;
  const doFetch = target.fetch ?? globalThis.fetch;
  const origin = new URL(url).origin;

  /** Absolute URL for an API path or a server-relative file URL (kept under a path prefix); the token only rides to this server. */
  const resolve = (p) => (/^https?:\/\//i.test(p) ? new URL(p) : new URL(`${url}${p.startsWith("/") ? "" : "/"}${p}`));
  const headersFor = (u, extra = {}) => ({ ...extra, ...(token && u.origin === origin && { Authorization: `Bearer ${token}` }) });

  async function send(method, p, opts = {}) {
    const u = resolve(p);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    const init = { method, headers: headersFor(u, opts.json !== undefined ? { "Content-Type": "application/json" } : {}) };
    if (opts.json !== undefined) init.body = JSON.stringify(opts.json);
    if (opts.form) init.body = opts.form;
    let res;
    try {
      res = await doFetch(u, init);
    } catch (e) {
      throw new ApiError(networkMessage(e, url));
    }
    return res;
  }

  async function bodyOf(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    url,
    resolve: (p) => resolve(p).href,
    /** JSON in, JSON out; throws ApiError with a readable message on any failure. */
    async request(method, p, opts = {}) {
      const res = await send(method, p, opts);
      const body = await bodyOf(res);
      if (!res.ok) throw new ApiError(statusMessage(res.status, body, target), res.status);
      return body;
    },
    /** The raw response (for text such as a SKILL.md). */
    async raw(method, p, opts = {}) {
      const res = await send(method, p, opts);
      if (!res.ok) throw new ApiError(statusMessage(res.status, await bodyOf(res), target), res.status);
      return res;
    },
    /** Stream a file URL (an output) to `dest`; returns the bytes written. */
    async download(fileUrl, dest) {
      const res = await send("GET", fileUrl);
      if (!res.ok || !res.body) throw new ApiError(`Couldn't download ${fileUrl}: ${statusMessage(res.status, await bodyOf(res), target)}`, res.status);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      try {
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw new ApiError(`The download of ${fileUrl} broke off (${e.message}). Run the command again.`);
      }
      fs.renameSync(tmp, dest);
      return fs.statSync(dest).size;
    },
  };
}
