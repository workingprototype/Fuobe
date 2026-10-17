"use client";

import { ArrowDownAZ, Check, Hash, ListOrdered, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAMERA_MOVES, moveBySlug, openCameraRoute, type CameraMove } from "@/lib/catalog/cinema";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/** Name matches first (prefix, then word start, then anywhere), the slug and the hint after. */
function moveScore(value: string, search: string, keywords?: string[]): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const name = value.toLowerCase();
  if (name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 0.9;
  if (name.includes(q)) return 0.8;
  const [slug = "", hint = ""] = (keywords ?? []).map((k) => k.toLowerCase());
  if (slug.includes(q.replace(/\s+/g, "-"))) return 0.6;
  return hint.includes(q) ? 0.2 : 0;
}

/** How the open engine drives a move (shown as a small badge in the picker). */
function routeBadge(m: CameraMove, engine: Engine): string | null {
  if (engine !== "open") return null;
  const r = openCameraRoute(m.slug, true);
  return r.via === "lora" ? "LoRA" : r.via === "fun-camera" ? "Fun Camera" : null;
}

export function MoveList({
  engine,
  selected,
  onPick,
  defaultQuery,
  autoFocus,
}: {
  engine: Engine;
  selected: string[];
  onPick: (slug: string) => void;
  /** What was typed after "#" in the prompt (the list mounts fresh each time the picker opens). */
  defaultQuery?: string;
  autoFocus?: boolean;
}) {
  const [sort, setSort] = useState<"default" | "name">("default");
  const [query, setQuery] = useState(defaultQuery ?? "");
  const moves = useMemo(() => (sort === "name" ? [...CAMERA_MOVES].sort((a, b) => a.name.localeCompare(b.name)) : CAMERA_MOVES), [sort]);
  return (
    <Command loop className="bg-transparent" filter={moveScore}>
      <div className="flex items-center gap-1 pr-1">
        <div className="min-w-0 flex-1">
          <CommandInput placeholder="Search camera moves…" value={query} onValueChange={setQuery} autoFocus={autoFocus} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSort((s) => (s === "default" ? "name" : "default"))}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={sort === "default" ? "Sort by name" : "Default order"}
            >
              {sort === "default" ? <ArrowDownAZ className="size-4" /> : <ListOrdered className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{sort === "default" ? "Sort: Name (A–Z)" : "Sort: Default"}</TooltipContent>
        </Tooltip>
      </div>
      <CommandList className="max-h-[min(52vh,360px)]">
        <CommandEmpty>No camera moves match your search</CommandEmpty>
        <CommandGroup>
          {moves.map((m) => {
            const badge = routeBadge(m, engine);
            const n = selected.indexOf(m.slug);
            return (
              <CommandItem key={m.slug} value={m.name} keywords={[m.slug, m.hint]} onSelect={() => onPick(m.slug)} className="group/move items-start gap-2.5 py-2">
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold", n >= 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {n >= 0 ? n + 1 : <Hash className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    {m.name}
                    {badge && <span className="rounded-full bg-brand-faint px-1.5 py-px text-[10px] font-medium text-brand-text">{badge}</span>}
                  </span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{m.hint}</span>
                </span>
                <span className="mt-0.5 shrink-0 text-[11px] font-medium text-brand-text opacity-0 group-data-[selected=true]/move:opacity-100">Use</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** "#" picker: opens from the # button or when "#" is typed in the prompt; several moves per shot, in order. */
export function MovePicker({
  open,
  onOpenChange,
  engine,
  selected,
  onPick,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  engine: Engine;
  selected: string[];
  onPick: (slug: string) => void;
  initialQuery?: string;
}) {
  const trigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
              selected.length ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
            aria-label="Add a camera move"
          >
            <Hash className="size-3.5" />
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Direct a camera move · type #</TooltipContent>
    </Tooltip>
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger}
      <PopoverContent className="w-[min(92vw,400px)] p-0" align="start" side="top" collisionPadding={12}>
        <div className="border-b px-3 pt-3 pb-2">
          <p className="text-[13px] font-medium">Direct a camera move</p>
          <p className="text-[12px] text-muted-foreground">Adds to the prompt box, or type # there. Several per shot; order matters.</p>
        </div>
        <MoveList
          engine={engine}
          selected={selected}
          defaultQuery={initialQuery}
          autoFocus
          onPick={(slug) => {
            onPick(slug);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The shot's moves as ordered tags: drag or Alt+←/→ to reorder, × or Backspace to remove. */
export function MoveChips({ moves, onChange }: { moves: string[]; onChange: (m: string[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  if (!moves.length) return null;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= moves.length || from === to) return;
    const next = [...moves];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5" role="list" aria-label="Camera moves, in order">
      {moves.map((slug, i) => {
        const m = moveBySlug(slug);
        return (
          <span
            key={`${slug}-${i}`}
            role="listitem"
            draggable
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowLeft") move(i, i - 1);
              else if (e.altKey && e.key === "ArrowRight") move(i, i + 1);
              else if (e.key === "Backspace" || e.key === "Delete") onChange(moves.filter((_, j) => j !== i));
            }}
            title={m?.hint}
            className="inline-flex h-7 cursor-grab items-center gap-1 rounded-full bg-brand-faint pr-1 pl-1.5 text-[12px] font-medium text-brand-text outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{i + 1}</span>#{m?.name ?? slug}
            <button type="button" onClick={() => onChange(moves.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-full hover:bg-brand-faint-hover" aria-label={`Remove ${m?.name ?? slug}`}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {moves.length > 1 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3" /> runs in this order
        </span>
      )}
    </div>
  );
}
