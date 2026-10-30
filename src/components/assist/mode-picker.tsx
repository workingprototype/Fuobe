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
  normalizeAgent,
  type AssistAgent,
  type AssistAvailability,
  type AssistModeChoice,
} from "@/lib/assist";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";

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
      // A choice saved when the local agent was called "ollama" reads as "local".
      if (saved?.mode) return saved.agent ? { ...saved, agent: normalizeAgent(saved.agent) } : saved;
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
  if (c.agent === "local") return c.model ?? can?.local.model ?? "Local";
  const m = CLAUDE_MODELS.find((x) => x.id === (c.model ?? DEFAULT_CLAUDE_MODEL))?.label.replace("Claude ", "") ?? "Claude";
  return `${m} · ${ASSIST_EFFORTS.find((e) => e.id === (c.effort ?? DEFAULT_EFFORT))?.label}`;
}

const MODE_ICON = { smart: Sparkles, free: Cpu, manual: Gauge } as const;

const sameChoice = (a: AssistModeChoice | null, b: AssistModeChoice | null) =>
  (a?.mode ?? null) === (b?.mode ?? null) && (a?.agent ?? null) === (b?.agent ?? null) && (a?.model ?? null) === (b?.model ?? null) && (a?.effort ?? null) === (b?.effort ?? null);

interface ModelOption {
  key: string;
  on: boolean;
  disabled?: boolean;
  pick: Partial<AssistModeChoice>;
  icon: typeof Bot;
  title: React.ReactNode;
  hint: string;
}

/**
 * Supercomputer's Free / Smart / Manual, on Fuobe's agents (Claude, a local model on Ollama, LM Studio,
 * Unsloth Studio or another OpenAI-compatible server, the offline planner).
 * With `applyOnClose` (an existing chat) choices are kept in the menu and sent once when it
 * closes, so trying the tabs doesn't switch the chat at every click. Smart needs Claude: without
 * an Anthropic key it can't be picked (and a saved Smart shows as the Free it runs as).
 */
