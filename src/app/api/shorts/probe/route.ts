import { z } from "zod";
import { probeSource } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** An uploaded clip's length, size, frame rate and whether it has sound (from its MP4 / MOV header). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const { url } = await body(request, z.object({ url: z.string().startsWith("/api/files/").max(500) }), "Upload the clip first");
    return Response.json(await probeSource(url));
  });
});
