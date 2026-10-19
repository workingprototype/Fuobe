import { z } from "zod";
import { failure, readBody, saveRunComposite } from "@/server/marketing";

const Body = z.object({ url: z.string().startsWith("/api/files/"), ratio: z.string().regex(/^\d+:\d+$/), text: z.string().max(1000).default("") });

/** Save an open-engine result with its words set in the browser (an uploaded PNG) to the Library. */
export async function POST(request: Request, ctx: RouteContext<"/api/marketing/runs/[id]/compose">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Body, "Upload the image first");
  if (body instanceof Response) return body;
  try {
    return Response.json(saveRunComposite(id, body), { status: 201 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
}
