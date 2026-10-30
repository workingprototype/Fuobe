import { estimateEvolution, EvolutionEstimateSchema } from "@/server/evolution";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The price, the pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, EvolutionEstimateSchema, "Add a clip and pick how much should change");
    return Response.json(estimateEvolution(input));
  });
});
