"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Cpu, ExternalLink, Info, Layers, Link2, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectField, useSettings } from "@/components/connect-field";
import { GetStarted } from "@/components/get-started";
import { LoraSettings } from "@/components/lora-settings";
import { useStatus, type StatusInfo } from "@/lib/api";
import { connectionSummary, ENGINE_MODE_LABEL, FAL_KEYS_URL, showFirstRun } from "@/lib/connections";
import { cn } from "@/lib/utils";
import { ConnectorSettings } from "@/components/assist/connectors-settings";
import { NotificationSettings } from "@/components/notification-settings";
import { SecuritySettings } from "@/components/security-settings";

function Section({
  id,
  title,
  description,
  inactive,
  children,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  /** Shown when the current engine mode doesn't use this section. */
  inactive?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 last:border-b-0 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="group flex items-center gap-1.5 text-[15px] font-semibold">
          {title}
          <a href={`#${id}`} aria-label={`Link to ${title}`} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
            <Link2 className="size-3.5" />
          </a>
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
    needs: "A fal.ai or Replicate key and/or a ComfyUI server",
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
    needs: "A fal.ai or Replicate key",
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
            <span className="text-[12px] text-muted-foreground">Needs: {m.needs}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A select whose trigger stays short ("Automatic") at any width; what the picked option does is
 * the line under it, so nothing is cut off.
 */
function ChoiceField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; hint: string }[];
  onChange: (v: string) => void;
}) {
  const picked = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      <Select value={picked.value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-describedby={`${id}-hint`} className="w-full sm:w-auto sm:min-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-[12px] text-muted-foreground">
        {picked.hint}
      </p>
    </div>
  );
}

/**
 * What's connected, at a glance and always in view: one chip per connection (green when it works,
 * each a link to its field) and the engine mode. Also opens the setup guide again.
 */
