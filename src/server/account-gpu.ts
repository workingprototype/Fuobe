import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { accountGpu, type Account, type AccountGpu } from "./auth";
import { PROVIDERS } from "./providers";
import { blockedForAccounts, fetchPublic, isLoopbackGpu } from "./remote-fetch";
import { isInstallHost, REFUSED_ADDRESS } from "./gpu/hosts";

/**
 * "Your GPU" (public sign-up): the ComfyUI an account connects, where its runs go. The server calls
 * it, so it must be reachable from the internet (a Cloudflare Tunnel or ngrok in front of a local
 * ComfyUI). Addresses on this machine or a private network are refused, and so is the install's own
 * ComfyUI. A ComfyUI on the visitor's own computer (localhost) is the browser's to reach, never sent here.
 */

export class GpuError extends Error {}

const allowPrivate = () => process.env.FUOBE_ALLOW_PRIVATE_URLS === "1";

export const LOCAL_GPU_MESSAGE =
  "That address is on your own computer or network, and this server can't reach it. Put a tunnel in front of your ComfyUI (cloudflared tunnel --url http://localhost:8188, or ngrok http 8188) and paste the https address it prints.";

/** An address as stored and compared: origin and path, no trailing slash. */
const normal = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, "")}`;

/** Check an account's ComfyUI address: http(s), a public host, not the install's own ComfyUI. Returns it normalised. */
export async function checkGpuAddress(raw: string, o: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new GpuError("Enter the full address, like https://your-tunnel.trycloudflare.com");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GpuError("Use an http or https address");
  if (u.username || u.password) throw new GpuError("Put the token in the token field, not in the address");
  if (u.search || u.hash) throw new GpuError("Use the address without ? or #");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || !host.includes(".");
  // A stand-in ComfyUI on this machine is allowed in tests and `next dev` only (remote-fetch.ts loopbackGpuPort).
  if (!isLoopbackGpu(u)) {
    if (local && !net.isIP(host) && !allowPrivate()) throw new GpuError(LOCAL_GPU_MESSAGE);
    const resolve = o.resolve ?? (async (h: string) => (await dns.lookup(h, { all: true, verbatim: true })).map((a) => a.address));
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : await resolve(host);
    } catch {
      throw new GpuError(`Couldn't find ${host}. Check the address (is the tunnel running?)`);
    }
    if (!addrs.length) throw new GpuError(`Couldn't find ${host}. Check the address (is the tunnel running?)`);
    // Private networks, this machine's own addresses (loopback too, even with FUOBE_ALLOW_PRIVATE_URLS), wrapped IPv4.
    if (addrs.some(blockedForAccounts)) throw new GpuError(LOCAL_GPU_MESSAGE);
  }
  const url = normal(u);
  // The install's own ComfyUI on any scheme, port or path (ComfyUI answers every route under /api too), compared by
  // host. One message for every such refusal, so it never confirms a guessed address.
  // (The tests' and `next dev`'s stand-in on this machine is on a port of its own: loopbackGpuPort.)
  if (!isLoopbackGpu(u) && isInstallHost(url)) throw new GpuError(REFUSED_ADDRESS);
  return url;
}

export interface GpuInfo {
  device?: string;
  vramBytes?: number;
  version?: string;
}

/** Ask the account's ComfyUI for /system_stats, the check the studio makes of its own. */
export async function testGpu(gpu: AccountGpu, o: { resolve?: (host: string) => Promise<string[]>; timeoutMs?: number } = {}): Promise<GpuInfo> {
  let res: Response;
  try {
    res = await fetchPublic(`${gpu.url}/system_stats`, { headers: gpu.token ? { Authorization: `Bearer ${gpu.token}` } : {} }, { timeoutMs: o.timeoutMs ?? 10_000, deadlineMs: (o.timeoutMs ?? 10_000) + 5_000, maxBytes: 1 * 2 ** 20, resolve: o.resolve });
  } catch (e) {
    throw new GpuError(`Couldn't reach your ComfyUI at ${gpu.url}: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new GpuError(`Your ComfyUI refused the request (HTTP ${res.status}): check the token`);
  if (!res.ok) throw new GpuError(`Your ComfyUI answered HTTP ${res.status}. Is the tunnel pointing at ComfyUI?`);
  const s = (await res.json().catch(() => null)) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] } | null;
  if (!s?.system) throw new GpuError("That address answers, but not as ComfyUI");
  const dev = s.devices?.[0];
  return { device: dev?.name, vramBytes: typeof dev?.vram_total === "number" ? dev.vram_total : undefined, version: s.system.comfyui_version };
}

declare global {
  /** Each account's GPU as last asked (Your GPU: online or not, and what it is), for the status strip. */
  var __fuobeAccountGpus: Map<string, { url: string; at: number; online: boolean; info: GpuInfo }> | undefined;
}

/** Is the account's ComfyUI answering, and what is it? Asked at most every 30 s per account. */
export async function gpuState(id: string, gpu: AccountGpu): Promise<{ online: boolean } & GpuInfo> {
  const cache = (globalThis.__fuobeAccountGpus ??= new Map());
  const hit = cache.get(id);
  if (hit && hit.url === gpu.url && Date.now() - hit.at < 30_000) return { online: hit.online, ...hit.info };
  let online = false;
  let info: GpuInfo = hit?.url === gpu.url ? hit.info : {};
  try {
    info = await testGpu(gpu, { timeoutMs: 5000 });
    online = true;
  } catch {}
  cache.set(id, { url: gpu.url, at: Date.now(), online, info });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return { online, ...info };
}

/** What a visitor's status strip shows (GET /api/status): its own GPU, never the install's providers, servers or Demo mode. */
export interface VisitorView {
  kind: "guest" | "account";
  gpu: { connected: boolean; online?: boolean; device?: string; vramBytes?: number };
}

/**
 * GET /api/status for a guest or an account: ComfyUI is its own GPU (taken as there until it has one,
 * so the studios offer Generate and the run asks it to connect one), the open engine, no Demo mode,
 * and nothing of the install's own servers, keys or addresses.
 */
export async function visitorStatus(account: Account | null) {
  const gpu = account ? accountGpu(account.id) : null;
  const live = account && gpu ? await gpuState(account.id, gpu) : null;
  const viewer: VisitorView = {
    kind: account ? "account" : "guest",
    gpu: gpu ? { connected: true, online: !!live?.online, ...(live?.device && { device: live.device }), ...(live?.vramBytes && { vramBytes: live.vramBytes }) } : { connected: false },
  };
  return {
    providers: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, { label: p.id === "comfyui" ? "Your GPU" : p.label, configured: p.id === "comfyui" ? (gpu ? !!live?.online : true) : false }])),
    demoMode: "off",
    engineMode: "open",
    cloudProvider: "auto",
    onboarded: true,
    viewer,
  };
}
