import { connection } from "next/server";
import { z } from "zod";
import { activeLocal, aiHelper, llmContext, localStatuses, pinnedKind, reloadLmStudio, testLocal } from "@/server/llm";

/**
 * The local LLM servers for Settings → AI helper. GET: each server's status (up, key, its chat
 * models, the model a call would use, what's wrong), `?refresh=1` asks them again now. Keys never
 * leave the server. POST {action: "test", kind?}: a tiny call, timed. POST {action: "load", model?}:
 * reloads an LM Studio model with the context from Settings.
 */
export async function GET(request: Request) {
  await connection();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const servers = await localStatuses(refresh);
  const active = await activeLocal();
  return Response.json({ helper: aiHelper(), provider: pinnedKind() ?? "auto", context: llmContext(), active: active?.server.kind ?? null, servers });
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test"), kind: z.enum(["ollama", "lmstudio", "unsloth", "custom"]).nullish() }),
  z.object({ action: z.literal("load"), model: z.string().trim().max(200).nullish() }),
]);

export async function POST(request: Request) {
  const parsed = Action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, detail: "Unknown action" }, { status: 400 });
  const a = parsed.data;
  if (a.action === "test") return Response.json(await testLocal(a.kind));
  try {
    const r = await reloadLmStudio(a.model);
    return Response.json({ ok: true, detail: `LM Studio loaded ${r.model}${r.context ? ` with ${r.context.toLocaleString("en-US")} tokens of context` : ""}${r.seconds ? ` in ${r.seconds.toFixed(1)} s` : ""}`, ...r });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message });
  }
}
