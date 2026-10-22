import "server-only";
import { db } from "./db";

/**
 * Settings live in SQLite so they can be edited from the UI; environment variables
 * provide defaults (handy for Docker / self-hosting). Secrets never leave the server
 * unmasked.
 */
export interface SettingDef {
  key: string;
  env?: string;
  secret?: boolean;
  default?: string;
  /** Allowed values (validated on save). */
  options?: readonly string[];
}

export const SETTINGS = {
  /** Which engines this install offers: open-source only, paid cloud APIs only, or both. */
  engineMode: { key: "engine.mode", env: "FUOBE_ENGINE_MODE", default: "both", options: ["both", "open", "cloud"] },
  /** Which aggregator to try first when a cloud model is on several. */
  cloudProvider: { key: "cloud.provider", env: "FUOBE_CLOUD_PROVIDER", default: "auto", options: ["auto", "fal", "replicate", "higgsfield"] },
  falKey: { key: "fal.key", env: "FAL_KEY", secret: true },
  replicateToken: { key: "replicate.token", env: "REPLICATE_API_TOKEN", secret: true },
  /** "KEY_ID:KEY_SECRET" from console.higgsfield.ai (HF_KEY / HF_API_KEY + HF_API_SECRET also work). */
  higgsfieldKey: { key: "higgsfield.key", env: "HIGGSFIELD_API_KEY", secret: true },
  openaiKey: { key: "openai.key", env: "OPENAI_API_KEY", secret: true },
  googleKey: { key: "google.key", env: "GEMINI_API_KEY", secret: true },
  anthropicKey: { key: "anthropic.key", env: "ANTHROPIC_API_KEY", secret: true },
  comfyUrl: { key: "comfyui.url", env: "COMFYUI_URL", default: "http://127.0.0.1:8188" },
  comfyToken: { key: "comfyui.token", env: "COMFYUI_TOKEN", secret: true },
  /** A second ComfyUI for workflows whose node packs can't share the main install (LatentSync 1.6, ThinkSound; scripts/comfy/README.md). */
  comfyIsolatedUrl: { key: "comfyui.isolatedUrl", env: "COMFYUI_ISOLATED_URL" },
  /** ComfyUI's models/loras folder, when it's on this machine: trained LoRAs are copied there. */
  comfyLorasDir: { key: "comfyui.lorasDir", env: "COMFYUI_LORAS_DIR" },
  /** AI-Toolkit UI (ostris/ai-toolkit, port 8675) for open-source character LoRA training. */
  aiToolkitUrl: { key: "aitk.url", env: "AI_TOOLKIT_URL" },
  aiToolkitToken: { key: "aitk.token", env: "AI_TOOLKIT_AUTH", secret: true },
  /** Where AI-Toolkit can read datasets Fuobe writes (defaults to Fuobe's data folder — same machine). */
  aiToolkitDatasetDir: { key: "aitk.datasetDir", env: "AI_TOOLKIT_DATASET_DIR" },
  /** "auto" = demo outputs only when the chosen provider is not configured. */
  demoMode: { key: "demo.mode", env: "FUOBE_DEMO_MODE", default: "auto", options: ["auto", "on", "off"] },
  enhanceProvider: { key: "enhance.provider", env: "FUOBE_ENHANCE_PROVIDER", default: "auto", options: ["auto", "anthropic", "ollama", "none"] },
  ollamaUrl: { key: "ollama.url", env: "OLLAMA_URL", default: "http://127.0.0.1:11434" },
  ollamaModel: { key: "ollama.model", env: "OLLAMA_MODEL", default: "qwen3:8b" },
} satisfies Record<string, SettingDef>;

export type SettingName = keyof typeof SETTINGS;

export function getSetting(name: SettingName): string {
  const def: SettingDef = SETTINGS[name];
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(def.key) as { value: string } | undefined;
  const value = row && row.value !== "" ? row.value : def.env && process.env[def.env] ? process.env[def.env]! : (def.default ?? "");
  // An invalid env/db value falls back to the default instead of breaking routing.
  if (def.options && !def.options.includes(value)) return def.default ?? "";
  return value;
}

export type EngineMode = "both" | "open" | "cloud";

export function engineMode(): EngineMode {
  return getSetting("engineMode") as EngineMode;
}

/** Throws a user-facing message if the setting value isn't allowed. */
export function validateSetting(name: SettingName, value: string): void {
  const def: SettingDef = SETTINGS[name];
  if (value !== "" && def.options && !def.options.includes(value)) {
    throw new Error(`${name} must be one of: ${def.options.join(", ")}`);
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
      fromEnv: !row && !!def.env && !!process.env[def.env],
      isSet: !!value && value !== def.default,
    };
  });
}
