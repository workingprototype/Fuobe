import "server-only";
import type { ProviderId } from "@/lib/catalog/types";
import { comfyProvider } from "./comfyui";
import { falProvider } from "./fal";
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

export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  fal: falProvider,
  replicate: replicateProvider,
  comfyui: comfyProvider,
  mock: mockProvider,
  openai: notImplemented("openai", "OpenAI"),
  google: notImplemented("google", "Google"),
};

export function provider(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}
