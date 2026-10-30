import { createRemovalPreview, RemovalBodySchema } from "@/server/remove-object";
import { body, handle, once } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** A mask preview of the first seconds: what the engine would remove (SAM 3.1). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, RemovalBodySchema, "Add a clip and say, click or paint what to remove");
    const preview = await once("remove-object-preview", input.requestId, () => createRemovalPreview(input));
    return Response.json(preview, { status: 201 });
  });
});
