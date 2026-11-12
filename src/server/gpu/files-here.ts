import "server-only";
import { hasVariants, swapGraphFiles } from "@/lib/gpu/model-variants";
import { filesHere } from "@/lib/gpu/readiness";
import type { RequirementIndex } from "@/lib/gpu/types";
import { loadIndex } from "./index-file";
import { readSnapshot } from "./snapshots";
import { runTarget } from "./target";

/**
 * A run on a ComfyUI the GPU check reads (a person's own GPU, or this install's own): the graph with a model variant's
 * files in its model slots when the check found that variant's files there and not the workflow's own (the same choice
 * the check's readiness makes: src/lib/gpu/readiness.ts filesHere). Otherwise, and with no check to read, the graph as
 * it was. Runs on the workers never come here: their files are chosen when a worker takes the job (pool.ts workerFiles).
 */
export function withFilesHere<G extends Record<string, { class_type: string; inputs: Record<string, unknown> }>>(graph: G, workflowId: string, index: RequirementIndex = loadIndex()): G {
  if (!hasVariants(index, workflowId)) return graph;
  const t = runTarget();
  const snap = t ? readSnapshot(t) : null;
  if (!snap?.inventory.reachable) return graph;
  const choice = filesHere(workflowId, snap.inventory, index);
  return choice?.variant ? swapGraphFiles(graph, choice.swap, index) : graph;
}
