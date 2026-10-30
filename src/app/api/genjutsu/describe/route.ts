import { describeCharacter, DescribeSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** "Describe my character": the engine's text model writes what the character looks like from their picture. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, DescribeSchema, "Add a picture of your character first");
    return Response.json(await describeCharacter(input));
  });
});
