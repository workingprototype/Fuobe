import { estimateRemoval, RemovalEstimateSchema } from "@/server/remove-object";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The price, the pieces and the notes for the current settings, before anything runs. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, RemovalEstimateSchema, "Add a clip and pick how to point at what goes");
    return Response.json(await estimateRemoval(input));
  });
});