export function ModePicker({
  value,
  onChange,
  availability: can,
  disabled,
  applyOnClose,
}: {
  value: AssistModeChoice | null;
  onChange: (c: AssistModeChoice) => void;
  availability?: AssistAvailability;
  disabled?: boolean;
  applyOnClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AssistModeChoice | null>(null);
  const shown = (applyOnClose && open ? draft : null) ?? value;
  const smartOff = !!can && !can.claude;
  const picked = shown?.mode ?? can?.defaultMode ?? "smart";
  const mode = picked === "smart" && smartOff ? "free" : picked;
  // The label, its aria-label and the icon all come from this one resolved value.
  const resolved: AssistModeChoice = { ...(shown ?? {}), mode };
  const label = modeChipLabel(resolved, can);
  const Icon = MODE_ICON[mode];
  const agent: AssistAgent = shown?.agent ?? "claude";
  const set = (patch: Partial<AssistModeChoice>) => {
    const next = { ...resolved, ...patch } as AssistModeChoice;
    if (applyOnClose) setDraft(next);
    else onChange(next);
  };
  const onOpenChange = (o: boolean) => {
    if (o) setDraft(value);
    else if (applyOnClose && draft && !sameChoice(draft, value)) onChange(draft);
    setOpen(o);
  };
  const pending = applyOnClose && open && draft && !sameChoice(draft, value);

  const models: ModelOption[] = [
    ...CLAUDE_MODELS.map((m) => ({
      key: m.id,
      on: agent === "claude" && (shown?.model ?? DEFAULT_CLAUDE_MODEL) === m.id,
      disabled: !can?.claude,
      pick: { agent: "claude" as const, model: m.id },
      icon: Bot,
      title: <span className="block text-[13px] font-medium">{m.label}</span>,
      hint: m.hint,
    })),
    ...(can?.local.models.length ? can.local.models : can?.local.ok && can.local.model ? [can.local.model] : []).map((name) => ({
      key: `local:${name}`,
      on: agent === "local" && (shown?.model ?? can?.local.model) === name,
      pick: { agent: "local" as const, model: name, effort: null },
      icon: Cpu,
      title: <span className="block truncate font-mono text-[12px]">{name}</span>,
      hint: `Local, through ${can?.local.label ?? "your local server"} · free`,
    })),
    { key: "offline", on: agent === "offline", pick: { agent: "offline", model: null, effort: null }, icon: Gauge, title: <span className="block text-[13px] font-medium">Offline planner</span>, hint: "Rules, no LLM — simple requests only" },
  ];
  // One Tab stop per group: the picked option, or the first one that can be picked.
  const modelStop = models.find((m) => m.on && !m.disabled)?.key ?? models.find((m) => !m.disabled)?.key;
  const effort = shown?.effort ?? DEFAULT_EFFORT;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // One width for "Smart", "Free" and "Mode": the label can change once availability loads, and the chips after it must not move.
          // Phones drop the chevron, so the composer's chips fit one row at 390 px.
          className="inline-flex h-8 max-w-[11rem] min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50 max-sm:min-w-[5rem] max-sm:px-2.5"
          aria-label={`Mode: ${label}`}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60 max-sm:hidden" />
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
        <div role="radiogroup" aria-label="Mode" onKeyDown={radioKeys} className="grid grid-cols-3 gap-1 rounded-full bg-muted p-0.5">
          {ASSIST_MODES.map((m) => {
            const off = m.id === "smart" && smartOff;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                tabIndex={radioTab(mode === m.id)}
                disabled={off}
                title={off ? "Needs an Anthropic API key (Settings)" : undefined}
                onClick={() => set({ mode: m.id, ...(m.id === "manual" && !shown?.agent && { agent: can?.claude ? "claude" : can?.local.ok ? "local" : "offline" }) })}
                className={cn("h-8 rounded-full text-[13px] font-medium transition-colors disabled:opacity-45", mode === m.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground enabled:hover:text-foreground")}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">{ASSIST_MODES.find((m) => m.id === mode)?.hint}</p>
        {smartOff && (
          <p className="mt-2 px-1 text-[12px] text-warning">
            Smart and the Claude models need an Anthropic API key —{" "}
            <Link href="/settings#text-ai" className="underline underline-offset-2">
              add one in Settings
            </Link>
            .
          </p>
        )}
        {mode === "free" && (
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">
            {can?.local.ok ? (
              <>
                Runs on <span className="font-mono">{can.local.model}</span> through {can.local.label} — free, on this machine.
              </>
            ) : can?.local.problem ? (
              `${can.local.problem} Until then, the offline planner takes simple requests.`
            ) : (
              "No local model is answering, so the offline planner takes simple requests. Start Ollama, LM Studio or Unsloth Studio for a real local assistant."
            )}
          </p>
        )}
        {mode === "manual" && (
          <div className="mt-3 space-y-3">
            <div role="radiogroup" aria-label="Model" onKeyDown={radioKeys} className="space-y-1">
              {models.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={m.on}
                  tabIndex={m.key === modelStop ? 0 : -1}
                  disabled={m.disabled}
                  onClick={() => set(m.pick)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent", m.on && "bg-brand-faint hover:bg-brand-faint-hover")}
                >
                  <m.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {m.title}
                    <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {agent === "claude" && (
              <div>
                <p className="mb-1.5 px-1 text-[12px] font-medium">Effort</p>
                <div role="radiogroup" aria-label="Effort" onKeyDown={radioKeys} className="grid grid-cols-5 gap-0.5 rounded-full bg-muted p-0.5">
                  {ASSIST_EFFORTS.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={effort === e.id}
                      tabIndex={radioTab(effort === e.id)}
                      onClick={() => set({ effort: e.id })}
                      className={cn("h-7 rounded-full text-[12px] font-medium transition-colors", effort === e.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
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
        {pending && <p className="mt-3 border-t px-1 pt-2 text-[11px] text-muted-foreground">Applies to this chat when you close this menu.</p>}
      </PopoverContent>
    </Popover>
  );
}
