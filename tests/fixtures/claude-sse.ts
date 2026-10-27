/**
 * A Messages API reply as the server-sent events the SDK's stream reads (Assist's Claude calls
 * stream and keep the final message). Text, tool_use, and the MCP connector's mcp_tool_use /
 * mcp_tool_result blocks.
 */
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "mcp_tool_use"; id: string; name: string; server_name: string; input: unknown }
  | { type: "mcp_tool_result"; tool_use_id: string; is_error: boolean; content: { type: "text"; text: string }[] };

export function claudeStream(reply: { content: Block[]; stop_reason: string; model?: string }): Response {
  const events: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", model: reply.model ?? "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 1, output_tokens: 0 } },
    },
  ];
  reply.content.forEach((b, index) => {
    if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "mcp_tool_result") {
      events.push({ type: "content_block_start", index, content_block: b });
    } else {
      events.push({ type: "content_block_start", index, content_block: { ...b, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: reply.stop_reason, stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } });
  events.push({ type: "message_stop" });
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