function StatusStrip({ status, onGuide, guideOpen }: { status?: StatusInfo; onGuide: () => void; guideOpen: boolean }) {
  return (
    <div className="sticky top-12 z-10 -mx-4 border-b bg-background/90 px-4 py-2.5 backdrop-blur sm:-mx-8 sm:px-8 md:top-0">
      <nav aria-label="Connections" className="scrollbar-none -my-1 flex items-center gap-1.5 overflow-x-auto py-1">
        {status ? (
          <>
            {connectionSummary(status).map((c) => (
              <a
                key={c.id}
                href={c.href}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 text-[12px] whitespace-nowrap transition-colors hover:bg-accent",
                  c.unused && "opacity-60",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", c.ok ? "bg-success" : "bg-muted-foreground/50")} />
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">{c.unused ? "Not used" : c.text}</span>
              </a>
            ))}
            <a href="#engine" className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] whitespace-nowrap transition-colors hover:bg-accent">
              <span className="text-muted-foreground">Engine</span>
              <span className="font-medium">{ENGINE_MODE_LABEL[status.engineMode]}</span>
            </a>
            {!guideOpen && (
              <button type="button" onClick={onGuide} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap text-brand-text hover:bg-brand-faint">
                Setup guide
              </button>
            )}
          </>
        ) : (
          <Skeleton className="h-7 w-full max-w-xl rounded-full" />
        )}
      </nav>
    </div>
  );
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function SettingsForm({ prices }: { prices?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const settings = useSettings();
  const status = useStatus().data;
  // The setup guide on request: the strip's "Setup guide", or a link to /settings#get-started (Home's demo line).
  const [guide, setGuide] = useState<boolean | null>(null);
  const askedByLink = useSyncExternalStore(subscribeHash, () => window.location.hash === "#get-started", () => false);
  const save = useMutation({
    mutationFn: async (patch: Record<string, string>) =>
      (await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })).json(),
    onSuccess: (body: { error?: string }) => {
      if (body?.error) return toast.error(body.error);
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
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
  // The guide opens by itself on a first run, and on request ("Setup guide") after that.
  const firstRun = showFirstRun(status);
  const guideOpen = !!status && (firstRun || (guide ?? askedByLink));

  return (
    <div>
      <StatusStrip status={status} guideOpen={guideOpen} onGuide={() => setGuide(true)} />
      {guideOpen && status && (
        <div id="get-started" className="scroll-mt-28 pt-6 md:scroll-mt-20">
          <GetStarted
            status={status}
            prices={prices}
            intents={false}
            onDemo={() => router.push("/")}
            onHide={() => {
              setGuide(false);
              if (window.location.hash === "#get-started") history.replaceState(null, "", window.location.pathname);
            }}
          />
        </div>
      )}

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
        description="One fal.ai key runs the Fuobe Originals in the cloud (Soul, DoP, Genjutsu, Cinema: open weights with their LoRAs) and the partner models: Nano Banana, Seedream, GPT Image, FLUX, Kling, Seedance, Veo 3.1, Wan, MiniMax, avatars and more. Replicate hosts a subset and is used as a fallback (or first, if you prefer it). Save & test checks a key before saving it."
        inactive={mode === "open" ? "Not used in Open source only mode" : undefined}
      >
        <ConnectField
          id="fal"
          name="falKey"
          setting={get("falKey")}
          provider="fal"
          label="fal.ai API key"
          placeholder="key_id:key_secret"
          hint={
            <a href={FAL_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
              Get a key <ExternalLink className="size-3" />
            </a>
          }
        />
        <ConnectField
          id="replicate"
          name="replicateToken"
          setting={get("replicateToken")}
          provider="replicate"
          label="Replicate API token"
          placeholder="r8_…"
          hint={
            <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
              Get a token <ExternalLink className="size-3" />
            </a>
          }
        />
        <ChoiceField
          id="setting-cloud-provider"
          label="Preferred provider"
          value={get("cloudProvider")?.value || "auto"}
          onChange={set("cloudProvider")}
          options={[
            { value: "auto", label: "Automatic", hint: "Tries fal.ai, then Replicate when a model is on both. Models only one provider hosts always use that one." },
            { value: "fal", label: "fal.ai first", hint: "fal.ai whenever it hosts the model. Models only one provider hosts always use that one." },
            { value: "replicate", label: "Replicate first", hint: "Replicate whenever it hosts the model. Models only one provider hosts always use that one." },
          ]}
        />
      </Section>

      <Section
        id="comfyui"
        title="Open-source engine · ComfyUI"
        description={
          <>
            Run every open-source workflow on your own GPU (or a rented one). Fuobe talks to ComfyUI&apos;s HTTP API and uploads inputs for you. See{" "}
            <Link href="/workflows" className="text-brand-text underline-offset-2 hover:underline">
              ComfyUI workflows
            </Link>{" "}
            for the models each one needs.
          </>
        }
        inactive={mode === "cloud" ? "Not used in Paid APIs only mode" : undefined}
      >
        <ConnectField name="comfyUrl" setting={get("comfyUrl")} provider="comfyui" label="ComfyUI server URL" placeholder="http://127.0.0.1:8188" hint="Where ComfyUI listens; a local install is http://127.0.0.1:8188." />
        <ConnectField name="comfyToken" setting={get("comfyToken")} provider="comfyui" label="Auth token (optional)" hint="Sent as a Bearer token, for ComfyUI behind a proxy." />
        <ConnectField
          name="comfyIsolatedUrl"
          setting={get("comfyIsolatedUrl")}
          provider="comfyui"
          label="Isolated worker URL (optional)"
          placeholder="http://127.0.0.1:8189"
          hint="A second ComfyUI for LatentSync 1.6 and ThinkSound, whose node packs can't share the main install. scripts/comfy/README.md shows how to start one."
        />
      </Section>

      <Section
        id="loras"
        title="LoRAs · looks, motions, effects and adapters"
        description="Looks, camera moves and effects add LoRA files to open models, on your GPU and in the cloud; an adapter is the LoRA an Original always loads (Fuobe Try-On's). Fuobe fetches the pinned version a run needs and shows each file's licence; what may run where is your call in Models & licences."
      >
        <LoraSettings folder={get("comfyLorasDir")} civitaiKey={get("civitaiKey")} />
      </Section>

      <Section
        id="text-ai"
        title="Prompt enhancement · Claude or Ollama"
        description="The Enhance toggle rewrites short ideas into rich prompts, and storyboards split stories into frames. Use Claude, a local Ollama model (fully open source), or the built-in offline rewriter. Claude also powers the Assist agent. In Open source only mode, Automatic skips Claude."
      >
        <ChoiceField
          id="setting-enhancer"
          label="Enhancer"
          value={get("enhanceProvider")?.value || "auto"}
          onChange={set("enhanceProvider")}
          options={[
            { value: "auto", label: "Automatic", hint: "Claude when a key is set, then Ollama, then the offline rewriter." },
            { value: "anthropic", label: "Claude", hint: "Claude through your Anthropic key (paid per use)." },
            { value: "ollama", label: "Ollama", hint: "A local, open-source model through Ollama. Claude is never called." },
            { value: "none", label: "Offline rewriter", hint: "Built-in rules, no LLM. Text steps (translate, write) are off." },
          ]}
        />
        <ConnectField name="anthropicKey" setting={get("anthropicKey")} provider="llm" label="Anthropic API key" placeholder="sk-ant-…" hint="Test checks the key with a free model list call." />
        <div className="grid gap-4 sm:grid-cols-2">
          <ConnectField name="ollamaUrl" setting={get("ollamaUrl")} provider="llm" label="Ollama URL" placeholder="http://127.0.0.1:11434" hint="Test checks Ollama answers and has the model." />
          <ConnectField name="ollamaModel" setting={get("ollamaModel")} provider="llm" label="Ollama model" placeholder="qwen3:8b" hint="Pull it first: ollama pull qwen3:8b" />
        </div>
      </Section>

      <Section
        id="assist-connectors"
        title="Assist · connectors"
        description="Give Claude in Assist the tools of your other apps — docs, tasks, CRM, analytics — through their MCP servers (a URL and, usually, a token). Only Claude chats use them."
      >
        <ConnectorSettings claudeReady={!!get("anthropicKey")?.isSet} />
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

      <Section id="demo" title="Demo mode" description="Lets you click through everything without keys or a GPU. Demo runs return clearly-labelled placeholder media and cost nothing.">
        <ChoiceField
          id="setting-demo"
          label="Demo mode"
          value={get("demoMode")?.value || "auto"}
          onChange={set("demoMode")}
          options={[
            { value: "auto", label: "Automatic", hint: "A demo only when the model you picked isn't connected." },
            { value: "on", label: "Always demo", hint: "Every run is a free placeholder, even with keys or ComfyUI connected." },
            { value: "off", label: "Never", hint: "A model that isn't connected shows an error instead of a demo." },
          ]}
        />
      </Section>

      <Section
        id="models"
        title="Models & licences"
        description="Every model, LoRA and node pack with its licence, as information. Everything is on: switch off a model, a whole kind of licence (say, all non-commercial ones), a provider or a node pack, and it leaves the pickers and is refused on the server."
      >
        <Link href="/settings/models" className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors hover:bg-accent">
          <Scale className="size-4 text-muted-foreground" /> Open Models &amp; licences
        </Link>
      </Section>

      <Section id="about" title="About & licences" description="Fuobe's version, and the licence of every open model it can run — some are non-commercial or exclude some countries.">
        <Link href="/settings/about" className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors hover:bg-accent">
          <Info className="size-4 text-muted-foreground" /> Open About & licences
        </Link>
      </Section>
    </div>
  );
}
