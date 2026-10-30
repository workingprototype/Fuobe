"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Cloud, Cpu, ExternalLink, Layers, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NotificationSettings } from "@/components/notification-settings";
import { SecuritySettings } from "@/components/security-settings";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";

interface PublicSetting {
  name: string;
  value: string;
  secret: boolean;
  fromEnv: boolean;
  isSet: boolean;
}

function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => ((await (await fetch("/api/settings")).json()) as { settings: PublicSetting[] }).settings,
  });
}

function Section({
  id,
  title,
  description,
  inactive,
  children,
}: {
  id?: string;
  title: string;
  description: React.ReactNode;
  /** Shown when the current engine mode doesn't use this section. */
  inactive?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="grid scroll-mt-6 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 first:pt-0 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        {inactive && <p className="mt-2 inline-flex rounded-md bg-muted px-2 py-1 text-[12px] text-muted-foreground">{inactive}</p>}
      </div>
      <div className={cn("min-w-0 space-y-5", inactive && "opacity-55")}>{children}</div>
    </section>
  );
}

const ENGINE_MODES = [
  {
    value: "both",
    title: "Open source + paid APIs",
    icon: Layers,
    body: "Every studio gets a Cloud / Open source switch. Use frontier paid models when you want them, your own GPU when you don't.",
    needs: "A fal.ai, Replicate or Higgsfield key and/or a ComfyUI server",
  },
  {
    value: "open",
    title: "Open source only",
    icon: Cpu,
    body: "Only open-weight models on your ComfyUI server. Paid models are hidden and blocked on the server, and nothing is sent to paid APIs.",
    needs: "A ComfyUI server",
  },
  {
    value: "cloud",
    title: "Paid APIs only",
    icon: Cloud,
    body: "Only hosted frontier models (Nano Banana, Seedance, Kling, Veo…). No GPU needed; open-source models are hidden.",
    needs: "A fal.ai, Replicate or Higgsfield key",
  },
] as const;

function EngineModePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Engine mode" className="grid gap-2 lg:grid-cols-3">
      {ENGINE_MODES.map((m) => {
        const active = value === m.value;
        return (
          <button
            key={m.value}
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(m.value)}
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent",
              active && "border-primary bg-brand-faint hover:bg-brand-faint",
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn("grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground", active && "bg-primary text-primary-foreground")}>
                <m.icon className="size-4" />
              </span>
              <span className="text-[14px] font-medium">{m.title}</span>
              {active && <CheckCircle2 className="ml-auto size-4 text-brand-text" />}
            </span>
            <span className="text-[13px] leading-relaxed text-muted-foreground">{m.body}</span>
            <span className="text-[12px] text-subtle-foreground">Needs: {m.needs}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A provider's connection check (`provider`), or another endpoint's (`url` and `body`) that answers {ok, detail}. */
function TestButton({ provider, url = "/api/providers/test", body }: { provider?: string; url?: string; body?: Record<string, unknown> }) {
  const [res, setRes] = useState<{ ok: boolean; detail: string } | null>(null);
  const m = useMutation({
    mutationFn: async () =>
      (await (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? { provider }),
        })
      ).json()) as { ok: boolean; detail: string },
    onSuccess: setRes,
  });
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending && <Loader2 className="animate-spin" />} Test connection
      </Button>
      {res && (
        <span className={cn("inline-flex items-center gap-1 text-[12px]", res.ok ? "text-success" : "text-destructive")}>
          {res.ok ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {res.detail}
        </span>
      )}
    </div>
  );
}

