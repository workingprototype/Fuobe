import { after, connection } from "next/server";
import { z } from "zod";
import { addMessage, agentKind, createThread, listThreads, run } from "@/server/assist/agent";
import { AssistMessage } from "@/server/assist/schemas";

const Create = AssistMessage.extend({ engine: z.enum(["cloud", "open"]), autoApprove: z.boolean().optional() });

export async function GET() {
  await connection();
  return Response.json({ threads: listThreads(), agent: agentKind() });
}

/** Start a chat with its first message; the agent replies in the background (poll the thread). */
export async function POST(request: Request) {
  const parsed = Create.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write a message" }, { status: 400 });
  const { text, attachments, engine, autoApprove } = parsed.data;
  const thread = createThread({ engine, autoApprove });
  const updated = addMessage(thread.id, text, attachments);
  // Claimed now (not in after()) so a poll that lands first doesn't see a stale "running" thread.
  const reply = run(thread.id);
  after(() => reply);
  return Response.json(updated, { status: 201 });
}
