import { DirectionSchema, writeDirection } from "@/server/evolution";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Write the creative direction from the references and your words: Claude, Ollama, or Fuobe's offline writer. Never generates. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, DirectionSchema, "Pick how much should change, then add references or a few words");
    return Response.json(await writeDirection(input));
  });
});
