import { fileResponse } from "@/server/file-response";

export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const { path: parts } = await ctx.params;
  let rel: string;
  try {
    rel = parts.map(decodeURIComponent).join("/");
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  return fileResponse(request, rel);
}
