import { failure, MultiplierBody, readBody, runMultiplier } from "@/server/marketing";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

/** Ad Multiplier: new versions of a reference ad (the whole ad from a prompt, or a new hook / CTA around it). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const body = await readBody(request, MultiplierBody, "Add a reference video to recreate");
  if (body instanceof Response) return body;
  try {
    return Response.json({ runs: await runMultiplier(body) }, { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return failure(e);
  }
});
