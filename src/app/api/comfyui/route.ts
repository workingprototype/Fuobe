import { connection } from "next/server";
import { requestViewer } from "@/server/auth";
import { loadManifest, modelInventory, probeComfy } from "@/server/providers/comfyui";

/**
 * Workflow library + which required models are present on the connected server. A guest or an account (public
 * sign-up) gets the library only: the studio's own ComfyUI is neither asked nor described to them (its files
 * aren't theirs, and an open read would let anyone make the studio's GPU answer). Their own GPU is on /connect.
 */
export async function GET(request?: Request) {
  await connection();
  const manifest = loadManifest();
  const visitor = !!request && requestViewer(request).kind !== "owner";
  const reachable = visitor ? null : await probeComfy(true);
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
