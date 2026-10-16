import { connection } from "next/server";
import { loadManifest, modelInventory, probeComfy } from "@/server/providers/comfyui";

/** Workflow library + which required models are present on the connected server. */
export async function GET() {
  await connection();
  const manifest = loadManifest();
  const reachable = await probeComfy(true);
  const inventory = reachable ? await modelInventory() : null;
  const present = new Set(Object.values(inventory ?? {}).flat());
  return Response.json({
    reachable,
    generatedAt: manifest.generatedAt,
    comfyuiCommit: manifest.comfyuiCommit,
    workflows: manifest.workflows.map((w) => ({
      ...w,
      models: w.models.map((m) => ({ ...m, present: inventory ? present.has(m.file) : null })),
    })),
  });
}
