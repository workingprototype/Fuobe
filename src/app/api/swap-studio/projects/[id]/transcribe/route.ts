import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { transcribe } from "@/server/swap-studio";
import { handler } from "@/server/access/route";

const Transcribe = z.object({ clipId: z.string().min(1).max(80) });

/** The clip's words, with who speaks when (Scribe v2 on the cloud, Qwen3-ASR on your GPU). */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/transcribe">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(transcribe(id, (await body(request, Transcribe, "Pick a clip")).clipId));
  });
});
