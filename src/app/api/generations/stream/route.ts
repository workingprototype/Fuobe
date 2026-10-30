import { connection } from "next/server";
import { ensureRunner } from "@/server/generations";
import { generationEventStream } from "@/server/live";
import { handler } from "@/server/access/route";

/**
 * Live generation updates (server-sent events), behind the same sign-in as the REST API (proxy):
 *   event: generation   data: the Generation JSON, exactly as GET /api/generations returns it
 *   event: deleted      data: {"id": "…"}
 *   : ping              every 15 s
 * Sent on every insert or update of a generation row (status, progress, outputs…).
 */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  // Never prerendered, and the runner that produces the updates is running.
  await connection();
  ensureRunner();
  return generationEventStream(request.signal);
});
