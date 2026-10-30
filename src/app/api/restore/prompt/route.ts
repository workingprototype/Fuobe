import { PromptSchema, writeRestorePrompt } from "@/server/restore";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Write the period / place / light sentence and the negative from a few frames: Claude, Ollama, or Fuobe's offline template. Never generates. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, PromptSchema, "Add a few frames of the clip or a few words about it");
    return Response.json(await writeRestorePrompt(input));
  });
});
