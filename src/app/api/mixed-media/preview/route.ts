import { createMixedPreview } from "@/server/mixed-media";
import { MixedBodySchema, body, handle, once } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Generate one frame with the current settings before the full video. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, MixedBodySchema, "Pick a preset and upload a clip first");
    return Response.json(await once("mixed-preview", input.requestId, () => createMixedPreview(input)), { status: 201 });
  });
});
