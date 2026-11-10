import type { ModelOptions } from "@/lib/catalog/types";
import { SPEED_PARAM } from "@/lib/qwen21-speed";

/**
 * Qwen-Image-Edit 2511's Options → Speed on your GPU. Pure: the provider (src/server/providers/comfyui.ts) and the GPU
 * pre-flight's gate both resolve a run's graph through resolveWorkflowId (src/lib/comfy-variants.ts), which reads this.
 *
 * - Fast (the default, and what a run that sends no speed takes): the 4-step graph, the base graph with LightX2V's
 *   Qwen-Image-Edit-2511 Lightning LoRA after the model loader, 4 steps at CFG 1 (scripts/comfy/library.spec.mjs). Its
 *   steps and CFG are the LoRA's own, so it binds neither.
 * - Best: the base graph as it was, 40 steps at CFG 4.
 *
 * The same params key as Qwen-Image 2.1's speed (params.extra.speed); the values are this model's own.
 */

export type QwenEditSpeed = "fast" | "best";

/** Each base graph's Fast graph (the base graph is Best). */
export const QWEN_EDIT_FAST_GRAPH: Record<string, string> = {
  "qwen-image-edit-2511-multi": "qwen-image-edit-2511-multi-fast",
};

/** The LoRA the Fast graph loads (pinned in workflows/comfyui/model-pins.json). */
export const QWEN_EDIT_FAST_LORA = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";

type Control = NonNullable<ModelOptions["controls"]>[number];

/** Options → Speed (the default is Fast). */
export const QWEN_EDIT_SPEED: Control = {
  param: SPEED_PARAM,
  label: "Speed",
  values: ["fast", "best"],
  default: "fast",
  labels: {
    fast: "Fast · about 4 steps",
    best: "Best · 40 steps, slower",
  },
};

/** The graph a Qwen-Image-Edit 2511 run takes: Best keeps `endpoint`; any other speed, or none, takes its Fast graph. */
export function qwenEditGraph(endpoint: string, extra: Record<string, unknown>, has: (id: string) => boolean): string {
  const fast = QWEN_EDIT_FAST_GRAPH[endpoint];
  if (!fast || extra[SPEED_PARAM] === "best") return endpoint;
  return has(fast) ? fast : endpoint;
}
