import { recordExists } from "@/server/records";
import { body, handle } from "@/server/shorts-schemas";
import { previewTurnaround, TurnaroundBodySchema, turnaroundRun } from "@/server/turnaround";
import { handler } from "@/server/access/route";

/**
 * A turnaround's price and plan, as the studio routes' estimates answer it (the evaluation harness prices a job here
 * before running it): the model the film runs on, what it costs, whether it would be a demo, the notes.
 */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, TurnaroundBodySchema, "Pick the engine and the character's pictures");
    delete input.requestId;
    if (input.elementId && !recordExists({ kind: "element", ids: [input.elementId] })) return Response.json({ error: "Character not found" }, { status: 404 });
    const p = previewTurnaround(turnaroundRun(input));
    return Response.json({ ...p, modelId: p.model.id, modelName: p.model.name });
  });
});
