import { transcribeClip, TranscribeSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The clip's words for Character swap's "What's said": one transcription the page picks the part's lines from. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, TranscribeSchema, "Add a clip first");
    return Response.json(transcribeClip(input), { status: 201 });
  });
});
