import { createRemoval, RemovalBodySchema } from "@/server/remove-object";
import { body, handle, once } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** Remove an object from a clip: the pieces or windows are erased, joined, and the clip's sound put back. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, RemovalBodySchema, "Add a clip and say, click or paint what to remove");
    // A repeated requestId (a second click on Remove) gets the run the first one started.
    const { final, items } = await once("remove-object", input.requestId, () => createRemoval(input));
    return Response.json({ final, items }, { status: 201 });
  });
});
