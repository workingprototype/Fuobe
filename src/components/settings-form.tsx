"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Cloud, Cpu, ExternalLink, Layers, Loader2 } from "lucide-react";
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

function TestButton({ provider }: { provider: string }) {
  const [res, setRes] = useState<{ ok: boolean; detail: string } | null>(null);
  const m = useMutation({
    mutationFn: async () =>
      (await (
        await fetch("/api/providers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
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
  onSave,
}: {
  setting?: PublicSetting;
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
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
          onChange={(e) => {
            setEditing(true);
            setV(e.target.value);
          }}
          className="font-mono text-[13px]"
        />
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
        title="Prompt enhancement"
        description="The Enhance toggle rewrites short ideas into rich prompts, and storyboards split stories into frames. Use Claude, a local Ollama model (fully open source), or the built-in offline rewriter. Claude also powers the Assist agent. In Open source only mode, Automatic skips Claude."
      >
        <div className="space-y-1.5">
          <Label htmlFor="setting-enhancer" className="text-[13px]">
            Enhancer
          </Label>
          <Select value={get("enhanceProvider")?.value || "auto"} onValueChange={set("enhanceProvider")}>
            <SelectTrigger id="setting-enhancer" className="w-full max-w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (Claude → Ollama → offline)</SelectItem>
              <SelectItem value="anthropic">Claude (Anthropic API)</SelectItem>
              <SelectItem value="ollama">Ollama (local, open source)</SelectItem>
              <SelectItem value="none">Offline rewriter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Field setting={get("anthropicKey")} label="Anthropic API key" placeholder="sk-ant-…" onSave={set("anthropicKey")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field setting={get("ollamaUrl")} label="Ollama URL" onSave={set("ollamaUrl")} />
          <Field setting={get("ollamaModel")} label="Ollama model" onSave={set("ollamaModel")} />
        </div>
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
