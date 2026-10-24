"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSettings, testConnection, type ConnectionTest } from "@/lib/api";
import { settingProblem, type TestProvider } from "@/lib/connections";
import { cn } from "@/lib/utils";

export interface PublicSetting {
  name: string;
  value: string;
  secret: boolean;
  fromEnv: boolean;
  isSet: boolean;
}

/** Every setting as the browser may see it (secrets masked). `enabled: false` waits (Home's guide, until the status says it's wanted). */
export function useSettings(enabled = true) {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => ((await (await fetch("/api/settings")).json()) as { settings: PublicSetting[] }).settings,
    enabled,
  });
}

interface Result extends ConnectionTest {
  /** The typed values that didn't connect and weren't saved ("Save anyway" saves them). */
  unsaved?: Record<string, string>;
  saved?: boolean;
}

/**
 * A key or address field with one button that does what it says: "Save & test" tests the typed value
 * first and saves it once it connects (a value that doesn't connect is offered "Save anyway"); with
 * nothing typed it tests the saved one. Used by Settings and by Home's first-run guide.
 */
export function ConnectField({
  name,
  setting,
  provider,
  label,
  hint,
  placeholder,
  id,
  idleLabel = "Test",
  onConnected,
  className,
}: {
  name: string;
  setting?: PublicSetting;
  provider: TestProvider;
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
  /** Anchor for links to this field (/settings#fal). */
  id?: string;
  /** The button's words when nothing new was typed. */
  idleLabel?: string;
  /** After a green test (the first-run guide closes itself). */
  onConnected?: (r: ConnectionTest) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const secret = !!setting?.secret;
  const saved = secret ? "" : (setting?.value ?? "");
  const typed = draft !== null && draft.trim() !== saved.trim() ? draft.trim() : null;
  const shown = draft ?? saved;
  const problem = typed ? settingProblem(name, typed) : null;
  const canTest = typed !== null || !!setting?.isSet || !!setting?.value;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["settings"] });
    void qc.invalidateQueries({ queryKey: ["status"] });
  };

  const run = async () => {
    if (busy || !canTest) return;
    setBusy(true);
    try {
      const values = typed !== null ? { [name]: typed } : undefined;
      const res = await testConnection(provider, values, name);
      if (res.ok) {
        // Connected: keep it. The first-run guide goes once the status sees a connection the engine
        // mode generates with (the server remembers that), not for Ollama or an unused provider.
        if (values) await saveSettings(values);
        setDraft(null);
        refresh();
        onConnected?.(res);
      }
      setResult({ ...res, saved: res.ok && !!values, unsaved: !res.ok ? values : undefined });
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveAnyway = async (values: Record<string, string>) => {
    try {
      await saveSettings(values);
      setDraft(null);
      setResult((r) => r && { ...r, unsaved: undefined, saved: true });
      refresh();
      toast.success("Saved — it didn't connect yet");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const clear = async () => {
    try {
      await saveSettings({ [name]: "" });
      setDraft(null);
      setResult(null);
      refresh();
      toast.success(`${label} cleared`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div id={id} className={cn("min-w-0 scroll-mt-28 space-y-1.5", className)}>
      <Label htmlFor={inputId} className="text-[13px]">
        {label}
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          aria-describedby={`${inputId}-hint ${inputId}-result`}
          aria-invalid={!!problem || (result ? !result.ok : undefined)}
          autoComplete="off"
          spellCheck={false}
          type={secret ? "password" : "text"}
          value={shown}
          placeholder={secret && setting?.isSet ? setting.value : placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run();
            }
          }}
          className="min-w-0 flex-1 basis-56 font-mono text-[13px]"
        />
        <div className="flex shrink-0 gap-2">
          <Button size="sm" className="h-9" disabled={busy || !canTest} onClick={() => void run()} aria-label={`${typed !== null ? "Save and test" : idleLabel} ${label}`}>
            {busy && <Loader2 className="animate-spin" />}
            {typed !== null ? "Save & test" : idleLabel}
          </Button>
          {setting?.isSet && !setting.fromEnv && secret && typed === null && (
            <Button size="sm" variant="ghost" className="h-9" aria-label={`Clear ${label}`} onClick={() => void clear()}>
              Clear
            </Button>
          )}
        </div>
      </div>
      {problem && (
        <p className="flex items-start gap-1.5 text-[12px] text-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {problem}
        </p>
      )}
      <div id={`${inputId}-result`} role="status" aria-live="polite" className="empty:hidden">
        {result && (
          <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]", result.ok ? "text-success" : "text-destructive")}>
            {result.ok ? <CheckCircle2 className="size-3.5 shrink-0" /> : <CircleAlert className="size-3.5 shrink-0" />}
            <span className="min-w-0 break-words">
              {result.ok ? `Connected${result.saved ? " and saved" : ""} · ${result.detail}` : result.saved ? `Saved, not connected yet · ${result.detail}` : result.detail}
            </span>
            {result.unsaved && (
              <button type="button" onClick={() => void saveAnyway(result.unsaved!)} className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                Save anyway
              </button>
            )}
          </p>
        )}
      </div>
      {hint !== undefined && (
        <p id={`${inputId}-hint`} className="text-[12px] text-muted-foreground">
          {setting?.fromEnv ? "Set from an environment variable; a value saved here wins. " : ""}
          {hint}
        </p>
      )}
    </div>
  );
}
