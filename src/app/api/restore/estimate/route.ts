import { estimateRestore, RestoreEstimateSchema } from "@/server/restore";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The price, the windows or pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, RestoreEstimateSchema, "Add the clip to restore and pick an engine");
    return Response.json(estimateRestore(input));
  });
});
