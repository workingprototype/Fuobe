import "server-only";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetch a file from a URL someone handed us (API callers, MCP clients, the Assist LLM) without
 * letting it reach this machine's own network: loopback, private, link-local (cloud metadata),
 * CGNAT and multicast addresses are refused. The check runs on the address the socket actually
 * connects to (so DNS can't swap it after the check), and again on every redirect.
 * Set FUOBE_ALLOW_PRIVATE_URLS=1 to allow private addresses (a LAN-only install that wants them).
 */

export const MAX_REMOTE_BYTES = 200 * 1024 * 1024;

export class RemoteFetchError extends Error {}

const v4 = (ip: string): number[] => ip.split(".").map(Number);

function blockedV4(ip: string): boolean {
  const [a, b, c] = v4(ip);
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (and Alibaba's metadata service)
    (a === 169 && b === 254) || // link-local: cloud metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 address to its 8 hextets (handles "::" and an embedded IPv4 tail). */
function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = v4(tail[1]);
    s = s.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const h = head ? head.split(":") : [];
  const r = rest !== undefined ? (rest ? rest.split(":") : []) : [];
  const fill = rest !== undefined ? 8 - h.length - r.length : 0;
  const all = [...h, ...Array(Math.max(0, fill)).fill("0"), ...r].map((x) => parseInt(x || "0", 16));
  return all.length === 8 && all.every((n) => Number.isFinite(n)) ? all : null;
}

function blockedV6(ip: string): boolean {
  const h = hextets(ip);
  if (!h) return true;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (h.slice(0, 7).every((x) => x === 0)) return true; // :: and ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return blockedV4(embedded(h[6], h[7])); // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b) return blockedV4(embedded(h[6], h[7])); // NAT64
  if (h[0] === 0x2002) return blockedV4(embedded(h[1], h[2])); // 6to4
  return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0 || (h[0] & 0xff00) === 0xff00;
}

/** True for addresses on this machine or its private networks (never fetched for a caller). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return blockedV4(ip);
  if (net.isIPv6(ip)) return blockedV6(ip);
  return true;
}

export interface RemoteFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests: resolve host names without DNS. */
  resolve?: (host: string) => Promise<string[]>;
  /** Tests: which addresses to refuse (default: {@link isPrivateAddress}). */
  blocked?: (ip: string) => boolean;
}

const allowPrivate = () => process.env.FUOBE_ALLOW_PRIVATE_URLS === "1";

function refuse(host: string): RemoteFetchError {
  return new RemoteFetchError(`Fuobe won't fetch ${host}: it points to this machine or a private network. Upload the file instead.`);
}

/** GET a public http(s) URL into memory, with a timeout, a size cap and checked redirects. */
export async function fetchRemote(url: string, o: RemoteFetchOptions = {}): Promise<{ data: Buffer; contentType: string | null; url: string }> {
  const maxBytes = o.maxBytes ?? MAX_REMOTE_BYTES;
  const blocked = o.blocked ?? ((ip: string) => !allowPrivate() && isPrivateAddress(ip));
  const resolve = o.resolve ?? (async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address));
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  let current = new URL(url);
  for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new RemoteFetchError(`Only http(s) links can be fetched, not ${current.protocol}`);
    if (current.username || current.password) throw new RemoteFetchError("Links with a user name or password aren't fetched");
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && blocked(host)) throw refuse(current.host);
    const res = await get(current, { host, maxBytes, deadline, resolve, blocked });
    if (res.location) {
      current = new URL(res.location, current);
      continue;
    }
    return { data: res.data!, contentType: res.contentType, url: current.toString() };
  }
  throw new RemoteFetchError(`Too many redirects fetching ${url}`);
}

function get(
  url: URL,
  o: { host: string; maxBytes: number; deadline: number; resolve: (host: string) => Promise<string[]>; blocked: (ip: string) => boolean },
): Promise<{ location?: string; data?: Buffer; contentType: string | null }> {
  // Checked at connect time, on the address actually used.
  const lookup: net.LookupFunction = (hostname, options, cb) => {
    o.resolve(hostname).then(
      (addrs) => {
        if (!addrs.length) return cb(new RemoteFetchError(`Couldn't resolve ${hostname}`), "", 4);
        if (addrs.some(o.blocked)) return cb(refuse(hostname), "", 4);
        if (options.all) return (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, addrs.map((a) => ({ address: a, family: net.isIPv6(a) ? 6 : 4 })));
        cb(null, addrs[0], net.isIPv6(addrs[0]) ? 6 : 4);
      },
      (e: Error) => cb(e, "", 4),
    );
  };
  const left = o.deadline - Date.now();
  if (left <= 0) return Promise.reject(new RemoteFetchError(`Timed out fetching ${url.host}`));
  return new Promise((resolveOuter, rejectOuter) => {
    // A hard deadline for the whole download, not just an idle timeout.
    const timer = setTimeout(() => {
      req.destroy();
      reject(new RemoteFetchError(`Timed out fetching ${url.host}`));
    }, left);
    const resolvePromise = (v: { location?: string; data?: Buffer; contentType: string | null }) => {
      clearTimeout(timer);
      resolveOuter(v);
    };
    const reject = (e: Error) => {
      clearTimeout(timer);
      rejectOuter(e);
    };
    const req = (url.protocol === "https:" ? https : http).request(url, { method: "GET", lookup, headers: { "User-Agent": "Fuobe", Accept: "*/*" }, timeout: left }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolvePromise({ location: res.headers.location, contentType: null });
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new RemoteFetchError(`Could not fetch ${url.toString()}: ${status}`));
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > o.maxBytes) {
        res.destroy();
        return reject(new RemoteFetchError(`That file is over ${Math.round(o.maxBytes / 1024 / 1024)} MB`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > o.maxBytes) {
          res.destroy();
          req.destroy();
          reject(new RemoteFetchError(`That file is over ${Math.round(o.maxBytes / 1024 / 1024)} MB`));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolvePromise({ data: Buffer.concat(chunks), contentType: res.headers["content-type"]?.split(";")[0].trim() || null }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new RemoteFetchError(`Timed out fetching ${url.host}`)));
    req.on("error", (e) => reject(e instanceof RemoteFetchError ? e : new RemoteFetchError(`Could not fetch ${url.toString()}: ${e.message}`)));
    req.end();
  });
}
