/**
 * Connecting Fuobe to models, as pure logic shared by Settings, Home's first-run guide and the
 * connection test route: which settings each provider's test reads, what a well-formed key or
 * address looks like, when to offer the first-run guide, and each connection's one-line status.
 */

export type TestProvider = "fal" | "replicate" | "higgsfield" | "comfyui" | "llm" | "civitai";

/** The settings each provider's connection test reads; an unsaved value for one of them can be tested before it's saved. */
export const PROVIDER_SETTINGS = {
  fal: ["falKey"],
  replicate: ["replicateToken"],
  higgsfield: ["higgsfieldKey"],
  comfyui: ["comfyUrl", "comfyToken", "comfyIsolatedUrl"],
  llm: ["anthropicKey", "ollamaUrl", "ollamaModel", "enhanceProvider"],
  // Not a model provider: the key that downloads a recipe's civitai LoRAs (Settings → LoRAs).
  civitai: ["civitaiKey"],
} as const satisfies Record<TestProvider, readonly string[]>;

export type ConnectionSetting = (typeof PROVIDER_SETTINGS)[TestProvider][number];

export const isTestProvider = (p: unknown): p is TestProvider => typeof p === "string" && Object.hasOwn(PROVIDER_SETTINGS, p);

/**
 * The unsaved values a test request carries, kept to the settings that provider's test reads:
 * `values` by setting name, or `value` for the provider's main one (its key, or ComfyUI's address).
 */
export function candidateValues(provider: TestProvider, values?: unknown, value?: unknown): Partial<Record<ConnectionSetting, string>> {
  const allowed: readonly ConnectionSetting[] = PROVIDER_SETTINGS[provider];
  const out: Partial<Record<ConnectionSetting, string>> = {};
  if (typeof value === "string") out[allowed[0]] = value.trim();
  if (values && typeof values === "object") {
    for (const [k, v] of Object.entries(values)) if (typeof v === "string" && allowed.includes(k as ConnectionSetting)) out[k as ConnectionSetting] = v.trim();
  }
  return out;
}

/** Where to get a civitai API key (Settings → LoRAs links to it). */
export const CIVITAI_KEYS_URL = "https://civitai.com/user/account";
/** Where to get a fal.ai key (the guide and Settings link to it). */
export const FAL_KEYS_URL = "https://fal.ai/dashboard/keys";
/** The ComfyUI address a local install listens on. */
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
/** Fuobe's source, for the install scripts and licences. */
export const FUOBE_REPO = "https://github.com/workingprototype/fuobe";
/** How to install ComfyUI with every node pack Fuobe's workflows use. */
export const COMFY_INSTALL_DOCS = `${FUOBE_REPO}/blob/main/scripts/comfy/README.md`;
export const COMFY_INSTALL_COMMAND = "bash scripts/comfy/install-comfyui.sh";

/** key_id:key_secret, both halves present and no spaces. */
const KEY_PAIR = /^[^\s:]+:[^\s:]+$/;

function addressProblem(v: string, example: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? null : `Use an http:// or https:// address, like ${example}`;
  } catch {
    return /^[\w.-]+(:\d+)?(\/\S*)?$/.test(v) ? `Add http:// in front: http://${v}` : `That isn't a web address — try ${example}`;
  }
}

/**
 * What's wrong with a value typed into a connection field, said the way to fix it; null when it
 * looks right (or is empty, which clears it). A warning only: the test has the final word.
 */
export function settingProblem(name: string, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (name) {
    case "falKey":
      if (KEY_PAIR.test(v)) return null;
      return v.includes(":") ? "Both halves of key_id:key_secret are needed, without spaces — copy the key again" : "fal.ai keys look like key_id:key_secret — paste the whole key, with the part after the colon";
    case "higgsfieldKey":
      if (KEY_PAIR.test(v)) return null;
      return "Higgsfield keys look like KEY_ID:KEY_SECRET (both parts from console.higgsfield.ai)";
    case "replicateToken":
      return /^r8_\S+$/.test(v) ? null : "Replicate tokens start with r8_";
    case "anthropicKey":
      return /^sk-ant-\S+$/.test(v) ? null : "Anthropic keys start with sk-ant-";
    case "comfyUrl":
      return addressProblem(v, DEFAULT_COMFY_URL);
    case "comfyIsolatedUrl":
      return addressProblem(v, "http://127.0.0.1:8189");
    case "ollamaUrl":
      return addressProblem(v, "http://127.0.0.1:11434");
  }
  return null;
}

// ---------------------------------------------------------------------------
// What's connected

export type EngineModeName = "both" | "open" | "cloud";

export interface ConnectionState {
  providers: Record<string, { configured: boolean } | undefined>;
  engineMode: EngineModeName;
  /** The first-run guide was put away, or something this engine mode uses was connected once (Settings → `onboarded`). */
  onboarded?: boolean;
  /** Settings → Demo mode: auto (a demo when no provider hosts the model), on (always a demo), off (never). */
  demoMode?: string;
}

const CLOUD_PROVIDERS = ["fal", "replicate", "higgsfield"] as const;

