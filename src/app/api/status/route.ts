import { connection } from "next/server";
import { PROVIDERS } from "@/server/providers";
import { comfyRam, probeComfy } from "@/server/providers/comfyui";
import { nothingConnected, type EngineModeName } from "@/lib/connections";
import { getSetting, setSetting } from "@/server/settings";
import { offeredSummary } from "@/server/model-access";
import { handler } from "@/server/access/route";

/** Which providers are usable right now — drives badges, the demo-mode notice and Home's first-run guide. */
export const GET = handler({ access: "signed-in" }, async () => {
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
  const engineMode = getSetting("engineMode") as EngineModeName;
  const access = offeredSummary();
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
    // Settings → Models & licences: the models switched off, so pickers leave them out (absent while everything is on).
    ...(access && { access }),
  });
});
