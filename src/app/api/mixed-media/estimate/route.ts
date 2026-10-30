import { estimateMixed } from "@/server/mixed-media";
import { MixedEstimateSchema, body, handle } from "@/server/shorts-schemas";

/** Frames, cost of the render and of a preview frame, and notes for the current settings. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, MixedEstimateSchema, "Pick a preset and the part of the clip to use");
    return Response.json(await estimateMixed(input));
  });
}
