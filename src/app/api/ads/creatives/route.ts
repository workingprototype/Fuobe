import { connection } from "next/server";
import { listCreatives } from "@/server/ads";
import { handler } from "@/server/access/route";

/** A brand's ads (`?brand=<id>`, optionally `&batch=` or `&product=`), newest run first. */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  await connection();
  const q = new URL(request.url).searchParams;
  const brandId = q.get("brand");
  if (!brandId) return Response.json({ error: "Pick a brand" }, { status: 400 });
  return Response.json({ items: listCreatives({ brandId, batchId: q.get("batch") ?? undefined, productId: q.get("product") ?? undefined }) });
});
