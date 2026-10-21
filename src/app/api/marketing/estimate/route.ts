import { estimateMarketing, MarketingBody, readBody } from "@/server/marketing";

/** Price and check a Marketing Studio run before it starts; what's missing comes back as `blocker`. */
export async function POST(request: Request) {
  const body = await readBody(request, MarketingBody);
  if (body instanceof Response) return body;
  try {
    return Response.json(estimateMarketing(body));
  } catch (e) {
    return Response.json({ costUsd: null, demo: false, steps: [], notes: [], runs: 0, blocker: (e as Error).message });
  }
}
