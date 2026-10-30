import { estimateEvolution, EvolutionEstimateSchema } from "@/server/evolution";
import { body, handle } from "@/server/shorts-schemas";

/** The price, the pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, EvolutionEstimateSchema, "Add a clip and pick how much should change");
    return Response.json(estimateEvolution(input));
  });
}
