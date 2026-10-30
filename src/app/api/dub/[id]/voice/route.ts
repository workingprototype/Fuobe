import { z } from "zod";
import { CueSchema, getDubSession, previewVoiceDub, voiceDub } from "@/server/dub";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Body = z.object({
  lang: z.string().min(2).max(12),
  /** The reviewed lines (saved with the run); omitted = the saved draft or the translation. */
  cues: z.array(CueSchema).max(3000).optional(),
  lipsync: z.boolean().optional(),
});

/** Speak one language's reviewed lines in the cloned voice: the voice pipeline; `?preview=1` only prices it. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/dub/[id]/voice">) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick the language to voice" }, { status: 400 });
  if (!getDubSession(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const opts = { cues: parsed.data.cues, lipsync: parsed.data.lipsync };
    if (new URL(request.url).searchParams.get("preview") === "1") return Response.json(previewVoiceDub(id, parsed.data.lang, opts));
    return Response.json(voiceDub(id, parsed.data.lang, opts), { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
