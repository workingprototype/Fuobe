import { connection } from "next/server";
import { PROVIDERS } from "@/server/providers";
import { probeComfy } from "@/server/providers/comfyui";
import { nothingConnected, type EngineModeName } from "@/lib/connections";
import { getSetting, setSetting } from "@/server/settings";

/** Which providers are usable right now — drives badges, the demo-mode notice and Home's first-run guide. */
export async function GET() {
  await connection();
  const comfy = await probeComfy(true);
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [
      p.id,
      { label: p.label, configured: p.id === "comfyui" ? comfy : p.id === "mock" ? true : p.isConfigured() },
    ]),
  );
  const engineMode = getSetting("engineMode") as EngineModeName;
  // The first time something this engine mode generates with is connected, the first-run guide has
  // done its job: remember it, so a ComfyUI that is offline one morning doesn't bring "Get started" back.
  let onboarded = getSetting("onboarded") === "1";
  if (!onboarded && !nothingConnected({ providers, engineMode })) {
    setSetting("onboarded", "1");
    onboarded = true;
  }
  return Response.json({
    providers,
    demoMode: getSetting("demoMode"),
    engineMode,
    cloudProvider: getSetting("cloudProvider"),
    onboarded,
  });
}
