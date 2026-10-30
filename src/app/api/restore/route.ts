import { createRestore, RestoreBodySchema } from "@/server/restore";
import { body, handle, once } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Restore & colourise a clip (Fuobe Restore): the prompt is written first when none is given; windows or pieces are joined and the sound put back. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, RestoreBodySchema, "Add the clip to restore and pick an engine");
    // A repeated requestId (a second click on Restore) gets the run the first one started.
    const result = await once("restore", input.requestId, () => createRestore(input));
    return Response.json(result, { status: 201 });
  });
});
