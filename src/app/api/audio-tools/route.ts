import { AudioToolBody, AudioToolError, previewAudioTool, runAudioTool } from "@/server/audio-tools";
import { handler } from "@/server/access/route";

/** What a field that doesn't check out means, in words the page shows. */
const MESSAGES: Record<string, string> = {
  media: "Add the audio or video to split",
  video: "Add the video to put the mix on",
  audio: "Add the audio to loop",
  duration: "Pick a length up to 10 minutes",
  crossfade: "Keep the crossfade between 0 and 10 seconds",
};

/** Audio → Loop / extend, Join and Split soundtrack (and a split's mix put back on its video): start a run; `?preview=1` only plans and prices it. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = AudioToolBody.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    const remux = (raw as { tool?: unknown } | null)?.tool === "remux";
    const msg = path.startsWith("clips") ? "Add 2 to 10 audio clips to join" : remux && path === "audio" ? "Export the mix first" : (MESSAGES[path] ?? "Check the settings");
    return Response.json({ error: msg }, { status: 400 });
  }
  try {
    if (new URL(request.url).searchParams.get("preview") === "1") return Response.json(await previewAudioTool(parsed.data));
    return Response.json(await runAudioTool(parsed.data), { status: 201 });
  } catch (e) {
    if (e instanceof AudioToolError) return Response.json({ error: e.message }, { status: 422 });
    console.error("[audio-tools]", e);
    return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
});
