"use client";

import { Check, ChevronDown, Cloud, Cpu, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OPERATION_LABELS, type Engine, type ModelDef } from "@/lib/catalog/types";
import { useStatus } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EngineSwitch } from "./engine-switch";

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

export function ModelBadges({ model }: { model: ModelDef }) {
  return (
    <span className="flex flex-wrap gap-1">
      {(model.badges ?? [])
        .filter((b) => b !== "open")
        .map((b) => (
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
  if (m.engine === "open") return "Free · your GPU";
  if (!m.pricing) return "";
  const unit = { image: "/image", second: "/sec", video: "/video", request: "/run", megapixel: "/MP", minute: "/min" }[m.pricing.unit];
  return `${formatCost(m.pricing.usd)}${unit}`;
}

export function ModelPicker({
  models,
  value,
  onChange,
  engine,
  onEngineChange,
}: {
  models: ModelDef[];
  value: ModelDef | undefined;
  onChange: (m: ModelDef) => void;
  engine: Engine;
  onEngineChange: (e: Engine) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const status = useStatus().data;
  const visible = useMemo(
    () =>
      models.filter(
        (m) =>
          m.engine === engine &&
          (!q || `${m.name} ${m.vendor} ${m.tagline}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [models, engine, q],
  );
  const providerReady = (m: ModelDef) =>
    m.routes.some((r) => status?.providers[r.provider]?.configured);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-3 text-[13px] font-medium">
          {value?.engine === "open" ? <Cpu className="size-3.5" /> : <Cloud className="size-3.5" />}
          <span className="max-w-40 truncate">{value?.name ?? "Choose model"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,420px)] p-0 shadow-strong">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models"
              className="h-8 w-full rounded-md bg-muted pr-2 pl-8 text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>
          <EngineSwitch value={engine} onChange={onEngineChange} size="sm" />
        </div>
        <ScrollArea className="max-h-[min(60vh,440px)]">
          <div className="p-1">
            {visible.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No {engine === "open" ? "open-source" : "cloud"} models for this yet.
              </p>
            )}
            {visible.map((m) => {
              const ready = providerReady(m);
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                    value?.id === m.id && "bg-brand-faint",
                  )}
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground uppercase">
                    {m.vendor.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <ModelBadges model={m} />
                    </span>
                    <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{m.tagline}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle-foreground">
                      <span className="font-mono">{priceHint(m)}</span>
                      <span>·</span>
                      <span className="truncate">{[...new Set(m.routes.map((r) => OPERATION_LABELS[r.op]))].join(", ")}</span>
                      {status && !ready && <span className="ml-auto shrink-0 text-warning">demo</span>}
                    </span>
                  </span>
                  {value?.id === m.id && <Check className="mt-1 size-4 text-brand-text" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
