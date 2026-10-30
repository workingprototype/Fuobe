import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./db";

/**
 * Settings live in SQLite so they can be edited from the UI; environment variables
 * provide defaults (handy for Docker / self-hosting). Secrets never leave the server
 * unmasked.
 */
export interface SettingDef {
  key: string;
  /** Env var(s) that give the value when Settings has none; the first one set wins. */
  env?: string | readonly string[];
  secret?: boolean;
  default?: string;
  /** Allowed values (validated on save). */
  options?: readonly string[];
}

export const SETTINGS = {
  /** Which engines this install offers: open-source only, paid cloud APIs only, or both. */
  engineMode: { key: "engine.mode", env: "FUOBE_ENGINE_MODE", default: "both", options: ["both", "open", "cloud"] },
  /** Which aggregator to try first when a cloud model is on several. */
  cloudProvider: { key: "cloud.provider", env: "FUOBE_CLOUD_PROVIDER", default: "auto", options: ["auto", "fal", "replicate"] },
  falKey: { key: "fal.key", env: "FAL_KEY", secret: true },
  replicateToken: { key: "replicate.token", env: "REPLICATE_API_TOKEN", secret: true },
  openaiKey: { key: "openai.key", env: "OPENAI_API_KEY", secret: true },
  googleKey: { key: "google.key", env: "GEMINI_API_KEY", secret: true },
  anthropicKey: { key: "anthropic.key", env: "ANTHROPIC_API_KEY", secret: true },
  comfyUrl: { key: "comfyui.url", env: "COMFYUI_URL", default: "http://127.0.0.1:8188" },
  comfyToken: { key: "comfyui.token", env: "COMFYUI_TOKEN", secret: true },
  /** A second ComfyUI for workflows whose node packs can't share the main install (LatentSync 1.6, ThinkSound; scripts/comfy/README.md). */
  comfyIsolatedUrl: { key: "comfyui.isolatedUrl", env: "COMFYUI_ISOLATED_URL" },
  /**
   * ComfyUI's models/loras folder, when it's on this machine: trained LoRAs are copied there, and a recipe's
   * LoRAs (looks, motions) are downloaded there before a run needs them (src/server/loras.ts).
   */
  comfyLorasDir: { key: "comfyui.lorasDir", env: "COMFYUI_LORAS_DIR" },
  /** civitai API key: downloads the civitai LoRAs of a recipe (civitai answers 401 without one). Never sent to fal or Replicate. */
  civitaiKey: { key: "civitai.key", env: "CIVITAI_API_KEY", secret: true },
  /** AI-Toolkit UI (ostris/ai-toolkit, port 8675) for open-source character LoRA training. */
  aiToolkitUrl: { key: "aitk.url", env: "AI_TOOLKIT_URL" },
  aiToolkitToken: { key: "aitk.token", env: "AI_TOOLKIT_AUTH", secret: true },
  /** Where AI-Toolkit can read datasets Fuobe writes (defaults to Fuobe's data folder — same machine). */
  aiToolkitDatasetDir: { key: "aitk.datasetDir", env: "AI_TOOLKIT_DATASET_DIR" },
  /** "auto" = demo outputs only when the chosen provider is not configured. */
  demoMode: { key: "demo.mode", env: "FUOBE_DEMO_MODE", default: "auto", options: ["auto", "on", "off"] },
  /** Settings → AI helper: Claude, a local model, or offline. "ollama" is the old name of "local" and still means it. */
  enhanceProvider: { key: "enhance.provider", env: "FUOBE_ENHANCE_PROVIDER", default: "auto", options: ["auto", "anthropic", "local", "ollama", "none"] },
  /** Which local model server: "auto" uses the first that answers (Ollama, LM Studio, Unsloth Studio, then the custom URL). */
  llmProvider: { key: "llm.provider", env: "FUOBE_LLM_PROVIDER", default: "auto", options: ["auto", "ollama", "lmstudio", "unsloth", "custom"] },
  ollamaUrl: { key: "ollama.url", env: "OLLAMA_URL", default: "http://127.0.0.1:11434" },
  ollamaModel: { key: "ollama.model", env: "OLLAMA_MODEL", default: "qwen3:8b" },
  lmstudioUrl: { key: "lmstudio.url", env: "LMSTUDIO_URL", default: "http://127.0.0.1:1234" },
  /** Empty: a loaded model, else one trained for tool use. */
  lmstudioModel: { key: "lmstudio.model", env: "LMSTUDIO_MODEL" },
  /** Only when LM Studio's "Require Authentication" is on (LM_API_TOKEN also works). */
  lmstudioToken: { key: "lmstudio.token", env: ["LMSTUDIO_API_TOKEN", "LM_API_TOKEN"], secret: true },
  unslothUrl: { key: "unsloth.url", env: "UNSLOTH_URL", default: "http://127.0.0.1:8888" },
  /** Empty: the model loaded in Unsloth Studio. */
  unslothModel: { key: "unsloth.model", env: "UNSLOTH_MODEL" },
  /** An sk-unsloth-… key (UNSLOTH_STUDIO_AUTH_TOKEN also works); empty for keyless access. */
  unslothKey: { key: "unsloth.key", env: ["UNSLOTH_API_KEY", "UNSLOTH_STUDIO_AUTH_TOKEN"], secret: true },
  /** Any other OpenAI-compatible server (llama.cpp's llama-server, vLLM, Jan…): its base URL. */
  llmUrl: { key: "llm.url", env: "FUOBE_LLM_URL" },
  llmModel: { key: "llm.model", env: "FUOBE_LLM_MODEL" },
  llmKey: { key: "llm.key", env: "FUOBE_LLM_API_KEY", secret: true },
  /** Tokens of context the local model gets (Ollama's num_ctx; LM Studio loads models with it). 0 = the server's own setting. */
  llmContext: { key: "llm.context", env: "FUOBE_LLM_CONTEXT", default: "16384" },
  /** "1" once the first-run guide was put away, or /api/status first saw something the engine mode generates with connected: Home stops offering it. */
  onboarded: { key: "onboarding.done", default: "0", options: ["0", "1"] },
} satisfies Record<string, SettingDef>;

