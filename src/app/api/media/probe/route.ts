import { z } from "zod";
import { requestAccount } from "@/server/auth";
import { probeSource } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";
import { runAsTenant } from "@/server/tenant";

/**
 * An uploaded clip's length, size, frame rate and whether it has sound, from its header (MP4 / MOV, WebM).
 * The composer prices clip-length tools with it and says what comes out (Upscale hub: "24 → 60 fps").
 * An account reads only its own files: another's answers like one that is gone.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { url } = await body(request, z.object({ url: z.string().startsWith("/api/files/").max(500) }), "Upload the clip first");
    const account = requestAccount(request);
    const info = account ? await runAsTenant({ kind: "account", id: account.id }, () => probeSource(url)) : await probeSource(url);
    return Response.json(info);
  });
}
