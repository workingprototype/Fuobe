import { connection } from "next/server";
import { PROVIDERS } from "@/server/providers";
import { probeComfy } from "@/server/providers/comfyui";
import { getSetting } from "@/server/settings";

/** Which providers are usable right now — drives badges and the demo-mode banner. */
export async function GET() {
  await connection();
  const comfy = await probeComfy(true);
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [
      p.id,
      { label: p.label, configured: p.id === "comfyui" ? comfy : p.id === "mock" ? true : p.isConfigured() },
    ]),
  );
  return Response.json({
    providers,
    demoMode: getSetting("demoMode"),
    engineMode: getSetting("engineMode"),
    cloudProvider: getSetting("cloudProvider"),
  });
}
