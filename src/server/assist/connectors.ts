import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import {
  checkConnectorUrl,
  cleanToken,
  connectorSlug,
  maskConnectorUrl,
  maskToken,
  MAX_CONNECTOR_NAME,
  MAX_CONNECTOR_TOKEN,
  MAX_CONNECTORS,
  parseToolList,
  type ConnectorView,
} from "@/lib/assist-connectors";
import { db } from "../db";

/**
 * Custom MCP connectors (Settings → Assist → Connectors). Claude chats that use connectors (every
 * ordinary chat; a scheduled run only when its task allows it) get every enabled one through the
 * Messages API's MCP connector: `mcp_servers` names each server (URL and token), and an `mcp_toolset`
 * in `tools` turns its tools on — all of them, or only the connector's allow-list (beta
 * `mcp-client-2025-11-20`). Anthropic's servers connect to the URL and call the tools inside the
 * reply, so Fuobe's approval cards never see those calls. Tokens are secrets like the API keys in
 * Settings: kept in SQLite, masked in everything the browser gets.
 */

/** The MCP connector beta the request names (both halves — servers and toolsets — need it). */
export const MCP_BETA = "mcp-client-2025-11-20";

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Row {
  id: string;
  name: string;
  slug: string;
  url: string;
  token: string | null;
  tools_json: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

/** A connector with its secret, for the request to Claude only. */
export interface Connector {
  id: string;
  name: string;
  slug: string;
  url: string;
  token: string | null;
  /** The only tools Claude may call; null: all of them. */
  tools: string[] | null;
  enabled: boolean;
}

const allowPrivate = () => process.env.FUOBE_ALLOW_PRIVATE_URLS === "1";

const toolsOf = (r: Row): string[] | null => (r.tools_json ? (JSON.parse(r.tools_json) as string[]) : null);

const toConnector = (r: Row): Connector => ({ id: r.id, name: r.name, slug: r.slug, url: r.url, token: r.token, tools: toolsOf(r), enabled: !!r.enabled });

function toView(r: Row): ConnectorView {
  const check = checkConnectorUrl(r.url, allowPrivate());
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    url: maskConnectorUrl(r.url),
    enabled: !!r.enabled,
    hasToken: !!r.token,
    token: r.token ? maskToken(r.token) : "",
    tools: toolsOf(r),
    ...("warning" in check && check.warning && { warning: check.warning }),
    ...("error" in check && { warning: check.error }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const rows = () => db().prepare("SELECT * FROM assist_connectors ORDER BY created_at").all() as Row[];

/** Every connector, as the browser may see them. */
export function listConnectors(): ConnectorView[] {
  return rows().map(toView);
}

/** The enabled connectors, with their tokens (the Claude request only). */
export function activeConnectors(): Connector[] {
  return rows()
    .filter((r) => r.enabled && "url" in checkConnectorUrl(r.url, allowPrivate()))
    .slice(0, MAX_CONNECTORS)
    .map(toConnector);
}

export interface ConnectorInput {
  name?: string;
  url?: string;
  /** A new token; "" removes it; undefined keeps the saved one. */
  token?: string;
  /** The only tools Claude may call ("a, b" or a list); empty or null: every tool; undefined keeps the saved list. */
  tools?: string | string[] | null;
  enabled?: boolean;
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new ConnectorError("Give the connector a name");
  if (n.length > MAX_CONNECTOR_NAME) throw new ConnectorError(`Keep the name under ${MAX_CONNECTOR_NAME} characters`);
  return n;
}

function cleanUrl(url: string): string {
  const c = checkConnectorUrl(url, allowPrivate());
  if ("error" in c) throw new ConnectorError(c.error);
  return c.url;
}

function cleanSecret(token: string): string | null {
  const t = cleanToken(token);
  if (t.length > MAX_CONNECTOR_TOKEN) throw new ConnectorError("That token is too long");
  if (/\s/.test(t)) throw new ConnectorError("Paste only the token — no spaces or line breaks");
  return t || null;
}

function cleanTools(tools: string | string[] | null): string | null {
  const c = parseToolList(tools);
  if ("error" in c) throw new ConnectorError(c.error);
  return c.tools ? JSON.stringify(c.tools) : null;
}

export function createConnector(input: ConnectorInput, now = Date.now()): ConnectorView {
  const existing = rows();
  if (existing.length >= MAX_CONNECTORS) throw new ConnectorError(`You can add up to ${MAX_CONNECTORS} connectors`);
  const name = cleanName(input.name ?? "");
  const url = cleanUrl(input.url ?? "");
  if (existing.some((r) => r.url === url)) throw new ConnectorError("That URL is already a connector");
  const row: Row = {
    id: nanoid(10),
    name,
    slug: connectorSlug(name, existing.map((r) => r.slug)),
    url,
    token: input.token ? cleanSecret(input.token) : null,
    tools_json: input.tools === undefined ? null : cleanTools(input.tools),
    enabled: input.enabled === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      "INSERT INTO assist_connectors (id, name, slug, url, token, tools_json, enabled, created_at, updated_at) VALUES (@id, @name, @slug, @url, @token, @tools_json, @enabled, @created_at, @updated_at)",
    )
    .run(row);
  return toView(row);
}

/** Rename, move, replace or remove the token, change the allowed tools, switch on or off. The name Claude sees (slug) stays. */
export function updateConnector(id: string, input: ConnectorInput): ConnectorView | null {
  const r = db().prepare("SELECT * FROM assist_connectors WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const next: Row = { ...r, updated_at: Date.now() };
  if (input.name !== undefined) next.name = cleanName(input.name);
  if (input.url !== undefined) {
    next.url = cleanUrl(input.url);
    if (next.url !== r.url && rows().some((x) => x.id !== id && x.url === next.url)) throw new ConnectorError("That URL is already a connector");
  }
  if (input.token !== undefined) next.token = input.token === "" ? null : cleanSecret(input.token);
  if (input.tools !== undefined) next.tools_json = cleanTools(input.tools);
  if (input.enabled !== undefined) next.enabled = input.enabled ? 1 : 0;
  db()
    .prepare("UPDATE assist_connectors SET name = @name, url = @url, token = @token, tools_json = @tools_json, enabled = @enabled, updated_at = @updated_at WHERE id = @id")
    .run(next);
  return toView(next);
}

export function deleteConnector(id: string): boolean {
  return db().prepare("DELETE FROM assist_connectors WHERE id = ?").run(id).changes > 0;
}

/** The display name of a connector Claude called by its slug (the chat shows this). */
export function connectorName(slug: string): string {
  return (db().prepare("SELECT name FROM assist_connectors WHERE slug = ?").get(slug) as { name: string } | undefined)?.name ?? slug;
}

// ---------------------------------------------------------------------------
// The Messages API request

export interface McpParams {
  mcp_servers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[];
  toolsets: Anthropic.Beta.BetaMCPToolset[];
}

/**
 * The request's MCP fields for these connectors: one server and one toolset each, joined by the slug.
 * A connector limited to some tools turns the rest off (`default_config` off, those tools on).
 */
export function mcpParams(list: Connector[]): McpParams | null {
  if (!list.length) return null;
  return {
    mcp_servers: list.map((c) => ({ type: "url", url: c.url, name: c.slug, ...(c.token && { authorization_token: c.token }) })),
    toolsets: list.map((c) => ({
      type: "mcp_toolset",
      mcp_server_name: c.slug,
      ...(c.tools?.length && { default_config: { enabled: false }, configs: Object.fromEntries(c.tools.map((t) => [t, { enabled: true }])) }),
    })),
  };
}

type Msg = Anthropic.Beta.BetaMessageParam;

/**
 * History blocks from a connector the request no longer names (deleted or switched off) become
 * plain text in the request, so the conversation stays valid; the stored history keeps them.
 */
export function withoutMissingServers(messages: Msg[], servers: Set<string>): Msg[] {
  const gone = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "mcp_tool_use" && !servers.has(b.server_name)) gone.set(b.id, `${b.server_name} · ${b.name}`);
  }
  if (!gone.size) return messages;
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    let changed = false;
    const content = m.content.map((b) => {
      if (b.type === "mcp_tool_use" && gone.has(b.id)) {
        changed = true;
        return { type: "text" as const, text: `[Used ${gone.get(b.id)} — that connector is no longer available]` };
      }
      if (b.type === "mcp_tool_result" && gone.has(b.tool_use_id)) {
        changed = true;
        const body = typeof b.content === "string" ? b.content : (b.content ?? []).map((t) => t.text).join("\n");
        return { type: "text" as const, text: `[${b.is_error ? "Error" : "Result"}: ${body.slice(0, 4000)}]` };
      }
      return b;
    });
    return changed ? ({ ...m, content } as Msg) : m;
  });
}
