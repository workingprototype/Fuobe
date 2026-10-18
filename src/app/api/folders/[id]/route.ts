import { connection } from "next/server";
import { z } from "zod";
import { deleteFolder, getFolder, updateFolder } from "@/server/library";

const Patch = z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().max(20).optional() });

export async function GET(_req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const f = getFolder(id);
  return f ? Response.json(f) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the folder a name" }, { status: 400 });
  try {
    const f = updateFolder(id, parsed.data);
    return f ? Response.json(f) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}

/** Delete the folder; its contents go back to the library. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  return deleteFolder(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
