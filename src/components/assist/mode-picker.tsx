"use client";

import { Bot, ChevronDown, Cpu, Gauge, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ASSIST_EFFORTS,
  ASSIST_MODES,
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EFFORT,
  type AssistAgent,
  type AssistAvailability,
  type AssistModeChoice,
} from "@/lib/assist";
import { cn } from "@/lib/utils";

const KEY = "fuobe:assist-mode";

const listeners = new Set<() => void>();
/** Used when the browser won't store anything (private windows, blocked storage). */
let fallback: string | null = null;
const readSaved = () => {
  try {
    return localStorage.getItem(KEY) ?? fallback;
  } catch {
    return fallback;
  }
};

/** The mode new chats start in (remembered in this browser; the server's default until one is picked). */
export function useModeChoice(defaultMode?: AssistModeChoice["mode"]): [AssistModeChoice | null, (c: AssistModeChoice) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    readSaved,
    () => null,
  );
  const choice = useMemo(() => {
    try {
      const saved = JSON.parse(raw ?? "null") as AssistModeChoice | null;
      if (saved?.mode) return saved;
    } catch {}
    return defaultMode ? { mode: defaultMode } : null;
  }, [raw, defaultMode]);
  return [
    choice,
    (c) => {
      fallback = JSON.stringify(c);
      try {
        localStorage.setItem(KEY, fallback);
      } catch {}
      listeners.forEach((l) => l());
    },
  ];
}

export function modeChipLabel(c: AssistModeChoice | null, can?: AssistAvailability): string {
  if (!c) return "Mode";
  if (can?.aiOff) return "Offline";
  if (c.mode !== "manual") return c.mode === "smart" ? "Smart" : "Free";
  if (c.agent === "offline") return "Offline planner";
  if (c.agent === "ollama") return c.model ?? can?.ollamaModel ?? "Local";
  const m = CLAUDE_MODELS.find((x) => x.id === (c.model ?? DEFAULT_CLAUDE_MODEL))?.label.replace("Claude ", "") ?? "Claude";
  return `${m} · ${ASSIST_EFFORTS.find((e) => e.id === (c.effort ?? DEFAULT_EFFORT))?.label}`;
}

const MODE_ICON = { smart: Sparkles, free: Cpu, manual: Gauge } as const;

/** Supercomputer's Free / Smart / Manual, on Fuobe's agents (Claude, Ollama, the offline planner). */
export function ModePicker({ value, onChange, availability: can, disabled }: { value: AssistModeChoice | null; onChange: (c: AssistModeChoice) => void; availability?: AssistAvailability; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const mode = value?.mode ?? can?.defaultMode ?? "smart";
  const Icon = MODE_ICON[mode];
  const agent: AssistAgent = value?.agent ?? "claude";
  const set = (patch: Partial<AssistModeChoice>) => onChange({ ...(value ?? { mode }), ...patch } as AssistModeChoice);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50"
          aria-label={`Mode: ${modeChipLabel(value, can)}`}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{modeChipLabel(value ?? { mode }, can)}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[min(92vw,360px)] p-3">
        {can?.aiOff && (
          <p className="mb-3 rounded-lg bg-highlight/25 px-3 py-2 text-[12px]">
            The AI helper is off in{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            , so every chat uses the offline planner.
          </p>
        )}
        <div role="radiogroup" aria-label="Mode" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-0.5">
          {ASSIST_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => set({ mode: m.id, ...(m.id === "manual" && !value?.agent && { agent: can?.claude ? "claude" : can?.ollama ? "ollama" : "offline" }) })}
              className={cn("h-8 rounded-full text-[13px] font-medium transition-colors", mode === m.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">{ASSIST_MODES.find((m) => m.id === mode)?.hint}</p>
        {mode === "smart" && !can?.claude && (
          <p className="mt-2 px-1 text-[12px] text-warning">
            Needs an Anthropic API key —{" "}
            <Link href="/settings#keys" className="underline underline-offset-2">
              add one in Settings
            </Link>
            . Until then chats run in Free.
          </p>
        )}
        {mode === "free" && (
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">
            {can?.ollama ? (
              <>
                Runs on <span className="font-mono">{can.ollamaModel}</span> through Ollama — free, on this machine.
              </>
            ) : (
              "Ollama isn't answering, so the offline planner takes simple requests. Start Ollama for a real local assistant."
            )}
          </p>
        )}
        {mode === "manual" && (
          <div className="mt-3 space-y-3">
            {!can?.claude && (
              <p className="px-1 text-[12px] text-muted-foreground">
                Claude models need an Anthropic API key —{" "}
                <Link href="/settings#keys" className="underline underline-offset-2">
                  Settings
                </Link>
                .
              </p>
            )}
            <div role="radiogroup" aria-label="Model" className="space-y-1">
              {CLAUDE_MODELS.map((m) => {
                const on = agent === "claude" && (value?.model ?? DEFAULT_CLAUDE_MODEL) === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!can?.claude}
                    onClick={() => set({ agent: "claude", model: m.id })}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent", on && "bg-brand-faint hover:bg-brand-faint-hover")}
                  >
                    <Bot className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{m.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                    </span>
                  </button>
                );
              })}
              {(can?.ollamaModels.length ? can.ollamaModels : can?.ollama ? [can.ollamaModel] : []).map((name) => {
                const on = agent === "ollama" && (value?.model ?? can?.ollamaModel) === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ agent: "ollama", model: name, effort: null })}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent", on && "bg-brand-faint hover:bg-brand-faint-hover")}
                  >
                    <Cpu className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px]">{name}</span>
                      <span className="block text-[11px] text-muted-foreground">Local, through Ollama · free</span>
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={agent === "offline"}
                onClick={() => set({ agent: "offline", model: null, effort: null })}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent", agent === "offline" && "bg-brand-faint hover:bg-brand-faint-hover")}
              >
                <Gauge className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Offline planner</span>
                  <span className="block text-[11px] text-muted-foreground">Rules, no LLM — simple requests only</span>
                </span>
              </button>
            </div>
            {agent === "claude" && (
              <div>
                <p className="mb-1.5 px-1 text-[12px] font-medium">Effort</p>
                <div role="radiogroup" aria-label="Effort" className="grid grid-cols-5 gap-0.5 rounded-full bg-muted p-0.5">
                  {ASSIST_EFFORTS.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={(value?.effort ?? DEFAULT_EFFORT) === e.id}
                      onClick={() => set({ effort: e.id })}
                      className={cn("h-7 rounded-full text-[12px] font-medium transition-colors", (value?.effort ?? DEFAULT_EFFORT) === e.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Higher effort thinks longer and costs more per reply.</p>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
