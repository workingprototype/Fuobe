import { connection } from "next/server";
import { z } from "zod";
import { deleteElement, getElement, updateElement } from "@/server/elements";

const Patch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(500).nullable().optional(),
  references: z.array(z.string().startsWith("/api/files/")).max(20).optional(),
  // Only removal is allowed from the client: the identities kept must already be on the element.
  removeIdentities: z.array(z.string()).optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/elements/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const el = getElement(id);
  return el ? Response.json(el) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/elements/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid element" }, { status: 400 });
  const { removeIdentities, ...patch } = parsed.data;
  const current = getElement(id);
  const loras = removeIdentities && current ? current.loras.filter((l) => !removeIdentities.includes(l.modelId)) : undefined;
  const el = updateElement(id, { ...patch, ...(loras ? { loras } : {}) });
  return el ? Response.json(el) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/elements/[id]">) {
  const { id } = await ctx.params;
  deleteElement(id);
  return new Response(null, { status: 204 });
}
