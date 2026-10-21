import "server-only";
import type { ProviderId } from "@/lib/catalog/types";
import { comfyProvider } from "./comfyui";
import { falProvider } from "./fal";
import { higgsfieldProvider } from "./higgsfield";
import { llmProvider } from "./llm";
import { mockProvider } from "./mock";
import { replicateProvider } from "./replicate";
import type { ProviderAdapter } from "./types";

const notImplemented = (id: ProviderId, label: string): ProviderAdapter => ({
  id,
  label,
  isConfigured: () => false,
  prepareFile: async () => {
    throw new Error(`${label} adapter is not implemented yet`);
  },
  submit: async () => {
    throw new Error(`${label} adapter is not implemented yet — route this model through fal or replicate`);
  },
  poll: async () => ({ state: "failed", error: `${label} adapter is not implemented yet` }),
});

/** Work done in the browser (colour grading) and recorded afterwards; never submitted or polled. */
const localProvider: ProviderAdapter = {
  id: "local",
  label: "In your browser",
  isConfigured: () => true,
  prepareFile: async () => {
    throw new Error("Runs in the browser");
  },
  submit: async () => {
    throw new Error("Runs in the browser");
  },
  poll: async () => ({ state: "failed", error: "Runs in the browser" }),
};

export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  fal: falProvider,
  replicate: replicateProvider,
  higgsfield: higgsfieldProvider,
  comfyui: comfyProvider,
  mock: mockProvider,
  local: localProvider,
  openai: notImplemented("openai", "OpenAI"),
  google: notImplemented("google", "Google"),
  llm: llmProvider,
};

export function provider(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}
