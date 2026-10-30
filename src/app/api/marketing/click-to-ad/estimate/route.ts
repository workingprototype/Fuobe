import { ClickToAdBody, estimateClickToAd, readBody } from "@/server/marketing";
import { handler } from "@/server/access/route";

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const body = await readBody(request, ClickToAdBody, "Select a product or enter a product URL");
  if (body instanceof Response) return body;
  try {
    return Response.json(estimateClickToAd(body));
  } catch (e) {
    return Response.json({ costUsd: null, demo: false, steps: [], notes: [], runs: 0, blocker: (e as Error).message });
  }
});
