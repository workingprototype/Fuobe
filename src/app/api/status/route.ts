import { connection } from "next/server";
import { aiHelper, localSummary } from "@/server/llm";
import { PROVIDERS } from "@/server/providers";
import { probeComfy } from "@/server/providers/comfyui";
import { llmBackends } from "@/server/providers/llm";
import { getSetting } from "@/server/settings";

/** Which providers are usable right now — drives badges and the demo-mode banner. */
export async function GET() {
  await connection();
  // Both asked first, so the llm provider's label and routing read fresh answers without waiting.
  const [comfy, local] = await Promise.all([probeComfy(true), localSummary()]);
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
    // The text LLM: the AI helper setting, whether Claude takes text steps, and the local server (no keys).
    llm: { helper: aiHelper(), claude: llmBackends({ endpoint: "auto" })[0] === "claude", ...local },
  });
}
