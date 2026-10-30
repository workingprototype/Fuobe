import { z } from "zod";
import { body, handle, voicePreview } from "@/server/faceless";
import { handler } from "@/server/access/route";

const Ask = z.object({ id: z.string().min(1).max(80) });

/** A short sample of a premade narrator voice: one speech generation, reused once it exists. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const { id } = await body(request, Ask, "Pick a voice");
    return Response.json(voicePreview({ kind: "preset", id }));
  });
});
