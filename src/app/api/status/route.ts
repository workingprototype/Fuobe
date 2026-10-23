import { connection } from "next/server";
import { PROVIDERS } from "@/server/providers";
import { comfyRam, probeComfy } from "@/server/providers/comfyui";
import { getSetting } from "@/server/settings";

/** Which providers are usable right now — drives badges and the demo-mode banner. */
export async function GET() {
  await connection();
  const comfy = await probeComfy(true);
  const ram = comfy ? comfyRam() : undefined;
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [
      p.id,
      // ComfyUI's RAM: the composer checks the tools that hold a whole clip against it before Generate.
      { label: p.label, configured: p.id === "comfyui" ? comfy : p.id === "mock" ? true : p.isConfigured(), ...(p.id === "comfyui" && ram ? { ramBytes: ram } : {}) },
    ]),
  );
  return Response.json({
    providers,
    demoMode: getSetting("demoMode"),
    engineMode: getSetting("engineMode"),
    cloudProvider: getSetting("cloudProvider"),
  });
}
