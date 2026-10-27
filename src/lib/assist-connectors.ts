/**
 * Assist's custom MCP connectors (Supercomputer's "Custom MCP connector (HTTP header)"): a name, a
 * remote MCP server URL, an optional token and, optionally, the only tools Claude may call on it.
 * Claude reaches them through the Messages API's MCP connector, from Anthropic's servers — Fuobe
 * itself never connects to them, and the browser never sees the token (or the parts of the URL that
 * often carry a key: its query and any id-like path segment).
 *
 * Connector tools run inside Claude's reply, on Anthropic's side: Fuobe's approval cards can't stop
 * them. The allow-list is how a user keeps a connector to tools they trust.
 */

export const MAX_CONNECTORS = 20;
export const MAX_CONNECTOR_URL = 2048;
export const MAX_CONNECTOR_NAME = 60;
export const MAX_CONNECTOR_TOKEN = 4096;
export const MAX_CONNECTOR_TOOLS = 64;

/** A connector as the browser sees it: the token and the URL's secret-looking parts masked. */
export interface ConnectorView {
  id: string;
  name: string;
  /** The name Claude and the chat use for it (letters, numbers, - and _). */
  slug: string;
  /** The URL with its query, fragment and id-like path segments masked. */
  url: string;
  enabled: boolean;
  hasToken: boolean;
  /** The token masked ("sk-a••••9f3c", or only its last 2 characters when it's short), empty when there's none. */
  token: string;
  /** The only tools Claude may call on it; null: every tool the server lists. */
  tools: string[] | null;
  /** Why Claude may not reach it (a local or private address), shown as a warning. */
  warning?: string;
  createdAt: number;
  updatedAt: number;
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)/;

const isLoopback = (host: string) => LOOPBACK.test(host) || host.endsWith(".localhost");
const isPrivateHost = (host: string) => isLoopback(host) || PRIVATE_V4.test(host) || /^\[(f[cd]|fe[89ab])/i.test(host) || /\.(local|internal|lan|home\.arpa)$/i.test(host);

/**
 * Check a connector URL someone typed: https, or plain http only for this machine (localhost) unless
 * FUOBE_ALLOW_PRIVATE_URLS=1; no user name or password in it (the token has its own field); at most
 * 2,048 characters. Returns the normalised URL and, for a local or private address, a warning: Claude
 * connects from Anthropic's servers, so such an address only works through a public tunnel.
 */
export function checkConnectorUrl(raw: string, allowPrivate = false): { url: string; warning?: string } | { error: string } {
  const s = raw.trim();
  if (!s) return { error: "Enter the connector's URL" };
  if (s.length > MAX_CONNECTOR_URL) return { error: `That URL is too long (at most ${MAX_CONNECTOR_URL.toLocaleString("en")} characters)` };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "Enter a full URL, like https://mcp.example.com/mcp" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Connectors use https:// URLs" };
  if (u.username || u.password) return { error: "Put the token in the token field, not in the URL" };
  const host = u.hostname.toLowerCase();
  if (!host) return { error: "Enter a full URL, like https://mcp.example.com/mcp" };
  if (u.protocol === "http:" && !isLoopback(host) && !allowPrivate) return { error: "Use https:// — plain http is only allowed for localhost" };
  const warning = isPrivateHost(host)
    ? "This address is on your machine or network. Claude connects from Anthropic's servers, so it only works through a public tunnel."
    : u.protocol === "http:"
      ? "Plain http: the token travels unencrypted."
      : undefined;
  return { url: u.toString(), ...(warning && { warning }) };
}

/** A path segment shown as is: a short lowercase word ("api", "mcp", "sse", "servers") or a version ("v1"). */
const PLAIN_SEGMENT = /^(?:[a-z]{1,8}|v\d{1,2})$/;

/**
 * The URL as the browser may show it. Many MCP servers carry a key in the URL — in the query
 * (`?api_key=…`) or as a path segment (Zapier's `/api/mcp/s/<secret>/mcp`) — so the query and fragment
 * become "?••••" and every path segment that isn't a short plain word becomes "…".
 */
export function maskConnectorUrl(url: string): string {
  try {
    const u = new URL(url);
    const hidden = u.search || u.hash;
    const segments = u.pathname
      .split("/")
      .slice(1)
      .map((s) => (!s || PLAIN_SEGMENT.test(s) ? s : "…"))
      .filter((s, i, all) => !(s === "…" && all[i - 1] === "…"));
    const path = segments.join("/");
    return `${u.origin}${path ? `/${path}` : ""}${hidden ? "?••••" : ""}`;
  } catch {
    return "••••";
  }
}

/**
 * A connector token as the browser may show it. MCP tokens are often short, so the usual "first 4 and
 * last 4" would show most of one: under 24 characters only the last 2 show.
 */
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length >= 24) return `${token.slice(0, 4)}••••${token.slice(-4)}`;
  return token.length > 8 ? `••••${token.slice(-2)}` : "••••";
}

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * The tools a connector is limited to, typed as "search_pages, get_page" (commas, spaces or new lines)
 * or sent as a list. Empty: every tool. Names are the server's own (the chat shows them as
 * "Notion · search_pages"); a name the server doesn't have simply matches nothing.
 */
export function parseToolList(input: string | readonly string[] | null | undefined): { tools: string[] | null } | { error: string } {
  const parts = (typeof input === "string" ? input.split(/[\s,]+/) : (input ?? [])).map((t) => t.trim()).filter(Boolean);
  const bad = parts.find((t) => !TOOL_NAME.test(t));
  if (bad) return { error: `“${bad.slice(0, 40)}” isn't a tool name — use the names the server lists, like search_pages` };
  const tools = [...new Set(parts)];
  if (tools.length > MAX_CONNECTOR_TOOLS) return { error: `Allow at most ${MAX_CONNECTOR_TOOLS} tools` };
  return { tools: tools.length ? tools : null };
}

/**
 * The name Claude sees for a connector, from its display name: lowercase letters, numbers, - and _,
 * at most 40 characters, unique among `taken` (a number is added).
 */
export function connectorSlug(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 36) || "connector";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A pasted "Bearer abc" or "Authorization: Bearer abc" is the token "abc" (Claude sends it as a Bearer token). */
export const cleanToken = (t: string) =>
  t
    .trim()
    .replace(/^authorization\s*:\s*/i, "")
    .replace(/^bearer\s+/i, "")
    .trim();
