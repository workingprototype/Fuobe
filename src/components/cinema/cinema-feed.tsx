"use client";

import {
  CalendarDays,
  Check,
  Clapperboard,
  Copy,
  Download,
  FastForward,
  FolderInput,
  Grid3x3,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  MapPin,
  MoreHorizontal,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  Trash2,
  UserRoundPlus,
  Video,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FailedTile, MediaThumb, PendingTile, downloadName, tileRatio } from "@/components/studio/feed";
import { Viewer } from "@/components/studio/viewer";
import { getModel } from "@/lib/catalog";
import type { CinemaFolder } from "@/lib/catalog/cinema";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { formatCost, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoveToItems } from "./folder-sidebar";
import { useItemActions, type CinemaGeneration } from "./hooks";

type Layout = "square" | "masonry" | "list";
type TypeFilter = "all" | "image" | "video" | "audio";
type DateFilter = "all" | "today" | "7d" | "30d";
type StatusFilter = "all" | "liked" | "rendering" | "failed";

interface Prefs {
  layout: Layout;
  split: boolean;
  fit: boolean;
  type: TypeFilter;
  date: DateFilter;
  status: StatusFilter;
  hideFailed: boolean;
}

const DEFAULT_PREFS: Prefs = { layout: "square", split: true, fit: false, type: "all", date: "all", status: "all", hideFailed: false };
const PREFS_KEY = "fuobe.cinema.feed";
const prefListeners = new Set<() => void>();
let prefCache: { raw: string | null; value: Prefs } | null = null;

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (prefCache?.raw === raw) return prefCache.value;
    const value = { ...DEFAULT_PREFS, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
    prefCache = { raw, value };
    return value;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Feed layout and filters, remembered per viewer. */
function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    readPrefs,
    () => DEFAULT_PREFS,
  );
  const set = useCallback((p: Partial<Prefs>) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...p }));
    } catch {}
    prefListeners.forEach((l) => l());
  }, []);
  return [prefs, set];
}

/** One tile: a pending/failed take, one output of a take, or a tile cut from a grid sheet. */
interface Unit {
  key: string;
  g: CinemaGeneration;
  output?: OutputFile;
  index: number;
  tile?: { row: number; col: number };
}

const active = (g: Generation) => g.status === "queued" || g.status === "running";

function units(items: CinemaGeneration[]): Unit[] {
  const out: Unit[] = [];
  for (const g of items) {
    if (g.status !== "succeeded") {
      out.push({ key: g.id, g, index: 0 });
      continue;
    }
    // Open-source grids return the sheet first, then its tiles.
    const sheetTiles = g.feature === "cinema-grid" && g.outputs.length > 1;
    const outputs = sheetTiles ? g.outputs.slice(0, 1) : g.outputs;
    outputs.forEach((o, i) => out.push({ key: `${g.id}:${i}`, g, output: o, index: i }));
    const tiles = g.tiles?.length ? g.tiles.map((t) => ({ url: t.url, row: t.row, col: t.col })) : sheetTiles ? g.outputs.slice(1).map((o, i) => ({ url: o.url, row: -1, col: i })) : [];
    tiles.forEach((t, i) => out.push({ key: `${g.id}:t${i}`, g, output: { url: t.url, kind: "image" }, index: i, tile: { row: t.row, col: t.col } }));
  }
  return out;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const promptOf = (g: CinemaGeneration) => g.take?.prompt?.trim() || g.request.prompt?.trim() || g.prompt || "Untitled";

const STEP_HINT: Record<string, string> = { "cinema-cast": "Cast", "cinema-location": "Location", "cinema-grid": "Grid" };

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full bg-black/50 px-1.5 text-[10.5px] font-medium text-white backdrop-blur", className)}>{children}</span>;
}

export interface FeedHandlers {
  onLoad: (g: CinemaGeneration) => void;
  onUseTake: (g: CinemaGeneration, o: OutputFile) => void;
  onAnimate: (url: string) => void;
  onReference: (url: string, kind: OutputFile["kind"]) => void;
  onSaveElement: (g: CinemaGeneration, url: string, kind: "character" | "location") => void;
}

