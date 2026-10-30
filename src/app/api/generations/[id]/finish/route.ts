import { requestAccount } from "@/server/auth";
import { gateAsProxy } from "@/server/direct-gate";
import { FinishError, finishOutput } from "@/server/generations";

const MAX_BYTES = 64 * 1024 * 1024;
/** An account's finished picture (its own result: the proxy checks): smaller. */
const ACCOUNT_MAX_BYTES = 32 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fuobe Soul's finished picture (the look's grade and overlay, made in the browser): it replaces the raw output,
 * which stays as meta.original. Form fields: file (PNG), index (the output's place). An account's file is stored as
 * its own (through the generation).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/generations/[id]/finish">) {
  // The proxy doesn't run on this route (a big form): its checks run here (an account: only its own run).
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const max = requestAccount(request) ? ACCOUNT_MAX_BYTES : MAX_BYTES;
  if (Number(request.headers.get("content-length") ?? 0) > max + 64 * 1024) return Response.json({ error: `That picture is too large (${max / 2 ** 20} MB max)` }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const index = Number(form?.get("index"));
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > max) return Response.json({ error: `That picture is too large (${max / 2 ** 20} MB max)` }, { status: 413 });
  const data = Buffer.from(await file.arrayBuffer());
  if (file.type !== "image/png" || !data.subarray(0, 8).equals(PNG_MAGIC)) return Response.json({ error: "Finished pictures are PNG images" }, { status: 415 });
  try {
    return Response.json(finishOutput(id, index, data));
  } catch (e) {
    if (e instanceof FinishError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
