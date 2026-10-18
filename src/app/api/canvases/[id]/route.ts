import { connection } from "next/server";
import { z } from "zod";
import { canvasView, deleteCanvas, graphProblem, parseGraph, updateCanvas } from "@/server/canvas";

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  graph: z.unknown().optional(),
});

/** The board, its nodes' last runs and the generations they made. */
export async function GET(_req: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const view = canvasView(id);
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Rename and/or autosave the graph. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the canvas a name" }, { status: 400 });
  const graph = parsed.data.graph === undefined ? undefined : parseGraph(parsed.data.graph);
  if (graph === null) return Response.json({ error: graphProblem(parsed.data.graph) }, { status: 400 });
  const c = updateCanvas(id, { name: parsed.data.name, graph });
  return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  const { id } = await ctx.params;
  return deleteCanvas(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
