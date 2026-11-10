import "server-only";
import { getModel } from "@/lib/catalog";
import type { Operation } from "@/lib/catalog/types";
import { workflowReadiness } from "@/lib/gpu/readiness";
import { loadIndex, preflightOn } from "./gpu/index-file";
import { contextFor } from "./gpu/readiness-service";
import { readSnapshot } from "./gpu/snapshots";
import { runTarget } from "./gpu/target";
import { poolOnWorkers, poolTakes } from "./hosted";
import { ownGpu } from "./providers/comfyui";

/**
 * Whether the GPUs a run in the current scope goes to can take a model's lane for this operation, for Auto's models whose
 * lane needs a large GPU (src/lib/auto-image.ts AUTO_LARGE_MODELS). Read where the run is planned, in the run's own scope
 * (the owner's, an account's own GPU, or this install's GPUs for an account or a guest):
 *
 * - This install's GPUs on the workers (no GPU of the run's own): a worker allowed the graph's lane holds its files and node
 *   packs and has the VRAM the requirements index asks for it (hosted.ts poolTakes, the check a run there meets before Run).
 * - A ComfyUI the GPU check reads (this install's own server, an account's own GPU, a ComfyUI on a computer): its last check
 *   reads the graph ready (its files, node packs and nodes) on a card with the VRAM it needs. A CPU never fits.
 * - No check to read (the pre-flight is off, or that ComfyUI hasn't been read yet): yes. The run is tried, and if its job
 *   fails, Auto's next model makes it (src/server/generations.ts autoFails).
 */
export function autoFitsHere(modelId: string, op: Operation): boolean {
  const route = getModel(modelId)?.routes.find((r) => r.op === op && r.provider === "comfyui");
  if (!route) return true;
  const graph = route.endpoint;
  if (!ownGpu() && poolOnWorkers()) return poolTakes(graph);
  if (!preflightOn()) return true;
  const t = runTarget();
  const snap = t ? readSnapshot(t) : null;
  if (!t || !snap?.inventory.reachable) return true;
  const index = loadIndex();
  if (!index.workflows[graph]) return true;
  const r = workflowReadiness(graph, snap.inventory, index, contextFor(t));
  return r.state === "ready" && (r.vram.fit === "fits" || r.vram.fit === "any");
}
