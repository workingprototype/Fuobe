import { FinishError, finishOutput } from "@/server/generations";

const MAX_BYTES = 64 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fuobe Soul's finished picture (the look's grade and overlay, made in the browser): it replaces the raw output,
 * which stays as meta.original. Form fields: file (PNG), index (the output's place).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/generations/[id]/finish">) {
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const index = Number(form?.get("index"));
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That picture is too large (64 MB max)" }, { status: 413 });
  const data = Buffer.from(await file.arrayBuffer());
  if (file.type !== "image/png" || !data.subarray(0, 8).equals(PNG_MAGIC)) return Response.json({ error: "Finished pictures are PNG images" }, { status: 415 });
  try {
    return Response.json(finishOutput(id, index, data));
  } catch (e) {
    if (e instanceof FinishError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
