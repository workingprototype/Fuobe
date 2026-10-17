import { z } from "zod";
import { parseGraph, runCanvas } from "@/server/canvas";

const Body = z.object({
  /** Node ids to run with everything upstream (Run node, Run selected); omit for Run all. */
  targets: z.array(z.string().max(80)).max(300).optional(),
  /** Re-run the targets even when their result is still fresh. */
  force: z.boolean().optional(),
  /** The board as the editor shows it (saved first). */
  graph: z.unknown().optional(),
});

/**
 * Turn the graph into generations: one per generator node that needs to run, chained with
 * dependsOn along the edges. Fresh and pinned nodes are reused. 422 when nothing could start.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/canvases/[id]/run">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid run request" }, { status: 400 });
  const graph = parsed.data.graph === undefined ? undefined : parseGraph(parsed.data.graph);
  if (graph === null) return Response.json({ error: "That board couldn't be read — reload the page" }, { status: 400 });
  const result = runCanvas(id, { targets: parsed.data.targets, force: parsed.data.force, graph });
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  if (!result.ran.length && result.errors.length) {
    const first = result.errors[0].message;
    return Response.json({ ...result, error: result.errors.length > 1 ? `${first} (and ${result.errors.length - 1} more)` : first }, { status: 422 });
  }
  return Response.json(result, { status: result.ran.length ? 201 : 200 });
}