function Field({
  setting,
  label,
  hint,
  placeholder,
  options,
  onSave,
}: {
  setting?: PublicSetting;
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
  /** Suggestions to pick from (the models a server lists); any value can still be typed. */
  options?: string[];
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState("");
  const [editing, setEditing] = useState(false);
  const id = useId();
  const shown = editing ? v : setting?.secret ? "" : (setting?.value ?? "");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          spellCheck={false}
          type={setting?.secret ? "password" : "text"}
          value={shown}
          placeholder={setting?.secret && setting.isSet ? setting.value : placeholder}
          list={options?.length ? `${id}-list` : undefined}
          onChange={(e) => {
            setEditing(true);
            setV(e.target.value);
          }}
          className="font-mono text-[13px]"
        />
        {!!options?.length && (
          <datalist id={`${id}-list`}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
        <Button
          size="sm"
          className="h-9 shrink-0"
          disabled={!editing}
          aria-label={`Save ${label}`}
          onClick={() => {
            onSave(v);
            setEditing(false);
            setV("");
          }}
        >
          Save
        </Button>
        {setting?.isSet && !setting.fromEnv && (
          <Button size="sm" variant="ghost" className="h-9 shrink-0" aria-label={`Clear ${label}`} onClick={() => onSave("")}>
            Clear
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-[12px] text-muted-foreground">
        {setting?.fromEnv ? "Set from environment variable. " : ""}
        {hint}
      </p>
    </div>
  );
}

type LocalKind = "ollama" | "lmstudio" | "unsloth" | "custom";

/** A local LLM server as GET /api/llm reports it (no keys). */
interface LocalServerStatus {
  kind: LocalKind;
  label: string;
  url: string;
  up: boolean;
  auth: "none" | "ok" | "missing" | "rejected";
  models: { id: string; name?: string; loaded?: boolean; context?: number | null; maxContext?: number | null }[];
  model: string | null;
  loaded: boolean | null;
  context: number | null;
  problem: string | null;
  warning: string | null;
  native?: boolean;
}

interface LocalLlmInfo {
  provider: "auto" | LocalKind;
  /** Settings' context, in tokens (0: the server's own). */
  context: number;
  /** The server text steps and Assist use now. */
  active: LocalKind | null;
  servers: LocalServerStatus[];
}

const LOCAL_SERVERS: { value: "auto" | LocalKind; title: string }[] = [
  { value: "auto", title: "Automatic" },
  { value: "ollama", title: "Ollama" },
  { value: "lmstudio", title: "LM Studio" },
  { value: "unsloth", title: "Unsloth Studio" },
  { value: "custom", title: "Other" },
];

const code = (s: string) => <code className="font-mono text-[11px]">{s}</code>;

/** Each server's settings and how to get it running. */
const LOCAL_FIELDS: Record<LocalKind, { url: string; urlPlaceholder: string; model: string; modelHint: string; key?: string; keyLabel?: string; keyPlaceholder?: string; setup: React.ReactNode }> = {
  ollama: {
    url: "ollamaUrl",
    urlPlaceholder: "http://127.0.0.1:11434",
    model: "ollamaModel",
    modelHint: "A model with tool calling for Assist, such as qwen3:8b.",
    setup: <>Install Ollama, then run {code("ollama pull qwen3:8b")}. Fuobe gives it the context below.</>,
  },
  lmstudio: {
    url: "lmstudioUrl",
    urlPlaceholder: "http://127.0.0.1:1234",
    model: "lmstudioModel",
    modelHint: "Empty: the loaded model, else one trained for tool use. A model that isn't loaded is loaded with the context below.",
    key: "lmstudioToken",
    keyLabel: "API token (only with Require Authentication on)",
    setup: (
      <>
        In LM Studio, open Developer and start the server (or run {code("lms server start")}), and download a model in Discover (or {code("lms get qwen/qwen3-8b")}). Models without thinking (instruct models) answer faster. Without
        Require Authentication, anyone on your network can use LM Studio&apos;s server.
      </>
    ),
  },
  unsloth: {
    url: "unslothUrl",
    urlPlaceholder: "http://127.0.0.1:8888",
    model: "unslothModel",
    modelHint: "Empty: the model loaded in Unsloth Studio.",
    key: "unslothKey",
    keyLabel: "API key",
    keyPlaceholder: "sk-unsloth-…",
    setup: (
      <>
        Start Unsloth Studio and load a model on its Chat page (Select model), then make a key: avatar → Settings → API → Create. Fuobe always turns Unsloth&apos;s server-side tools (Python, terminal, web search) off.
      </>
    ),
  },
  custom: {
    url: "llmUrl",
    urlPlaceholder: "http://127.0.0.1:8080/v1",
    model: "llmModel",
    modelHint: "Empty: the first model the server lists.",
    key: "llmKey",
    keyLabel: "API key (optional)",
    setup: <>Any OpenAI-compatible server: llama.cpp&apos;s llama-server, vLLM, Jan… Give its base URL as its docs do (it usually ends in {code("/v1")}).</>,
  },
};

const k = (n: number) => `${Math.round(n / 1024)}k`;

/** One line per server: the model it would use, or what's wrong. */
function serverLine(s: LocalServerStatus): string {
  if (!s.url) return "Not set up";
  if (s.problem) return s.up ? s.problem : `Not running at ${s.url}`;
  return [s.model, s.loaded ? "loaded" : s.loaded === false ? "loads on first use" : null, s.context ? `${k(s.context)} context` : null].filter(Boolean).join(" · ");
}

/** Settings → AI helper → the local model server: pick one (or Automatic), see what each one answers, set its URL, model and key, and test it. */
function LocalLlmSettings({ get, set }: { get: (n: string) => PublicSetting | undefined; set: (n: string) => (v: string) => void }) {
  const qc = useQueryClient();
  const llm = useQuery({
    queryKey: ["llm"],
    queryFn: async () => (await (await fetch("/api/llm")).json()) as LocalLlmInfo,
    refetchInterval: 30_000,
  });
  const refresh = useMutation({
    mutationFn: async () => (await (await fetch("/api/llm?refresh=1")).json()) as LocalLlmInfo,
    onSuccess: (data) => qc.setQueryData(["llm"], data),
  });
  const reload = useMutation({
    mutationFn: async (model: string | null) =>
      (await (await fetch("/api/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", model }) })).json()) as { ok: boolean; detail: string },
    onSuccess: (r) => {
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
      refresh.mutate();
    },
  });
  const provider = (get("llmProvider")?.value || "auto") as "auto" | LocalKind;
  const [picked, setPicked] = useState<LocalKind | null>(null);
  // Pinned: that server's settings. Automatic: the one clicked below, else the one in use.
  const editing: LocalKind = provider !== "auto" ? provider : (picked ?? llm.data?.active ?? "ollama");
  const status = llm.data?.servers.find((s) => s.kind === editing);
  const f = LOCAL_FIELDS[editing];
  const need = llm.data?.context ?? 0;
  // Compared with the model's most when that's less: a reload can't give more than it.
  const maxContext = status?.models.find((m) => m.id === status.model)?.maxContext;
  const want = Math.min(need, maxContext || need);
  const smallContext = editing === "lmstudio" && status?.native && status.loaded && !!status.context && !!want && status.context < want;
  const shown = llm.data?.servers.filter((s) => provider === "auto" || s.kind === provider) ?? [];

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="space-y-1.5">
        <p id="local-llm-label" className="text-[13px] font-medium">
          Local model server
        </p>
        <div role="radiogroup" aria-labelledby="local-llm-label" onKeyDown={radioKeys} className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {LOCAL_SERVERS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={provider === o.value}
              tabIndex={radioTab(provider === o.value)}
              onClick={() => provider !== o.value && set("llmProvider")(o.value)}
              className={cn("h-8 rounded-lg px-3 text-[13px] font-medium transition-colors", provider === o.value ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {o.title}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {provider === "auto" ? "Uses the first server that answers with a model, in this order: Ollama, LM Studio, Unsloth Studio, then the Other server." : "Only this server is used; the others are ignored."}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium">Found on this machine</p>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
          </Button>
        </div>
        {llm.isLoading && <Skeleton className="h-16 w-full rounded-lg" />}
        <ul className="space-y-0.5">
          {shown.map((s) => (
            <li key={s.kind}>
              <button
                type="button"
                onClick={() => setPicked(s.kind)}
                aria-pressed={editing === s.kind}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent", editing === s.kind && "bg-accent")}
              >
                <span className={cn("size-2 shrink-0 rounded-full", !s.problem ? "bg-success" : s.up ? "bg-warning" : "bg-subtle-foreground")} />
                <span className="shrink-0 font-medium">{s.kind === "custom" ? "Other" : s.label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{serverLine(s)}</span>
                {llm.data?.active === s.kind && <span className="shrink-0 rounded-md bg-brand-faint px-1.5 py-0.5 text-[11px] text-brand-text">In use</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4 border-t pt-4">
        <p className="text-[13px] font-medium">{editing === "custom" ? "Other server (OpenAI-compatible)" : (status?.label ?? LOCAL_SERVERS.find((o) => o.value === editing)?.title)}</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{f.setup}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field key={`${editing}-url`} setting={get(f.url)} label="URL" placeholder={f.urlPlaceholder} onSave={set(f.url)} />
          <Field key={`${editing}-model`} setting={get(f.model)} label="Model" hint={f.modelHint} options={status?.models.map((m) => m.id)} onSave={set(f.model)} />
        </div>
        {f.key && <Field key={`${editing}-key`} setting={get(f.key)} label={f.keyLabel ?? "API key"} placeholder={f.keyPlaceholder} onSave={set(f.key)} />}
        {status?.problem && status.up && <p className="text-[12px] text-warning">{status.problem}</p>}
        {status?.problem && !status.up && <p className="text-[12px] text-muted-foreground">{status.problem}</p>}
        {status?.warning && !status.problem && <p className="text-[12px] text-warning">{status.warning}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <TestButton url="/api/llm" body={{ action: "test", kind: editing }} />
          {smallContext && (
            <Button variant="outline" size="sm" onClick={() => reload.mutate(status?.model ?? null)} disabled={reload.isPending}>
              {reload.isPending && <Loader2 className="animate-spin" />} Reload with {k(want)} context
            </Button>
          )}
        </div>
      </div>

      <Field
        setting={get("llmContext")}
        label="Context (tokens)"
        placeholder="16384"
        hint="How much text the local model reads at once: Ollama gets it as num_ctx, and LM Studio loads models with it. Assist needs about 16,384. 0 leaves it to the server."
        onSave={set("llmContext")}
      />
      <p className="text-[12px] text-muted-foreground">The local model shares the GPU with ComfyUI. A 4–8B model leaves room for generations.</p>
    </div>
  );
}

export function SettingsForm() {
  const qc = useQueryClient();
  const settings = useSettings();
  const save = useMutation({
    mutationFn: async (patch: Record<string, string>) =>
      (await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })).json(),
    onSuccess: (body: { error?: string }) => {
      if (body?.error) return toast.error(body.error);
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
      void qc.invalidateQueries({ queryKey: ["llm"] });
    },
  });
  const get = (n: string) => settings.data?.find((s) => s.name === n);
  const set = (n: string) => (v: string) => save.mutate({ [n]: v });
  // Deep links (/settings#comfyui) arrive while the form is still a skeleton, so the browser finds
  // no anchor: scroll to it once the sections exist.
  const loaded = !settings.isLoading;
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (settings.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading settings">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  const mode = get("engineMode")?.value || "both";

  return (
    <div>
      <Section
        id="engine"
        title="Engine mode"
        description="Choose what this install runs: fully open source, only paid APIs, or both side by side. The mode is enforced on the server, so a locked engine can't be used from the API either."
      >
        <EngineModePicker value={mode} onChange={set("engineMode")} />
        <p className="text-[12px] text-muted-foreground">Also settable with the <code className="font-mono">FUOBE_ENGINE_MODE</code> environment variable (both · open · cloud).</p>
      </Section>

      <Section
        id="cloud"
        title="Paid API configuration"
        description={
          <>
            One fal.ai key unlocks Nano Banana, Seedream, GPT Image, FLUX, Kling, Seedance, Veo 3.1, Wan, MiniMax, avatars and more. Replicate hosts a subset and is used as a fallback (or first, if you prefer it).
          </>
        }
        inactive={mode === "open" ? "Not used in Open source only mode" : undefined}
      >
        <Field
          setting={get("falKey")}
          label="fal.ai API key"
          placeholder="fal_…"
          onSave={set("falKey")}
          hint={
            <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
              Get a key <ExternalLink className="size-3" />
            </a>
          }
        />
        <TestButton provider="fal" />
        <Field
          setting={get("replicateToken")}
          label="Replicate API token"
          placeholder="r8_…"
          onSave={set("replicateToken")}
          hint={
            <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
              Get a token <ExternalLink className="size-3" />
            </a>
          }
        />
        <TestButton provider="replicate" />
        <Field
          setting={get("higgsfieldKey")}
          label="Higgsfield API key"
          placeholder="KEY_ID:KEY_SECRET"
          onSave={set("higgsfieldKey")}
          hint={
            <span>
              Unlocks Higgsfield&apos;s own models — Soul 2.0, Soul Cinema, Soul ID, Genjutsu, Cinema Studio, Marketing &amp; Ads Studio — and is another route for Seedance, Kling, Wan and MiniMax.{" "}
              <a href="https://console.higgsfield.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
                Get a key <ExternalLink className="size-3" />
              </a>
            </span>
          }
        />
        <TestButton provider="higgsfield" />
        <div className="space-y-1.5">
          <Label htmlFor="setting-cloud-provider" className="text-[13px]">
            Preferred provider
          </Label>
          <Select value={get("cloudProvider")?.value || "auto"} onValueChange={set("cloudProvider")}>
            <SelectTrigger id="setting-cloud-provider" className="w-full max-w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (fal.ai, then Replicate, then Higgsfield)</SelectItem>
              <SelectItem value="fal">Prefer fal.ai</SelectItem>
              <SelectItem value="replicate">Prefer Replicate</SelectItem>
              <SelectItem value="higgsfield">Prefer Higgsfield</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[12px] text-muted-foreground">Used when a model is available on both. Models only one provider hosts always use that one.</p>
        </div>
      </Section>

      <Section
        id="comfyui"
        title="Open-source engine · ComfyUI"
        description="Run every open-source workflow on your own GPU (or a rented one). Fuobe talks to ComfyUI's HTTP API and uploads inputs for you. See ComfyUI workflows for the models each one needs."
        inactive={mode === "cloud" ? "Not used in Paid APIs only mode" : undefined}
      >
        <Field setting={get("comfyUrl")} label="ComfyUI server URL" placeholder="http://127.0.0.1:8188" onSave={set("comfyUrl")} />
        <Field setting={get("comfyToken")} label="Auth token (optional)" hint="Sent as a Bearer token, for ComfyUI behind a proxy." onSave={set("comfyToken")} />
        <Field
          setting={get("comfyIsolatedUrl")}
          label="Isolated worker URL (optional)"
          placeholder="http://127.0.0.1:8189"
          hint="A second ComfyUI for LatentSync 1.6 and ThinkSound, whose node packs can't share the main install. scripts/comfy/README.md shows how to start one."
          onSave={set("comfyIsolatedUrl")}
        />
        <TestButton provider="comfyui" />
      </Section>

      <Section
        id="ai"
        title="AI helper"
        description="The LLM that writes for Fuobe: the Enhance toggle, storyboards, translations and scripts, ad copy, brand research, and the Assist agent. Use Claude, a local model (Ollama, LM Studio, Unsloth Studio or another OpenAI-compatible server: fully open source), or the built-in offline rewriter. In Open source only mode, Automatic skips Claude."
      >
        <div className="space-y-1.5">
          <Label htmlFor="setting-enhancer" className="text-[13px]">
            Use
          </Label>
          {/* "ollama" is the old name of "local". */}
          <Select value={(get("enhanceProvider")?.value || "auto").replace(/^ollama$/, "local")} onValueChange={set("enhanceProvider")}>
            <SelectTrigger id="setting-enhancer" className="w-full max-w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (Claude → local model → offline)</SelectItem>
              <SelectItem value="anthropic">Claude (Anthropic API)</SelectItem>
              <SelectItem value="local">Local model only (open source)</SelectItem>
              <SelectItem value="none">Offline rewriter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Field setting={get("anthropicKey")} label="Anthropic API key" placeholder="sk-ant-…" onSave={set("anthropicKey")} />
        <LocalLlmSettings get={get} set={set} />
      </Section>

      <Section
        id="notifications"
        title="Notifications"
        description="Get a heads-up from your browser when something you started finishes while you're in another tab or app. Saved in this browser; nothing is sent anywhere."
      >
        <NotificationSettings />
      </Section>

      <Section
        id="security"
        title="Security"
        description="Protect this studio with a password, and create API tokens for scripts and agents. Off by default for local use."
      >
        <SecuritySettings />
      </Section>

      <Section title="Demo mode" description="Lets you click through everything without keys or a GPU. Demo runs return clearly-labelled placeholder media and cost nothing.">
        <Select value={get("demoMode")?.value || "auto"} onValueChange={set("demoMode")}>
          <SelectTrigger aria-label="Demo mode" className="w-full max-w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Automatic — demo only when a model isn’t connected</SelectItem>
            <SelectItem value="on">Always demo</SelectItem>
            <SelectItem value="off">Never — show an error instead</SelectItem>
          </SelectContent>
        </Select>
      </Section>
    </div>
  );
}