/** Whether a paid API and ComfyUI are connected. */
export function connectedEngines(s: ConnectionState): { cloud: boolean; open: boolean } {
  return { cloud: CLOUD_PROVIDERS.some((p) => s.providers[p]?.configured), open: !!s.providers.comfyui?.configured };
}

/** Nothing this install's engine mode uses is connected, so every run is a demo. */
export function nothingConnected(s: ConnectionState): boolean {
  const c = connectedEngines(s);
  return s.engineMode === "open" ? !c.open : s.engineMode === "cloud" ? !c.cloud : !c.cloud && !c.open;
}

/** The first-run guide shows until something is connected or it was put away. Unknown status: not yet. */
export function showFirstRun(s: ConnectionState | undefined): boolean {
  return !!s && !s.onboarded && nothingConnected(s);
}

/** What Home's Start runs in a mode: the studio's default model on each engine, the providers that host it, and one run's price on the paid one. */
export interface StartQuote {
  cloud: { name: string; price: string; providers: string[] } | null;
  open: { name: string; providers: string[] } | null;
}

const PROVIDER_LABEL: Record<string, string> = { fal: "fal.ai", replicate: "Replicate", higgsfield: "Higgsfield", comfyui: "ComfyUI" };

/**
 * The line under Home's composer, before Start is pressed: the model it runs and its price, or why
 * it runs a free demo (no key for a provider that hosts that model, the same rule the composer's
 * "Demo" label follows), plus the other engine when that one would run it for real. Null when
 * nothing is connected: Home's demo notice says so instead.
 */
export function startLine(s: ConnectionState, quote: StartQuote | undefined, engine: "cloud" | "open", mode: "image" | "video" | "edit"): { text: string; other?: "cloud" | "open" } | null {
  if (!quote || nothingConnected(s)) return null;
  if (s.demoMode === "on") return { text: "Demo mode is on (Settings), so Start runs a free demo" };
  const hosted = (q: { providers: string[] } | null) => !!q && q.providers.some((p) => s.providers[p]?.configured);
  const otherEngine = engine === "open" ? "cloud" : "open";
  const other = s.engineMode === "both" && hosted(quote[otherEngine]) ? otherEngine : undefined;
  const then = mode === "edit" ? " after you add the photo" : "";
  if (engine === "open" && quote.open && hosted(quote.open)) return { text: `Start runs ${quote.open.name} on your GPU${then} · Free` };
  if (engine === "cloud" && quote.cloud && hosted(quote.cloud)) return { text: `Start runs ${quote.cloud.name}${then} · ${quote.cloud.price}` };
  const q = quote[engine];
  const connected = connectedEngines(s)[engine];
  const hosts = q ? q.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" or ") : "";
  let why: string;
  if (!connected) why = engine === "open" ? "ComfyUI isn't connected" : "No paid API is connected";
  else why = q ? `${q.name} needs ${engine === "open" ? hosts : `a ${hosts} key`}` : "No model is set for this";
  return { text: `${why}, so Start ${s.demoMode === "off" ? "can't run it yet" : "runs a free demo"}`, ...(other && { other }) };
}

/**
 * This browser's last answer to showFirstRun ("1" or "0"). Home paints the guide in its static
 * shell, before the status is known, so it doesn't push the page down when it arrives; the
 * pre-paint script hides it there when this browser already knows it isn't wanted.
 */
export const FIRST_RUN_KEY = "fuobe:first-run";

/** Runs while Home's HTML is parsed: `<html data-first-run="0">` when the guide was put away here before. */
export const FIRST_RUN_SCRIPT = `(function(){try{if(localStorage.getItem("${FIRST_RUN_KEY}")==="0")document.documentElement.setAttribute("data-first-run","0")}catch(e){}})()`;

export const ENGINE_MODE_LABEL: Record<EngineModeName, string> = { both: "Open source + paid", open: "Open source only", cloud: "Paid APIs only" };

export interface ConnectionItem {
  id: "fal" | "replicate" | "higgsfield" | "comfyui" | "llm";
  label: string;
  ok: boolean;
  /** "Key set", "Online", "Off"… */
  text: string;
  /** The Settings section to jump to. */
  href: string;
  /** The engine mode doesn't use it. */
  unused: boolean;
}

/** One line per connection for Settings' status strip, in the order the page lists them. */
export function connectionSummary(s: ConnectionState): ConnectionItem[] {
  const key = (id: "fal" | "replicate" | "higgsfield", label: string): ConnectionItem => {
    const ok = !!s.providers[id]?.configured;
    return { id, label, ok, text: ok ? "Key set" : "Not set", href: `#${id}`, unused: s.engineMode === "open" };
  };
  const comfy = !!s.providers.comfyui?.configured;
  const llm = !!s.providers.llm?.configured;
  return [
    key("fal", "fal.ai"),
    key("replicate", "Replicate"),
    key("higgsfield", "Higgsfield"),
    { id: "comfyui", label: "ComfyUI", ok: comfy, text: comfy ? "Online" : "Offline", href: "#comfyui", unused: s.engineMode === "cloud" },
    { id: "llm", label: "Claude / Ollama", ok: llm, text: llm ? "On" : "Off", href: "#text-ai", unused: false },
  ];
}
