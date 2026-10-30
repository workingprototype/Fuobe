import { z } from "zod";
import { retryMixed } from "@/server/mixed-media";
import { body, handle, once } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Run a render again with the same settings ("Try again" in History); a repeated requestId gets the first answer. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, z.object({ id: z.string().min(1).max(64), requestId: z.string().trim().min(8).max(64).optional() }), "Pick a render to try again");
    return Response.json(await once("mixed-retry", input.requestId, () => retryMixed(input.id)), { status: 201 });
  });
});
