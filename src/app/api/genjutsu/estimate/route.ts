import { estimateGenjutsu, GenjutsuEstimateSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The price, the model, the pieces and the notes for the current settings, before anything runs. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, GenjutsuEstimateSchema, "Add a clip and pick a mode");
    return Response.json(await estimateGenjutsu(input));
  });
});
