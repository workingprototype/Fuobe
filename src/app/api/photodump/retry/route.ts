import { z } from "zod";
import { retryPhoto } from "@/server/photodump";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Body = z.object({ id: z.string().min(1).max(40) });

/**
 * Retry a failed or canceled photo of a Photodump / Fashion Factory / Character Sheet run: the same
 * request in the same batch, replacing the failed one (it goes to the Trash).
 */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick the photo to retry" }, { status: 400 });
  try {
    return Response.json({ items: retryPhoto(parsed.data.id) }, { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
