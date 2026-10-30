import { BatchBody, estimateBatch } from "@/server/ads";
import { readBody } from "@/server/marketing";
import { handler } from "@/server/access/route";

/** The total before the run: ads × price per ad (+ the copy), and which model renders them. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const body = await readBody(request, BatchBody, "Pick products and how many ads to make");
  if (body instanceof Response) return body;
  try {
    return Response.json(estimateBatch(body));
  } catch (e) {
    return Response.json({ costUsd: null, total: 0, perAd: null, demo: false, blocker: (e as Error).message });
  }
});
