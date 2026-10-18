import { createMixed } from "@/server/mixed-media";
import { MixedBodySchema, body, handle } from "@/server/shorts-schemas";

/** Render a Mixed Media video (open: per frame; cloud: cut → restyle → original sound). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, MixedBodySchema, "Pick a preset, upload a clip and choose up to 10 seconds");
    const { final, items } = await createMixed(input);
    return Response.json({ final, items }, { status: 201 });
  });
}