function TileMenu({ u, folders, projectId, handlers, onDelete }: { u: Unit; folders: CinemaFolder[]; projectId: string; handlers: FeedHandlers; onDelete: (ids: string[]) => void }) {
  const actions = useItemActions(projectId);
  const o = u.output;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="grid size-7 place-items-center rounded-lg text-white/90 transition-colors hover:bg-white/20 hover:text-white"
          aria-label="More actions"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => handlers.onLoad(u.g)}>
          <RotateCcw /> Load into prompt bar
        </DropdownMenuItem>
        {o?.kind === "image" && (
          <>
            <DropdownMenuItem onClick={() => handlers.onAnimate(o.url)}>
              <Clapperboard /> Animate (start frame)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlers.onReference(o.url, "image")}>
              <ImagePlus /> Use as reference
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlers.onSaveElement(u.g, o.url, "character")}>
              <UserRoundPlus /> Save as character
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlers.onSaveElement(u.g, o.url, "location")}>
              <MapPin /> Save as location
            </DropdownMenuItem>
          </>
        )}
        {o?.kind === "video" && (
          <>
            <DropdownMenuItem onClick={() => handlers.onUseTake(u.g, o)}>
              <FastForward /> Extend or edit this take
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlers.onReference(o.url, "video")}>
              <ImagePlus /> Use as reference clip
            </DropdownMenuItem>
          </>
        )}
        {o && (
          <DropdownMenuItem asChild>
            <a href={`${o.url}?download=${encodeURIComponent(downloadName(u.g, o, u.index))}`}>
              <Download /> Download
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => void actions.favorite([u.g.id], !u.g.favorite)}>
          <Heart /> {u.g.favorite ? "Unlike" : "Like"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(u.g.prompt ?? "");
            toast("Prompt copied");
          }}
        >
          <Copy /> Copy prompt
        </DropdownMenuItem>
        {!u.tile && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <MoveToItems folders={folders} onMove={(f) => void actions.move([u.g.id], f).then(() => toast("Moved", { duration: 1200 }))} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete([u.g.id])}>
          <Trash2 /> Delete take
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TileView({
  u,
  layout,
  fit,
  selected,
  selecting,
  onToggle,
  onOpen,
  projectId,
  folders,
  handlers,
  onDelete,
  dragIds,
}: {
  u: Unit;
  layout: Layout;
  fit: boolean;
  selected: boolean;
  selecting: boolean;
  onToggle: (shift: boolean) => void;
  onOpen: () => void;
  projectId: string;
  folders: CinemaFolder[];
  handlers: FeedHandlers;
  onDelete: (ids: string[]) => void;
  dragIds: () => string[];
}) {
  const actions = useItemActions(projectId);
  const g = u.g;
  const ratio = u.tile ? 1 : tileRatio(g);
  const aspect = layout === "square" ? 1 : u.output?.kind === "audio" ? 1.6 : ratio;
  const step = u.tile ? `Tile ${u.tile.row >= 0 ? `${u.tile.row + 1}·${u.tile.col + 1}` : u.tile.col + 1}` : (g.request.step?.label ?? STEP_HINT[g.feature]);
  const media =
    active(g) ? (
      <PendingTile g={g} ratio={aspect} />
    ) : g.status !== "succeeded" ? (
      <FailedTile g={g} ratio={aspect} onRetry={() => void actions.retry(g.id).catch((e) => toast.error((e as Error).message))} />
    ) : (
      <div className={cn("relative size-full", fit && "bg-muted")}>
        {/* Behind the video: visible until (or if) the browser can draw its first frame. */}
        {u.output?.kind === "video" && <Video className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-subtle-foreground" aria-hidden />}
        <MediaThumb output={u.output!} className={cn("relative", fit && "object-contain")} />
      </div>
    );
  const clickable = g.status === "succeeded";
  const checkbox = (
    <span
      className={cn(
        "absolute top-2 left-2 z-10 transition-opacity",
        selected || selecting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover/tile:opacity-100 sm:group-focus-within/tile:opacity-100",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
    >
      <Checkbox checked={selected} aria-label={selected ? "Unselect" : "Select"} className="size-5 border-white/80 bg-black/30 shadow-soft data-[state=checked]:border-primary" />
    </span>
  );
  if (layout === "list") {
    return (
      <div
        className={cn("group/tile relative flex items-center gap-3 rounded-xl border p-2 transition-colors", selected ? "border-primary bg-brand-faint" : "hover:bg-accent")}
        draggable={!u.tile}
        onDragStart={(e) => e.dataTransfer.setData("application/x-cinema-takes", JSON.stringify(dragIds()))}
      >
        <Checkbox checked={selected} onCheckedChange={() => onToggle(false)} aria-label={selected ? "Unselect" : "Select"} className="ml-1 size-4" />
        <button
          type="button"
          onClick={(e) => (selecting || e.metaKey || e.ctrlKey ? onToggle(e.shiftKey) : clickable && onOpen())}
          className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-36"
          aria-label="Open"
        >
          {g.status === "succeeded" ? <MediaThumb output={u.output!} className={fit ? "object-contain" : undefined} /> : <span className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">{active(g) ? "Rendering…" : "Failed"}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13.5px] leading-snug">{promptOf(g)}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11.5px] text-muted-foreground">
            {[step, getModel(g.modelId)?.name ?? g.modelId, g.provider === "mock" ? "Demo" : g.engine === "open" ? "Open source" : "Cloud", timeAgo(g.createdAt), g.costUsd ? formatCost(g.costUsd) : null, g.status === "failed" ? g.error : null]
              .filter(Boolean)
              .map((m, i) => (
                <span key={i} className={cn(i > 0 && "before:mr-1.5 before:content-['·']", m === g.error && "text-destructive")}>
                  {m}
                </span>
              ))}
          </p>
        </div>
        {g.favorite && <Heart className="size-4 shrink-0 fill-highlight text-highlight" />}
        <div className="shrink-0 rounded-lg bg-foreground/70 [&_button]:text-white">
          <TileMenu u={u} folders={folders} projectId={projectId} handlers={handlers} onDelete={onDelete} />
        </div>
      </div>
    );
  }
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${step ? `${step}: ` : ""}${promptOf(g)}` : undefined}
      draggable={!u.tile}
      onDragStart={(e) => e.dataTransfer.setData("application/x-cinema-takes", JSON.stringify(dragIds()))}
      onClick={(e) => {
        if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) onToggle(e.shiftKey);
        else if (clickable) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && clickable) onOpen();
        if (e.key === " ") {
          e.preventDefault();
          onToggle(false);
        }
      }}
      className={cn(
        "group/tile relative overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
        layout === "masonry" && "mb-3 break-inside-avoid",
        clickable && "cursor-zoom-in",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      style={{ aspectRatio: aspect }}
    >
      {media}
      {checkbox}
      <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1">
        {g.favorite && <Heart className="size-4 fill-highlight text-highlight drop-shadow" />}
      </div>
      {g.status === "succeeded" && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/65 to-transparent p-2 pt-8 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/tile:opacity-100 sm:group-hover/tile:opacity-100">
          <div className="flex min-w-0 flex-wrap gap-1">
            {step && <Badge>{step}</Badge>}
            {u.output?.kind === "video" && g.request.params?.duration ? <Badge>{g.request.params.duration}s</Badge> : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {u.output?.kind === "video" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => handlers.onUseTake(g, u.output!)} className="grid size-7 place-items-center rounded-lg text-white/90 hover:bg-white/20 hover:text-white" aria-label="Extend or edit this take">
                    <FastForward className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Extend · Prequel · Edit</TooltipContent>
              </Tooltip>
            )}
            {u.output?.kind === "image" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => handlers.onAnimate(u.output!.url)} className="grid size-7 place-items-center rounded-lg text-white/90 hover:bg-white/20 hover:text-white" aria-label="Animate">
                    <Clapperboard className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Animate: use as the start frame</TooltipContent>
              </Tooltip>
            )}
            <TileMenu u={u} folders={folders} projectId={projectId} handlers={handlers} onDelete={onDelete} />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChips({ prefs, setPrefs, nested, onNested }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; nested?: boolean; onNested?: (v: boolean) => void }) {
  const n = [prefs.type !== "all", prefs.date !== "all", prefs.status !== "all", prefs.hideFailed].filter(Boolean).length;
  const group = <T extends string>(label: string, value: T, options: [T, string][], on: (v: T) => void) => (
    <div className="space-y-1">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map(([id, name]) => (
          <button key={id} type="button" onClick={() => on(id)} className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium", value === id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium", n ? "bg-brand-faint text-brand-text" : "bg-secondary hover:bg-accent")} aria-label="Filters">
          <SlidersHorizontal className="size-3.5" /> Filters{n ? ` · ${n}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,320px)] space-y-3 p-3" collisionPadding={12}>
        {group("Type", prefs.type, [["all", "All types"], ["image", "Image"], ["video", "Video"], ["audio", "Audio"]], (type) => setPrefs({ type }))}
        {group("Date", prefs.date, [["all", "All period"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]], (date) => setPrefs({ date }))}
        {group("Status", prefs.status, [["all", "Any"], ["liked", "Liked"], ["rendering", "Rendering"], ["failed", "Failed"]], (status) => setPrefs({ status }))}
        <label className="flex items-center justify-between text-[13px]">
          Hide failed <Switch checked={prefs.hideFailed} onCheckedChange={(hideFailed) => setPrefs({ hideFailed })} />
        </label>
        {onNested && (
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Include generations from nested folders <Switch checked={!!nested} onCheckedChange={onNested} />
          </label>
        )}
        {n > 0 && (
          <button type="button" onClick={() => setPrefs({ type: "all", date: "all", status: "all", hideFailed: false })} className="text-[12px] font-medium text-brand-text hover:underline">
            Clear filters
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CinemaFeed({
  projectId,
  items,
  folders,
  title,
  empty,
  handlers,
  nested,
  onNested,
  toolbarExtra,
}: {
  projectId: string;
  items: CinemaGeneration[];
  folders: CinemaFolder[];
  title: React.ReactNode;
  empty: React.ReactNode;
  handlers: FeedHandlers;
  nested?: boolean;
  onNested?: (v: boolean) => void;
  toolbarExtra?: React.ReactNode;
}) {
  const [prefs, setPrefs] = usePrefs();
  const actions = useItemActions(projectId);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  // Date filters count from when the feed opened.
  const [now] = useState(() => Date.now());

  const filtered = useMemo(() => {
    const age = { today: 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;
    return items.filter((g) => {
      if (prefs.type !== "all" && !(g.outputs.some((o) => o.kind === prefs.type) || (g.status !== "succeeded" && g.kind === prefs.type))) return false;
      if (prefs.date === "today" && dayLabel(g.createdAt) !== "Today") return false;
      if (prefs.date !== "all" && prefs.date !== "today" && now - g.createdAt > age[prefs.date]) return false;
      if (prefs.status === "liked" && !g.favorite) return false;
      if (prefs.status === "rendering" && !active(g)) return false;
      if (prefs.status === "failed" && (g.status !== "failed" && g.status !== "canceled")) return false;
      if (prefs.hideFailed && (g.status === "failed" || g.status === "canceled")) return false;
      return true;
    });
  }, [items, prefs, now]);
  const all = useMemo(() => units(filtered), [filtered]);
  const viewable = all.filter((u) => u.g.status === "succeeded");
  const pos = open ? viewable.findIndex((u) => u.key === open) : -1;
  const ids = useMemo(() => [...new Set(all.map((u) => u.g.id))], [all]);
  const live = [...selected].filter((id) => ids.includes(id));
  const selecting = live.length > 0;

  // Esc unselects (Higgsfield: "Unselect All (Esc)").
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest("input,textarea,[role=dialog]")) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const toggle = (id: string, shift: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (shift && anchor) {
        const a = ids.indexOf(anchor);
        const b = ids.indexOf(id);
        for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  };

  const groups = useMemo(() => {
    if (!prefs.split) return [{ label: "", units: all }];
    const map = new Map<string, Unit[]>();
    for (const u of all) {
      const k = dayLabel(u.g.createdAt);
      map.set(k, [...(map.get(k) ?? []), u]);
    }
    return [...map.entries()].map(([label, us]) => ({ label, units: us }));
  }, [all, prefs.split]);

  const layoutCls = prefs.layout === "square" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" : prefs.layout === "masonry" ? "columns-2 gap-3 sm:columns-3 lg:columns-4 2xl:columns-5" : "space-y-2";
  const del = async (list: string[]) => {
    await actions.remove(list);
    setSelected(new Set());
    toast(list.length > 1 ? `${list.length} takes deleted` : "Deleted", { duration: 1500 });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">{title}</div>
        {toolbarExtra}
        <div className="inline-flex h-8 rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Layout">
          {(
            [
              ["square", LayoutGrid, "Square"],
              ["masonry", Rows3, "Masonry"],
              ["list", List, "List"],
            ] as const
          ).map(([id, Icon, label]) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={prefs.layout === id}
                  aria-label={label}
                  onClick={() => setPrefs({ layout: id })}
                  className={cn("grid w-8 place-items-center rounded-full", prefs.layout === id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-pressed={prefs.split} onClick={() => setPrefs({ split: !prefs.split })} className={cn("grid size-8 place-items-center rounded-full", prefs.split ? "bg-brand-faint text-brand-text" : "bg-secondary hover:bg-accent")} aria-label="Split by date">
              <CalendarDays className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Split by date</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-pressed={prefs.fit} onClick={() => setPrefs({ fit: !prefs.fit })} className={cn("inline-flex h-8 items-center rounded-full px-2.5 text-[12px] font-medium", prefs.fit ? "bg-brand-faint text-brand-text" : "bg-secondary hover:bg-accent")} aria-label={prefs.fit ? "Fit previews" : "Fill previews"}>
              <Grid3x3 className="mr-1 size-3.5" />
              {prefs.fit ? "Fit" : "Fill"}
            </button>
          </TooltipTrigger>
          <TooltipContent>{prefs.fit ? "Fit previews (whole frame)" : "Fill previews (cropped)"}</TooltipContent>
        </Tooltip>
        <FilterChips prefs={prefs} setPrefs={setPrefs} nested={nested} onNested={onNested} />
      </div>

      {selecting && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-1.5 rounded-full border bg-background/95 py-1 pr-1 pl-3 shadow-strong backdrop-blur animate-pop-in">
          <span className="text-[13px] font-medium">{live.length} selected</span>
          <button type="button" onClick={() => setSelected(new Set())} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" /> Unselect all <kbd className="ml-0.5 font-mono text-[10px]">Esc</kbd>
          </button>
          <span className="flex-1" />
          <button type="button" onClick={() => void actions.favorite(live, !items.filter((g) => live.includes(g.id)).every((g) => g.favorite))} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium hover:bg-accent">
            <Heart className="size-3.5" /> {items.filter((g) => live.includes(g.id)).every((g) => g.favorite) ? "Unlike" : "Like"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium hover:bg-accent">
                <FolderInput className="size-3.5" /> Move to
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <MoveToItems
                folders={folders}
                onMove={(f) =>
                  void actions.move(live, f).then(() => {
                    toast(`Moved ${live.length} take${live.length > 1 ? "s" : ""}`, { duration: 1500 });
                    setSelected(new Set());
                  })
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={() => setConfirm(live)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/10">
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}

      {!all.length ? (
        items.length ? (
          <p className="py-16 text-center text-[13px] text-muted-foreground">Nothing matches these filters.</p>
        ) : (
          empty
        )
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => (
            <section key={grp.label || "all"} className="space-y-2.5">
              {grp.label && (
                <h3 className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
                  {grp.label}
                  <span className="font-mono text-[11px] text-subtle-foreground">{grp.units.length}</span>
                </h3>
              )}
              <div className={layoutCls}>
                {grp.units.map((u) => (
                  <TileView
                    key={u.key}
                    u={u}
                    layout={prefs.layout}
                    fit={prefs.fit}
                    selected={selected.has(u.g.id)}
                    selecting={selecting}
                    onToggle={(shift) => toggle(u.g.id, shift)}
                    onOpen={() => setOpen(u.key)}
                    projectId={projectId}
                    folders={folders}
                    handlers={handlers}
                    onDelete={(list) => setConfirm(list)}
                    dragIds={() => (selected.has(u.g.id) ? live : [u.g.id])}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {pos >= 0 && (
        <Viewer
          generation={{ ...viewable[pos].g, outputs: [viewable[pos].output!] }}
          index={0}
          onClose={() => {
            setOpen(null);
            // The viewer likes and deletes through /api/generations: pick those changes up.
            void qc.invalidateQueries({ queryKey: ["cinema", projectId, "items"] });
          }}
          onPrev={pos > 0 ? () => setOpen(viewable[pos - 1].key) : undefined}
          onNext={pos < viewable.length - 1 ? () => setOpen(viewable[pos + 1].key) : undefined}
          onReuse={(g) => handlers.onLoad(g as CinemaGeneration)}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm && confirm.length > 1 ? `Delete ${confirm.length} takes?` : "Delete this take?"}</AlertDialogTitle>
            <AlertDialogDescription>They&apos;ll be removed from this project and your library, and can&apos;t be recovered.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm) void del(confirm);
                setConfirm(null);
              }}
            >
              <Check /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
