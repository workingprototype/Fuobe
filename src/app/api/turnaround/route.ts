import { currentActor } from "@/server/access/actor";
import { recordVisible } from "@/server/records";
import { body, handle, once } from "@/server/shorts-schemas";
import { createTurnaround, previewTurnaround, TurnaroundBodySchema, turnaroundRun } from "@/server/turnaround";
import { handler } from "@/server/access/route";

/**
 * Turnaround video (build plan N7-6): a 360° turnaround of a cast sheet or a character, on either engine. `?preview=1` plans
 * and prices it (the route, the pictures drawn first, the film's frames, the GPU it needs) without running it.
 */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const { requestId, ...input } = await body(request, TurnaroundBodySchema, "Pick the engine and the character's pictures");
    if (input.elementId && !recordVisible({ kind: "element", ids: [input.elementId] }, currentActor())) return Response.json({ error: "Character not found" }, { status: 404 });
    const run = turnaroundRun(input);
    if (new URL(request.url).searchParams.get("preview")) return Response.json(previewTurnaround(run));
    const result = await once("turnaround", requestId, () => createTurnaround(run));
    return Response.json(result, { status: 201 });
  });
});
