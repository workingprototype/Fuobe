import { framesProgress } from "@/server/mixed-media";
import { handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** How far a per-frame render's frame edits are (?id=<the render's finished video>): counts, and the first frame that failed. */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(() => {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id || id.length > 64) return Response.json({ error: "Which render?" }, { status: 400 });
    const progress = framesProgress(id);
    return progress ? Response.json(progress) : Response.json({ error: "This render no longer exists" }, { status: 404 });
  });
});
