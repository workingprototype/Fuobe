import { z } from "zod";
import { recordExists } from "@/server/records";
import { body, handle, once } from "@/server/shorts-schemas";
import { createTurnaround, previewTurnaround, TurnaroundSchema } from "@/server/turnaround";

const Body = TurnaroundSchema.extend({
  /** Made from a character's page: the film goes into that character's feed. */
  elementId: z.string().max(40).optional(),
  /** A repeated requestId (a second click) gets the run the first one started. */
  requestId: z.string().max(80).optional(),
});

/**
 * Turnaround video (build plan N7-6): a 360° turnaround of a cast sheet or a character, on either engine. `?preview=1` plans
 * and prices it (the route, the pictures drawn first, the film's frames, the GPU it needs) without running it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { elementId, requestId, ...input } = await body(request, Body, "Pick the engine and the character's pictures");
    if (elementId && !recordExists({ kind: "element", ids: [elementId] })) return Response.json({ error: "Character not found" }, { status: 404 });
    const run = { ...input, ...(elementId && { feature: `element:${elementId}` }) };
    if (new URL(request.url).searchParams.get("preview")) return Response.json(previewTurnaround(run));
    const result = await once("turnaround", requestId, () => createTurnaround(run));
    return Response.json(result, { status: 201 });
  });
}
