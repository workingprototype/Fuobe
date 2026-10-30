import { fileResponse } from "@/server/file-response";
import { handler } from "@/server/access/route";

export const GET = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/files/[...path]">) => {
  const { path: parts } = await ctx.params;
  let rel: string;
  try {
    rel = parts.map(decodeURIComponent).join("/");
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  return fileResponse(request, rel);
});
