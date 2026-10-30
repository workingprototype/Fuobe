import { z } from "zod";
import { deletePalette, renamePalette } from "@/server/palettes";
import { handler } from "@/server/access/route";

const Patch = z.object({ name: z.string().trim().min(1).max(60) });

export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/palettes/[id]">) => {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the palette a name" }, { status: 400 });
  try {
    return Response.json(renamePalette(id, parsed.data.name));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 400 });
  }
});

export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/palettes/[id]">) => {
  const { id } = await ctx.params;
  try {
    return deletePalette(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
});
