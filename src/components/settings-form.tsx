"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

function Section({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-b py-8 first:pt-0 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
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
  const shown = editing ? v : setting?.secret ? "" : (setting?.value ?? "");
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px]">{label}</Label>
      <div className="flex gap-2">
        <Input
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
          className="h-9"
          disabled={!editing}
          onClick={() => {
            onSave(v);
            setEditing(false);
            setV("");
          }}
        >
          Save
        </Button>
        {setting?.isSet && !setting.fromEnv && (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => onSave("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">
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
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const get = (n: string) => settings.data?.find((s) => s.name === n);
  const set = (n: string) => (v: string) => save.mutate({ [n]: v });

  if (settings.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <div>
      <Section
        title="Cloud models"
        description={
          <>
            One fal.ai key unlocks Nano Banana Pro, Seedream, Kling, Veo 3.1, Sora 2, Seedance, Hailuo, Wan and more. Replicate is used as a fallback where it hosts the same model.
          </>
        }
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
        <Field setting={get("replicateToken")} label="Replicate API token" placeholder="r8_…" onSave={set("replicateToken")} />
        <TestButton provider="replicate" />
      </Section>

      <Section
        title="Open source · ComfyUI"
        description="Run every open-source workflow on your own GPU (or a rented one). Fuobe talks to ComfyUI's HTTP API and uploads inputs for you. See Workflows for the models each one needs."
      >
        <Field setting={get("comfyUrl")} label="ComfyUI server URL" placeholder="http://127.0.0.1:8188" onSave={set("comfyUrl")} />
        <Field setting={get("comfyToken")} label="Auth token (optional)" hint="Sent as a Bearer token, for ComfyUI behind a proxy." onSave={set("comfyToken")} />
        <TestButton provider="comfyui" />
      </Section>

      <Section
        title="Prompt enhancement"
        description="The Enhance toggle rewrites short ideas into rich prompts. Use Claude, a local Ollama model (fully open source), or the built-in offline rewriter."
      >
        <div className="space-y-1.5">
          <Label className="text-[13px]">Enhancer</Label>
          <Select value={get("enhanceProvider")?.value || "auto"} onValueChange={set("enhanceProvider")}>
            <SelectTrigger className="w-64">
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

      <Section title="Demo mode" description="Lets you click through everything without keys or a GPU. Demo runs return clearly-labelled placeholder media and cost nothing.">
        <Select value={get("demoMode")?.value || "auto"} onValueChange={set("demoMode")}>
          <SelectTrigger className="w-72">
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
