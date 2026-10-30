import { connection } from "next/server";
import { CONNECT_GPU_HEADER } from "@/lib/guest-access";
import { accountGpu, requestAccount, requestViewer } from "@/server/auth";
import { OPERATION_LABELS } from "@/lib/catalog/types";
import { accountRun, asVisitor, createGenerations, listGenerations, outputKind, previewGeneration } from "@/server/generations";
import { ensureTrashPurge, listOptionsFrom } from "@/server/library";
import { GenerationRequestSchema } from "@/server/request-schema";
import { gateGeneration, GPU_SETUP_HEADER } from "@/server/gpu/gate";
import { gpuTargetFor } from "@/server/gpu/target";

/**
 * List generations, newest first. Filters: kind / kinds, features (`x*` = prefix), models, statuses,
 * favorites=1, folder=<id>, q, since / until (createdAt ms), trash=1 (the Trash, newest deletion first),
 * paging with before=<createdAt>:<id> of the last row (<deletedAt>:<id> in the Trash; a bare
 * timestamp still works) and limit (≤ 200).
 */
export async function GET(request: Request) {
  await connection();
  ensureTrashPurge();
  // An account (public sign-up) lists only its own runs; the owner only theirs.
  const account = requestAccount(request);
  return Response.json({ items: listGenerations({ ...listOptionsFrom(new URL(request.url).searchParams), account: account?.id }) });
}

/** Start a generation; `?preview=1` only says what it would run as (model, operation, jobs, outputs, cost). */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = GenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  // A retired model id (an older script, a saved CLI or MCP call) runs on the model that replaced it, and the notes say
  // so: previewGeneration and createGenerations move it (generations.ts currentRequest, replaced.ts).
  const asked = parsed.data as Parameters<typeof createGenerations>[0];
  // Public sign-up: an account runs on its own ComfyUI only (the open engine), never the install's providers.
  const viewer = requestViewer(request);
  const account = viewer.kind === "account" ? viewer.account : null;
  const req = account ? { ...asked, account: account.id, engine: "open" as const } : { ...asked, account: undefined };
  const own = account ? accountRun(account.id, "comfyui") : undefined;
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (own && "error" in own && !preview) {
    return Response.json({ error: own.error, code: "connect-gpu" }, { status: 403, headers: { [CONNECT_GPU_HEADER]: "1" } });
  }
  const onOwn = <T,>(fn: () => T): T => (own && "run" in own ? own.run(fn) : fn());
  // A visitor's price check: priced as it would run, on its own GPU (none yet: the open engine, no demo).
  const priced = <T,>(fn: () => T): T => (viewer.kind === "owner" ? fn() : asVisitor(account ? accountGpu(account.id) : null, fn));
  try {
    if (preview) {
      const { model, ...p } = priced(() => previewGeneration(req));
      return Response.json({ ...p, modelId: model.id, modelName: model.name, engine: model.engine, kind: outputKind(p.op, model), opLabel: OPERATION_LABELS[p.op] ?? p.op });
    }
    // GPU pre-flight: a ComfyUI run that is sure to fail for something missing stops here with the plan that fixes it
    // (src/server/gpu/gate.ts; never when the check is unknown, for graphics memory, or with gpuCheck "skip").
    let gpuWarning: string | undefined;
    if (viewer.kind !== "guest") {
      let planned: ReturnType<typeof previewGeneration> | null = null;
      try {
        planned = onOwn(() => previewGeneration(req));
      } catch {
        // createGenerations says what's wrong with the request.
      }
      if (planned) {
        const skip = (body as { gpuCheck?: unknown } | null)?.gpuCheck === "skip";
        const gate = await gateGeneration(gpuTargetFor(request, "read"), { request: req, route: planned.route, op: planned.op, modelId: planned.model.id, skip, actor: account?.id ?? "owner" });
        if (!gate.ok) return Response.json({ error: gate.message, code: "gpu-setup", ref: gate.ref, plan: gate.plan }, { status: 409, headers: { [GPU_SETUP_HEADER]: "1" } });
        gpuWarning = gate.warning;
      }
    }
    const items = onOwn(() => createGenerations(req));
    // What the run leaves out or changes (a model that replaced a retired one, a LoRA that runs only on a GPU, a length the API rounds).
    const notes = [...new Set(items.flatMap((g) => g.notes ?? []))];
    return Response.json({ items, ...(notes.length && { notes }), ...(gpuWarning && { gpuWarning }) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
