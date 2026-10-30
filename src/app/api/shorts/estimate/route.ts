import { estimateShorts } from "@/server/shorts";
import { ShortsEstimateSchema, body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** What a session would cost (or that it runs as a demo), how many segments it makes, and notes. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, ShortsEstimateSchema, "Pick a preset and the part of the clip to restyle");
    return Response.json(await estimateShorts(input));
  });
});
