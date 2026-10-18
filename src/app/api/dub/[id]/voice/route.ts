import { z } from "zod";
import { CueSchema, getDubSession, voiceDub } from "@/server/dub";

const Body = z.object({
  lang: z.string().min(2).max(12),
  /** The reviewed lines (saved with the run); omitted = the saved draft or the translation. */
  cues: z.array(CueSchema).max(3000).optional(),
  lipsync: z.boolean().optional(),
});

/** Speak one language's reviewed lines in the cloned voice: the voice pipeline. */
export async function POST(request: Request, ctx: RouteContext<"/api/dub/[id]/voice">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick the language to voice" }, { status: 400 });
  if (!getDubSession(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json(voiceDub(id, parsed.data.lang, { cues: parsed.data.cues, lipsync: parsed.data.lipsync }), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
