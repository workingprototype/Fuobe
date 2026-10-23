"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Clapperboard, Cpu, Film, KeyRound, LayoutGrid, Loader2, Plus, Server, Settings2, ShieldCheck, Sparkles, Wand2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, lazy, Suspense, useCallback, useContext, useDeferredValue, useEffect, useMemo, useState } from "react";
import { NAV } from "@/components/nav-items";
import { MediaThumb } from "@/components/studio/result-media";
import { CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Command as CommandPrimitive } from "cmdk";
import { useEngineMode, useGenerations } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { indexEntries, KIND_LABELS, rankPalette, type PaletteEntry, type PaletteIndex, type PaletteKind } from "@/lib/command-search";
import { useModKey } from "@/lib/keys";
import { userTitle } from "@/lib/library";
import { cn } from "@/lib/utils";

// The viewer is only needed once a recent creation is opened from the palette.
const Viewer = lazy(() => import("@/components/studio/viewer").then((m) => ({ default: m.Viewer })));

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}

const PaletteContext = createContext<PaletteState>({ open: false, setOpen: () => {} });

/** Opens and closes the ⌘K palette from anywhere in the app frame (the sidebar's Search row, the phone header, ⌘K). */
export const useCommandPalette = () => useContext(PaletteContext);

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** Settings sections the palette jumps to (ids in settings-form.tsx). */
const SETTINGS: { id: string; label: string; icon: LucideIcon; keywords: string }[] = [
  { id: "cloud", label: "API keys", icon: KeyRound, keywords: "fal replicate higgsfield paid cloud connect" },
  { id: "comfyui", label: "ComfyUI server", icon: Server, keywords: "open source gpu url connect local" },
  { id: "engine", label: "Engine mode", icon: Cpu, keywords: "open source cloud both" },
  { id: "enhance", label: "Prompt enhancement", icon: Sparkles, keywords: "claude ollama enhancer llm" },
  { id: "notifications", label: "Notifications", icon: Bell, keywords: "browser done alerts" },
  { id: "security", label: "Password and API tokens", icon: ShieldCheck, keywords: "security sign in mcp token" },
  { id: "demo", label: "Demo mode", icon: Settings2, keywords: "placeholder free try" },
];

const PAGES: (PaletteEntry & { icon: LucideIcon })[] = NAV.flatMap((g) =>
  g.items.map((i) => ({ key: `page:${i.href}`, kind: "page" as const, label: i.label, hint: g.label, href: i.href, keywords: i.keywords, icon: i.icon })),
);
const SETTING_ENTRIES: (PaletteEntry & { icon: LucideIcon })[] = SETTINGS.map((s) => ({
  key: `setting:${s.id}`,
  kind: "setting",
  label: s.label,
  hint: "Settings",
  href: `/settings#${s.id}`,
  keywords: s.keywords,
  icon: s.icon,
}));
// Icons as elements made once (a component picked during render would remount on every keystroke).
const iconEl = (Icon: LucideIcon) => <Icon className="text-muted-foreground" />;
const ICONS = new Map<string, React.ReactNode>([...PAGES, ...SETTING_ENTRIES].map((e) => [e.key, iconEl(e.icon)]));
const KIND_ICONS: Partial<Record<PaletteKind, React.ReactNode>> = { app: iconEl(LayoutGrid), motion: iconEl(Film), effect: iconEl(Wand2), model: iconEl(Clapperboard) };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// The hints are marked as shortcuts so CommandItem drops its check mark, which would share the row's free space with them.
function Row({ entry, onPick }: { entry: PaletteEntry; onPick: (e: PaletteEntry) => void }) {
  return (
    <CommandItem value={entry.key} onSelect={() => onPick(entry)} className="h-9 gap-2.5 text-[14px]">
      {ICONS.get(entry.key) ?? KIND_ICONS[entry.kind] ?? KIND_ICONS.app}
      <span className="min-w-0 truncate">{entry.label}</span>
      {entry.hint && <span data-slot="command-shortcut" className="ml-auto shrink-0 truncate pl-2 text-[12px] text-muted-foreground max-sm:max-w-[40%]">{entry.hint}</span>}
    </CommandItem>
  );
}

function RecentRow({ g, onOpen }: { g: Generation; onOpen: (g: Generation) => void }) {
  const title = userTitle(g);
  return (
    <CommandItem value={`recent:${g.id}`} onSelect={() => onOpen(g)} className="h-11 gap-2.5 text-[14px]">
      <span className="relative size-8 shrink-0 overflow-hidden rounded-md bg-muted">{g.outputs[0] && <MediaThumb output={g.outputs[0]} g={g} />}</span>
      <span className="min-w-0 truncate">{title}</span>
      <span data-slot="command-shortcut" className="ml-auto shrink-0 pl-2 text-[12px] text-muted-foreground">{g.modelName}</span>
    </CommandItem>
  );
}

