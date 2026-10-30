import { POST as influencer } from "../route";
import { handler } from "@/server/access/route";

/**
 * The price of an AI Influencer run without starting it: the same body as POST /api/influencer?preview=1, at the
 * `<route>/estimate` path the evaluation harness prices studio routes at.
 */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const url = new URL(request.url.replace(/\/estimate(?=\/?(\?|$))/, ""));
  url.searchParams.set("preview", "1");
  return influencer(new Request(url, { method: "POST", headers: request.headers, body: await request.text() }));
});
