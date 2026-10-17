import { connection } from "next/server";
import { z } from "zod";
import { deleteThread, getThread, updateThread } from "@/server/assist/agent";

const Patch = z.object({ autoApprove: z.boolean().optional(), title: z.string().trim().min(1).max(80).optional() });

export async function GET(_req: Request, ctx: RouteContext<"/api/assist/[id]">) {
  await connection();
  const view = getThread((await ctx.params).id);
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/[id]">) {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  const t = updateThread((await ctx.params).id, parsed.data);
  return t ? Response.json(t) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/[id]">) {
  deleteThread((await ctx.params).id);
  return new Response(null, { status: 204 });
}
