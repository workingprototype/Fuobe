import "server-only";
import { z } from "zod";
import { apiSchema, executeTool, getTool, planFor, TOOLS, type ToolContext } from "./assist/tools";
import { engineMode } from "./settings";

/**
 * Fuobe as an MCP server (Model Context Protocol, streamable HTTP transport, stateless):
 * other agents — Claude Desktop, Claude Code, any MCP client — can look up models, price a
 * plan, start generations and fetch results. Same tools as Assist; the client's own approval
 * prompt replaces Assist's plan card, so `estimate_cost` is offered for asking first.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "fuobe", title: "Fuobe studio", version: "1.0.0" };
const INSTRUCTIONS =
  "Fuobe is an AI image, video and audio studio (paid cloud models and open-source ComfyUI workflows). " +
  "Look up models with search_models, price a plan with estimate_cost and tell the user the cost before you call generate or create_storyboard. " +
  "Generations run in the background: poll check_generations (wait_seconds up to 120) for output URLs. Output URLs are paths on this Fuobe server.";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } });

const ok = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const ctx = (): ToolContext => ({ engine: engineMode() === "open" ? "open" : "cloud" });

const READ_ONLY = new Set(["search_models", "list_elements", "list_recent", "check_generations", "estimate_cost"]);

function toolList() {
  const tools = TOOLS.map((t) => ({
    name: t.name,
    title: t.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    // Assist's approval card doesn't exist here: say what the call costs instead.
    description: t.gated ? `${t.description.replace(/The app shows the user the plan[^.]*\.( so call this directly instead of asking for confirmation in text\.)?/, "").trim()} Spends money on paid models (or GPU time on open ones): price it with estimate_cost and confirm with the user first.` : t.description,
    inputSchema: apiSchema(t.schema),
    annotations: { readOnlyHint: READ_ONLY.has(t.name), openWorldHint: !!t.gated },
  }));
  const gen = getTool("generate")!;
  tools.push({
    name: "estimate_cost",
    title: "Estimate cost",
    description: "Price a generate call without running it: the model, operation, number of outputs and estimated USD for each job, and whether it would run as a demo (no provider connected). Call it before generate whenever the user hasn't already agreed to a price.",
    inputSchema: apiSchema(gen.schema),
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  return tools;
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Tool output (Anthropic content blocks or a string) → MCP content. */
function toContent(content: unknown): Content[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: JSON.stringify(content ?? null) }];
  return content.flatMap((b: { type: string; text?: string; source?: { type: string; data?: string; media_type?: string } }): Content[] => {
    if (b.type === "text") return [{ type: "text", text: b.text ?? "" }];
    if (b.type === "image" && b.source?.type === "base64" && b.source.data) return [{ type: "image", data: b.source.data, mimeType: b.source.media_type ?? "image/png" }];
    return [];
  });
}

const CallParams = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

async function call(params: unknown) {
  const p = CallParams.safeParse(params);
  if (!p.success) return null;
  const { name, arguments: args = {} } = p.data;
  if (name === "estimate_cost") {
    const plan = planFor("generate", getTool("generate")!.schema.parse(args), ctx());
    return { content: [{ type: "text", text: JSON.stringify(plan) }], structuredContent: plan, isError: plan.jobs.every((j) => j.error) };
  }
  if (!getTool(name)) return undefined;
  const out = await executeTool(name, args, ctx());
  return { content: toContent(out.content), isError: !!out.isError };
}

/** Handle one JSON-RPC message; null for notifications (no response). */
export async function handleMcp(msg: unknown): Promise<JsonRpcResponse | null> {
  const m = msg as JsonRpcRequest;
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(null, -32600, "Invalid request");
  const isNotification = m.id === undefined;
  if (isNotification) return null;
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: toolList() });
    case "tools/call": {
      try {
        const r = await call(m.params);
        if (r === null) return fail(m.id, -32602, "tools/call needs a name and arguments");
        if (r === undefined) return fail(m.id, -32602, `Unknown tool ${String(m.params?.name)}`);
        return ok(m.id, r);
      } catch (e) {
        // Bad arguments for estimate_cost and the like: a tool error the model can read.
        return ok(m.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    case "resources/list":
      return ok(m.id, { resources: [] });
    case "prompts/list":
      return ok(m.id, { prompts: [] });
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}
