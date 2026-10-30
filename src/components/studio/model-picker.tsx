"use client";

import { ChevronDown, Cloud, Cpu, SearchX, Server, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useIsMobile } from "@/hooks/use-mobile";
import { type Engine, type ModelDef } from "@/lib/catalog/types";
import { useEngineMode, useStatus } from "@/lib/api";
import { bestForStudio, groupModels, toggleIn } from "@/lib/composer";
import { formatCost } from "@/lib/format";
import { ISOLATED_NOTE } from "@/lib/model-rows";
import { cn } from "@/lib/utils";
import { EngineSwitch } from "./engine-switch";
import { ResponsivePanel } from "./responsive-panel";
import { RECENT_MODELS, STARRED_MODELS, useStoredList } from "./stored-list";
import { VendorMark } from "./vendor-mark";

const BADGE_LABEL: Record<string, string> = {
  new: "New",
  top: "Top",
  fast: "Fast",
  audio: "Audio",
  "4k": "4K",
  hd: "1080p",
  pro: "Pro",
  open: "Open",
  uncensored: "Uncensored",
  beta: "Beta",
};

export function ModelBadges({ model, max }: { model: ModelDef; max?: number }) {
  const badges = (model.badges ?? []).filter((b) => b !== "open").slice(0, max);
  if (!badges.length) return null;
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {badges.map((b) => (
        <Badge
          key={b}
          variant="secondary"
          className={cn(
            "h-4 rounded-[4px] px-1 text-[10px] font-medium",
            b === "new" && "bg-highlight text-highlight-foreground",
            b === "top" && "bg-brand-faint text-brand-text",
          )}
        >
          {BADGE_LABEL[b]}
        </Badge>
      ))}
    </span>
  );
}

function priceHint(m: ModelDef): string {
  if (m.engine === "open") return "Free";
  if (!m.pricing) return "";
  const unit = { image: "/image", second: "/sec", video: "/video", request: "/run", megapixel: "/MP", minute: "/min" }[m.pricing.unit];
  return `${formatCost(m.pricing.usd)}${unit}`;
}

const STAR_KEY_HINT = "Alt+S";

/**
 * Alt+S (or ⌥S) stars or unstars the highlighted model, so starring works from the keyboard
 * while focus stays in the search field. Rows are cmdk items valued "<group>:<model id>".
 */
function starKey(e: React.KeyboardEvent<HTMLElement>, toggle: (id: string) => void) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyS") return;
  const value = e.currentTarget.querySelector('[cmdk-item][data-selected="true"]')?.getAttribute("data-value");
  const id = value?.slice(value.indexOf(":") + 1);
  if (!id) return;
  e.preventDefault();
  toggle(id);
}