function Hints() {
  const mod = useModKey();
  return (
    <div className="flex items-center gap-3 border-t px-3 py-2 text-[12px] text-muted-foreground [@media(hover:none)]:hidden">
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> to move
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd> to open
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Esc</Kbd> to close
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </div>
  );
}

/** What the palette lists and searches; mounted only while it's open. */
function PaletteBody({ onPick, onOpenRecent }: { onPick: (e: PaletteEntry) => void; onOpenRecent: (g: Generation) => void }) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const dq = useDebounced(q.trim(), 200);
  const mode = useEngineMode();
  // The apps, motions, effects and models load on first open (and stay for the session).
  const index = useQuery({
    queryKey: ["palette-index"],
    queryFn: async () => (await fetch("/api/search-index")).json() as Promise<PaletteIndex>,
    staleTime: Infinity,
  });
  const recent = useGenerations({ q: dq || undefined, limit: 5, statuses: ["succeeded"] }, { keepPrevious: true });
  const entries = useMemo(() => [...PAGES, ...SETTING_ENTRIES, ...(index.data ? indexEntries(index.data, mode) : [])], [index.data, mode]);
  const groups = useMemo(() => rankPalette(entries, query), [entries, query]);
  const recentItems = (recent.data ?? []).filter((g) => g.outputs[0]);
  const searching = !!query.trim();
  // cmdk keeps no selection once the rows change (shouldFilter is off): every new query starts on its
  // best match, so Enter opens it; arrows move from there.
  const best = searching ? (groups[0]?.entries[0]?.key ?? (recentItems[0] ? `recent:${recentItems[0].id}` : "")) : "new";
  const [moved, setMoved] = useState<{ query: string; value: string } | null>(null);
  const selected = moved?.query === query ? moved.value : best;

  return (
    <CommandPrimitive shouldFilter={false} loop value={selected} onValueChange={(value) => setMoved({ query, value })} label="Search Fuobe" className="flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
      <div className="flex items-center gap-2 border-b px-3">
        <CommandPrimitive.Input
          value={q}
          onValueChange={setQ}
          autoFocus
          placeholder="Search pages, apps, motions, effects, models…"
          aria-label="Search Fuobe"
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
        />
        {index.isLoading && searching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading the catalog" />}
      </div>
      <CommandList className="max-h-[min(60vh,440px)] p-1.5">
        {searching ? (
          <>
            <CommandEmpty className="py-10 text-center text-[13px] text-muted-foreground">
              {index.isLoading ? "Looking through apps, motions and models…" : `Nothing matches “${query.trim()}”.`}
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.kind} heading={g.label}>
                {g.entries.map((e) => (
                  <Row key={e.key} entry={e} onPick={onPick} />
                ))}
              </CommandGroup>
            ))}
            {recentItems.length > 0 && (
              <CommandGroup heading={KIND_LABELS.recent}>
                {recentItems.map((g) => (
                  <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            <CommandGroup>
              {/* Enter on an empty query keeps what ⌘K always did: a new creation. */}
              <CommandItem value="new" onSelect={() => onPick({ key: "new", kind: "page", label: "New creation", href: "/" })} className="h-9 gap-2.5 text-[14px]">
                <Plus className="text-muted-foreground" />
                New creation
                <span data-slot="command-shortcut" className="ml-auto text-[12px] text-muted-foreground">Home</span>
              </CommandItem>
            </CommandGroup>
            {recentItems.length > 0 && (
              <CommandGroup heading={KIND_LABELS.recent}>
                {recentItems.map((g) => (
                  <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={KIND_LABELS.page}>
              {PAGES.map((e) => (
                <Row key={e.key} entry={e} onPick={onPick} />
              ))}
            </CommandGroup>
            <CommandGroup heading={KIND_LABELS.setting}>
              {SETTING_ENTRIES.map((e) => (
                <Row key={e.key} entry={e} onPick={onPick} />
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <Hints />
    </CommandPrimitive>
  );
}

/**
 * The ⌘K / Ctrl+K palette: every page, settings section, app, camera motion, effect and model, and
 * your recent creations, with a forgiving search (src/lib/command-search.ts). Rendered once, in the
 * app frame.
 */
export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const [viewing, setViewing] = useState<Generation | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const pick = useCallback(
    (e: PaletteEntry) => {
      setOpen(false);
      router.push(e.href);
    },
    [router, setOpen],
  );
  const openRecent = useCallback(
    (g: Generation) => {
      setOpen(false);
      setViewing(g);
    },
    [setOpen],
  );

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search Fuobe"
        description="Go to a page, an app, a camera motion, an effect, a model, a settings section or a recent creation."
        className={cn("top-[8vh] gap-0 p-0 sm:top-[14vh] sm:max-w-xl")}
      >
        <PaletteBody onPick={pick} onOpenRecent={openRecent} />
      </CommandDialog>
      {viewing && (
        <Suspense fallback={null}>
          <Viewer generation={viewing} index={0} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>
  );
}
