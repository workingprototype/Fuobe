import { estimateMultiplier, MultiplierBody, readBody } from "@/server/marketing";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const body = await readBody(request, MultiplierBody, "Add a reference video to recreate");
  if (body instanceof Response) return body;
  try {
    return Response.json(await estimateMultiplier(body));
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ costUsd: null, demo: false, steps: [], notes: [], runs: 0, blocker: (e as Error).message });
  }
});
