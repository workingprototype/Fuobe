import { AudioToolBody, AudioToolError, previewAudioTool, runAudioTool } from "@/server/audio-tools";
import { priceAs } from "@/server/visitor";

/** Audio → Loop / extend and Join: start a run; `?preview=1` only plans and prices it. */
async function post(request: Request) {
  const parsed = AudioToolBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    const msg = path.startsWith("clips")
      ? "Add 2 to 10 audio clips to join"
      : path === "audio"
        ? "Add the audio to loop"
        : path === "duration"
          ? "Pick a length up to 10 minutes"
          : path === "crossfade"
            ? "Keep the crossfade between 0 and 10 seconds"
            : "Check the settings";
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
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
