import { handleMcp } from "@/server/mcp";
import { currentActor } from "@/server/access/actor";
import { handler, type TokenScope } from "@/server/access/route";

/**
 * MCP endpoint (streamable HTTP, stateless, JSON responses). Point an MCP client at
 * http(s)://<host>/api/mcp; with a password set, send `Authorization: Bearer fuobe_…`.
 * Every token scope may call it: a Read-only token is offered the read tools only (handleMcp).
 */
const READ_AND_UP: TokenScope[] = ["read", "generate", "admin"];

export const POST = handler({ access: "signed-in", scopes: READ_AND_UP }, async (request: Request) => {
  // Browsers send Origin: a web page on another site must not reach this server through the
  // user's browser (DNS rebinding, required by the MCP spec). Native clients send none.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } }, { status: 403 });
  }
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  if (Array.isArray(body)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches aren't supported" } }, { status: 400 });
  // Tools run as the token's (or session's) person.
  const res = await handleMcp(body, currentActor());
  return res ? Response.json(res) : new Response(null, { status: 202 });
});

/** No server-initiated stream: this server only answers requests. */
export const GET = handler({ access: "signed-in", scopes: READ_AND_UP }, () => {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
});

export const DELETE = handler({ access: "signed-in", scopes: READ_AND_UP }, () => {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
});
