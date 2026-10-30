import { preflightOn } from "@/server/gpu/index-file";
import { interactiveRefusal } from "@/server/gpu/gate";
import { gpuTargetFor } from "@/server/gpu/target";

/**
 * GPU pre-flight, browser-direct mode: the tab reads a ComfyUI on the visitor's own computer and sends what it
 * found. Accepted only for an account whose GPU is in browser mode, never for the studio's own ComfyUI, and a
 * browser's facts never stand in for a server check (review 18). Browser mode isn't part of an account's GPU
 * yet, so every request is refused for now.
 */
export async function PUT(request: Request) {
  if (!preflightOn()) return Response.json({ error: "The GPU pre-flight is switched off on this studio." }, { status: 404 });
  const refused = interactiveRefusal(request);
  if (refused) return Response.json({ error: refused }, { status: 403 });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "install") return Response.json({ error: "The studio's own ComfyUI is checked by the server." }, { status: 403 });
  return Response.json(
    { error: "Checking a ComfyUI from this browser isn't available yet. Connect it with a tunnel link instead.", code: "browser-mode-off" },
    { status: 409 },
  );
}
