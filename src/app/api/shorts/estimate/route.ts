import { estimateShorts } from "@/server/shorts";
import { ShortsEstimateSchema, body, handle } from "@/server/shorts-schemas";

/** What a session would cost (or that it runs as a demo), how many segments it makes, and notes. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, ShortsEstimateSchema, "Pick a preset and the part of the clip to restyle");
    return Response.json(await estimateShorts(input));
  });
}
