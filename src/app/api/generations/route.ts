import { connection } from "next/server";
import { OPERATION_LABELS } from "@/lib/catalog/types";
import { createGenerations, listGenerations, outputKind, previewGeneration } from "@/server/generations";
import { ensureTrashPurge, listOptionsFrom } from "@/server/library";
import { GenerationRequestSchema } from "@/server/request-schema";

/**
 * List generations, newest first. Filters: kind / kinds, features (`x*` = prefix), models, statuses,
 * favorites=1, folder=<id>, q, since / until (createdAt ms), trash=1 (the Trash, newest deletion first),
 * paging with before=<createdAt>:<id> of the last row (<deletedAt>:<id> in the Trash; a bare
 * timestamp still works) and limit (≤ 200).
 */
export async function GET(request: Request) {
  await connection();
  ensureTrashPurge();
  return Response.json({ items: listGenerations(listOptionsFrom(new URL(request.url).searchParams)) });
}

/** Start a generation; `?preview=1` only says what it would run as (model, operation, jobs, outputs, cost). */
export async function POST(request: Request) {
  const parsed = GenerationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  // A retired model id (an older script, a saved CLI or MCP call) runs on the model that replaced it, and the notes say
  // so: previewGeneration and createGenerations move it (generations.ts currentRequest, replaced.ts).
  const req = parsed.data as Parameters<typeof createGenerations>[0];
  try {
    if (new URL(request.url).searchParams.get("preview") === "1") {
      const { model, ...p } = previewGeneration(req);
      return Response.json({ ...p, modelId: model.id, modelName: model.name, engine: model.engine, kind: outputKind(p.op, model), opLabel: OPERATION_LABELS[p.op] ?? p.op });
    }
    const items = createGenerations(req);
    // What the run leaves out or changes (a model that replaced a retired one, a LoRA that runs only on a GPU, a length the API rounds).
    const notes = [...new Set(items.flatMap((g) => g.notes ?? []))];
    return Response.json({ items, ...(notes.length && { notes }) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
