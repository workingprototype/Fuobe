import { framesProgress } from "@/server/mixed-media";
import { handle } from "@/server/shorts-schemas";

/** How far a per-frame render's frame edits are (?batch=<the render's batch id>): counts, and the first frame that failed. */
export async function GET(request: Request) {
  return handle(() => {
    const batch = new URL(request.url).searchParams.get("batch")?.trim() ?? "";
    if (!batch || batch.length > 64) return Response.json({ error: "Which render?" }, { status: 400 });
    return Response.json(framesProgress(batch));
  });
}