function ModelRow({
  m,
  selected,
  starred,
  showEngine,
  onStar,
}: {
  m: ModelDef;
  selected: boolean;
  starred: boolean;
  showEngine: boolean;
  onStar: () => void;
}) {
  return (
    <>
      <VendorMark vendor={m.vendor} engine={m.engine} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-medium", selected && "text-brand-text")}>
            {m.name}
            {starred && <span className="sr-only">, starred</span>}
          </span>
          <ModelBadges model={m} max={2} />
          {showEngine && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-muted px-1 text-[10px] leading-4 font-medium text-muted-foreground">
              {m.engine === "open" ? <Cpu className="size-2.5!" /> : <Cloud className="size-2.5!" />}
              {m.engine === "open" ? "Open source" : "Cloud"}
            </span>
          )}
        </span>
        <span className="block truncate text-[12px] leading-snug text-muted-foreground">
          {m.vendor} · {m.tagline}
        </span>
        {m.worker === "isolated" && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-muted-foreground">
            <Server className="size-3! shrink-0" aria-hidden />
            {ISOLATED_NOTE}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{priceHint(m)}</span>
      {/* Pointer only: inside an option it would be a nested control. Keyboard: Alt+S on the highlighted row (starKey). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        title={starred ? `Unstar (${STAR_KEY_HINT})` : `Star (${STAR_KEY_HINT})`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-subtle-foreground transition hover:bg-accent hover:text-foreground focus-visible:opacity-100",
          starred ? "text-highlight-foreground" : "opacity-100 sm:opacity-0 sm:group-hover/command-item:opacity-100 sm:group-data-selected/command-item:opacity-100",
        )}
      >
        <Star className={cn("size-3.5!", starred && "fill-highlight text-highlight-foreground")} />
      </button>
    </>
  );
}

interface PickerProps {
  models: ModelDef[];
  value: ModelDef | undefined;
  onChange: (m: ModelDef) => void;
  engine: Engine;
  onEngineChange: (e: Engine) => void;
  defaultModels?: { cloud: string; open: string };
}

/**
 * Model picker on cmdk: Recent, Starred and "Best for this studio" above the full list for the
 * current engine; typing searches both engines at once (each row says which). A popover on
 * desktop, a bottom sheet on phones. The list is built only while the panel is open (a canvas
 * board shows dozens of closed pickers).
 */
export function ModelPicker(props: PickerProps) {
  const [open, setOpen] = useState(false);
  const { value } = props;
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Choose a model"
      className="w-[min(92vw,440px)] p-0 shadow-strong"
      sheetClassName="h-[80svh]"
      trigger={
        <Button variant="secondary" size="sm" className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[13px] font-medium" aria-label={`Model: ${value?.name ?? "none"}. Change model`}>
          {value?.engine === "open" ? <Cpu className="size-3.5" /> : <Cloud className="size-3.5" />}
          <span className="max-w-32 truncate sm:max-w-44">{value?.name ?? "Choose model"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      }
    >
      <PickerList {...props} onPicked={() => setOpen(false)} />
    </ResponsivePanel>
  );
}

/** The searchable list (mounted by the popover / sheet only while it shows). */
function PickerList({ models, value, onChange, engine, onEngineChange, defaultModels, onPicked }: PickerProps & { onPicked: () => void }) {
  const [q, setQ] = useState("");
  const status = useStatus().data;
  const mode = useEngineMode();
  const mobile = useIsMobile();
  const [recent] = useStoredList(RECENT_MODELS);
  const [starred, setStarred] = useStoredList(STARRED_MODELS);
  const engines = useMemo<Engine[]>(() => (mode === "both" ? ["cloud", "open"] : [mode]), [mode]);
  // "Best" ranks models that do what the studio's default does first (its main operation), not single-purpose tools.
  const best = useMemo(() => {
    const id = defaultModels?.[engine];
    const op = models.find((m) => m.id === id)?.routes[0]?.op;
    return bestForStudio(models, engine, id, 4, op).map((m) => m.id);
  }, [models, engine, defaultModels]);
  const { groups, count } = useMemo(() => groupModels({ models, engine, engines, query: q, recent, starred, best }), [models, engine, engines, q, recent, starred, best]);
  const ready = (m: ModelDef) => m.routes.some((r) => status?.providers[r.provider]?.configured);
  const shown = groups.flatMap((g) => g.models);
  const demo = status && status.demoMode !== "off" && shown.some((m) => !ready(m));
  const otherEngine = engine === "cloud" ? "open" : "cloud";
  const noneForEngine = !q && !models.some((m) => m.engine === engine);

  const pick = (m: ModelDef) => {
    onChange(m);
    onPicked();
  };

  return (
    <Command shouldFilter={false} loop label="Models" onKeyDown={(e) => starKey(e, (id) => setStarred((s) => toggleIn(s, id)))} className="rounded-none! bg-transparent p-0">
      <div className="flex items-center gap-2 p-1 sm:p-2 sm:pb-1">
        <div className="min-w-0 flex-1 [&_[data-slot=command-input-wrapper]]:p-0">
          <CommandInput value={q} onValueChange={setQ} placeholder={mode === "both" ? "Search all models" : "Search models"} aria-label="Search models" autoFocus={!mobile} />
        </div>
        <EngineSwitch value={engine} onChange={onEngineChange} size="sm" />
      </div>
      <div className="flex items-baseline gap-x-2 px-3 pb-1.5 leading-snug text-[11px] text-muted-foreground sm:px-3.5">
        <span className="shrink-0 whitespace-nowrap tabular-nums">{q ? `${count} result${count === 1 ? "" : "s"}` : `${count} ${engine === "open" ? "open-source" : "cloud"} model${count === 1 ? "" : "s"}`}</span>
        {demo && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0">
              Demo — no key connected, outputs are placeholders.{" "}
              <Link href="/settings" className="text-brand-text underline underline-offset-2">
                Connect
              </Link>
            </span>
          </>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap max-sm:hidden">
          <kbd className="font-sans">{STAR_KEY_HINT}</kbd> stars
        </span>
      </div>
      <CommandList className="max-h-[min(52vh,420px)] border-t sm:max-h-[min(56vh,440px)]">
        {groups.map((g) => (
          <CommandGroup key={g.id} heading={g.label}>
            {g.models.map((m) => (
              <CommandItem
                key={`${g.id}:${m.id}`}
                value={`${g.id}:${m.id}`}
                onSelect={() => pick(m)}
                data-checked={value?.id === m.id}
                className={cn("gap-2.5 rounded-lg px-2 py-1.5 [&>svg:last-child]:hidden", value?.id === m.id && "bg-brand-faint data-selected:bg-brand-faint-hover")}
              >
                <ModelRow m={m} selected={value?.id === m.id} starred={starred.includes(m.id)} showEngine={!!q || m.engine !== engine} onStar={() => setStarred((s) => toggleIn(s, m.id))} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {!groups.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <SearchX className="size-5 text-subtle-foreground" />
            {noneForEngine ? (
              <>
                <p className="text-[13px] text-muted-foreground">No {engine === "open" ? "open-source" : "cloud"} models for this yet.</p>
                {engines.includes(otherEngine) && (
                  <Button variant="secondary" size="sm" onClick={() => onEngineChange(otherEngine)}>
                    Show {otherEngine === "open" ? "open-source" : "cloud"} models
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">No models match “{q}”</p>
                <Button variant="secondary" size="sm" onClick={() => setQ("")}>
                  Clear search
                </Button>
              </>
            )}
          </div>
        )}
      </CommandList>
    </Command>
  );
}