export type SettingName = keyof typeof SETTINGS;

/** The first of a setting's env vars that is set. */
const envValue = (def: SettingDef): string | undefined => [def.env ?? []].flat().map((n) => process.env[n]).find((v) => !!v);

/** Unsaved values a connection test runs with (withCandidates), in place of the saved ones. */
const candidates = new AsyncLocalStorage<Partial<Record<SettingName, string>>>();

/**
 * Run `fn` as if these settings were saved: Settings' "Save & test" tests a typed key or URL before
 * writing it. An empty value reads as unset (the environment variable or the default). Nothing is stored.
 */
export function withCandidates<T>(values: Partial<Record<SettingName, string>>, fn: () => T): T {
  return candidates.run(values, fn);
}

/** Inside withCandidates: whether `name` is being tried with an unsaved value. */
export function isCandidate(name: SettingName): boolean {
  return candidates.getStore()?.[name] !== undefined;
}

/** The value in effect without the unsaved ones (saved, environment or default), also inside withCandidates. */
export function savedSetting(name: SettingName): string {
  return candidates.exit(() => getSetting(name));
}

export function getSetting(name: SettingName): string {
  const def: SettingDef = SETTINGS[name];
  const candidate = candidates.getStore()?.[name];
  const row = candidate !== undefined ? { value: candidate.trim() } : (db().prepare("SELECT value FROM settings WHERE key = ?").get(def.key) as { value: string } | undefined);
  const value = row && row.value !== "" ? row.value : (envValue(def) ?? def.default ?? "");
  // An invalid env/db value falls back to the default instead of breaking routing.
  if (def.options && !def.options.includes(value)) return def.default ?? "";
  return value;
}

export type EngineMode = "both" | "open" | "cloud";

export function engineMode(): EngineMode {
  return getSetting("engineMode") as EngineMode;
}

/**
 * A context size as people write it: 16384, "16,384" or "16k" (k = 1024 tokens). 0 leaves it to the
 * server. Null: not a size, or under 2048 tokens (too small for any step; "16" was meant as 16k).
 */
export function parseContext(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(k?)$/i.exec(value.replace(/[,_\s]/g, ""));
  if (!m) return null;
  const n = Math.round(Number(m[1]) * (m[2] ? 1024 : 1));
  return n === 0 ? 0 : n >= 2048 ? Math.min(n, 1_048_576) : null;
}

/** Throws a user-facing message if the setting value isn't allowed. */
export function validateSetting(name: SettingName, value: string): void {
  const def: SettingDef = SETTINGS[name];
  if (value !== "" && def.options && !def.options.includes(value)) {
    throw new Error(`${name} must be one of: ${def.options.join(", ")}`);
  }
  if (name === "llmContext" && value !== "" && parseContext(value) === null) {
    throw new Error("llmContext must be a number of tokens of at least 2048 (such as 16384 or 16k), or 0 to leave it to the server");
  }
}

export function setSetting(name: SettingName, value: string): void {
  validateSetting(name, value);
  const def = SETTINGS[name];
  if (value === "") {
    db().prepare("DELETE FROM settings WHERE key = ?").run(def.key);
    return;
  }
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(def.key, value);
}

export function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export interface PublicSetting {
  name: SettingName;
  value: string;
  secret: boolean;
  fromEnv: boolean;
  isSet: boolean;
}

export function publicSettings(): PublicSetting[] {
  return (Object.keys(SETTINGS) as SettingName[]).map((name) => {
    const def: SettingDef = SETTINGS[name];
    const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(def.key) as { value: string } | undefined;
    const value = getSetting(name);
    return {
      name,
      value: def.secret ? mask(value) : value,
      secret: !!def.secret,
      fromEnv: !row && !!envValue(def),
      isSet: !!value && value !== def.default,
    };
  });
}
