"use client";

import { ArchiveRestore, CheckSquare, ChevronUp, Download, FolderInput, Heart, Loader2, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AssetCard, cardRatio, type CardApi } from "@/components/library/asset-card";
import { FilterBar, filterFields, hasFilters, NO_FILTERS, type Filters } from "@/components/library/filters";
import { FolderDialog, FolderHeader, FolderStrip, MoveMenuItems } from "@/components/library/folders";
import { useViewPrefs, ViewOptions, type ViewPrefs } from "@/components/library/view-options";
import { PageShell } from "@/components/page-shell";
import { downloadUrl } from "@/components/studio/result-actions";
import { Viewer } from "@/components/studio/viewer";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateGeneration, useFolders, useGenerationActions, useLibrary, useLibraryFacets, useUploads, type Asset, type FeedFilter } from "@/lib/api";
import type { Generation, MediaKind } from "@/lib/catalog/types";
import { buildEntries, splitByDate, TRASH_DAYS, type LibraryEntry } from "@/lib/library";
import { isLayered } from "@/lib/output-actions";
import { cn } from "@/lib/utils";

type TabId = "all" | "images" | "videos" | "audio" | "text" | "3d" | "favorites" | "uploads" | "trash";

const TABS: { id: TabId; label: string; kinds?: MediaKind[] }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images", kinds: ["image"] },
  { id: "videos", label: "Videos", kinds: ["video"] },
  { id: "audio", label: "Audio", kinds: ["audio"] },
  { id: "text", label: "Text", kinds: ["text"] },
  { id: "3d", label: "3D", kinds: ["model3d"] },
  { id: "favorites", label: "Favorites" },
  { id: "uploads", label: "Uploads" },
  { id: "trash", label: "Trash" },
];

const singles = new WeakMap<Generation, LibraryEntry>();
/** A stack member as its own card entry (cached per object so memoized cards stay put). */
function singleEntry(g: Generation): LibraryEntry {
  let e = singles.get(g);
  if (!e) singles.set(g, (e = { type: "single", key: g.id, g }));
  return e;
}

const ids = (e: LibraryEntry) => (e.type === "single" ? [e.g.id] : e.items.map((g) => g.id));
const members = (e: LibraryEntry) => (e.type === "single" ? [e.g] : e.items);

/** Keep entry objects whose content didn't change, so memoized cards skip re-rendering on polls. */
function useStableEntries(next: LibraryEntry[]): LibraryEntry[] {
  // "Storing information from previous renders": recompute only when the list itself changes.
  const [state, setState] = useState<{ next: LibraryEntry[] | null; out: LibraryEntry[]; map: Map<string, LibraryEntry> }>({ next: null, out: [], map: new Map() });
  if (state.next === next) return state.out;
  const out = stabilize(state.map, next);
  setState({ next, out: out.list, map: out.map });
  return out.list;
}

function stabilize(prev: Map<string, LibraryEntry>, next: LibraryEntry[]): { list: LibraryEntry[]; map: Map<string, LibraryEntry> } {
  {
    const map = new Map<string, LibraryEntry>();
    const out = next.map((e) => {
      const p = prev.get(e.key);
      const same =
        p &&
        p.type === e.type &&
        (e.type === "single"
          ? (p as typeof e).g === e.g
          : (p as typeof e).title === e.title && (p as typeof e).label === e.label && (p as typeof e).items.length === e.items.length && (p as typeof e).items.every((g, i) => g === e.items[i]));
      const keep = same ? p : e;
      map.set(e.key, keep);
      return keep;
    });
    return { list: out, map };
  }
}

/** An upload, shaped like a finished generation so the cards and the viewer can show it. */
function uploadAsGeneration(a: Asset): Generation {
  return {
    id: a.id,
    batchId: null,
    feature: "upload",
    presetId: null,
    modelId: "upload",
    modelName: "Your upload",
    engine: "open",
    provider: "local",
    op: a.kind === "video" ? "v2v" : "edit",
    kind: a.kind,
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: null,
    request: { feature: "upload", modelId: "upload", prompt: a.name ?? "Upload" },
    outputs: [{ url: a.url, kind: a.kind, contentType: a.contentType, assetId: a.id }],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    completedAt: a.createdAt,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-brand-faint px-6 py-12 text-center">
      <p className="font-heading text-[22px]">{title}</p>
      {children && <div className="mt-1 text-[14px] text-muted-foreground">{children}</div>}
    </div>
  );
}

const GAP = 8;

/**
 * Masonry that keeps reading order left to right: each card goes into the shortest column, by the
 * aspect ratios we already know (CSS columns would fill top to bottom, scattering the newest).
 */
function Masonry({ entries, size, render }: { entries: LibraryEntry[]; size: number; render: (e: LibraryEntry) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = width ? Math.max(width < 640 ? 2 : 1, Math.floor((width + GAP) / (size + GAP))) : 4;
  const columns = useMemo(() => {
    const heights = Array.from({ length: cols }, () => 0);
    const out = Array.from({ length: cols }, () => [] as LibraryEntry[]);
    for (const e of entries) {
      const k = heights.indexOf(Math.min(...heights));
      out[k].push(e);
      heights[k] += 1 / cardRatio(e, "masonry") + 0.04;
    }
    return out;
  }, [entries, cols]);
  return (
    <div ref={ref} className="flex items-start gap-2">
      {columns.map((c, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-2">
          {c.map(render)}
        </div>
      ))}
    </div>
  );
}

/** One section's cards in the chosen layout; an expanded stack opens as a full-width panel after its card. */
function Cards({ entries, prefs, expanded, render, panel }: { entries: LibraryEntry[]; prefs: ViewPrefs; expanded: Set<string>; render: (e: LibraryEntry) => React.ReactNode; panel: (e: LibraryEntry) => React.ReactNode }) {
  if (prefs.layout === "list") return <div className="flex flex-col gap-0.5">{entries.flatMap((e) => (expanded.has(e.key) ? [render(e), panel(e)] : [render(e)]))}</div>;
  if (prefs.layout === "square") {
    const style = { "--card": `min(${prefs.size}px, calc(50vw - 22px))` } as React.CSSProperties;
    return (
      <div style={style} className="grid grid-cols-[repeat(auto-fill,minmax(var(--card),1fr))] gap-2">
        {entries.flatMap((e) => (expanded.has(e.key) ? [render(e), panel(e)] : [render(e)]))}
      </div>
    );
  }
  // Masonry: split at expanded stacks so their panels span the full width.
  const runs: LibraryEntry[][] = [[]];
  const panels: LibraryEntry[] = [];
  for (const e of entries) {
    runs.at(-1)!.push(e);
    if (expanded.has(e.key)) {
      panels.push(e);
      runs.push([]);
    }
  }
  return (
    <div className="space-y-2">
      {runs.map((run, i) => (
        <div key={i} className="space-y-2">
          {run.length > 0 && <Masonry entries={run} size={prefs.size} render={render} />}
          {panels[i] && panel(panels[i])}
        </div>
      ))}
    </div>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.find((t) => t.id === sp.get("tab")) ?? TABS[0];
  const folderId = sp.get("folder") ?? undefined;
  const trash = tab.id === "trash";
  const uploadsTab = tab.id === "uploads";
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [prefs, setPrefs] = useViewPrefs();
  const facets = useLibraryFacets();
  const folders = useFolders();
  const folder = folderId ? folders.data?.find((f) => f.id === folderId) : undefined;
  const actions = useGenerationActions();
  const create = useCreateGeneration();

  const filter = useMemo<FeedFilter>(
    () => ({
      ...(tab.kinds && { kinds: tab.kinds }),
      ...(tab.id === "favorites" && { favorites: true }),
      ...(trash && { trashed: true }),
      ...(folderId && !trash && { folderId }),
      ...(dq && { q: dq }),
      ...filterFields(filters),
    }),
    [tab, trash, folderId, dq, filters],
  );
  const lib = useLibrary(filter);
  const uploads = useUploads();
  const items = useMemo(() => (uploadsTab ? (uploads.data ?? []).map(uploadAsGeneration) : (lib.data?.pages.flat() ?? [])), [uploadsTab, uploads.data, lib.data]);
  const built = useMemo(() => buildEntries(items, { stacks: prefs.stacks && !trash && !uploadsTab }), [items, prefs.stacks, trash, uploadsTab]);
  const entries = useStableEntries(built);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sections = useMemo(() => {
    const when = (e: LibraryEntry) => Math.max(...members(e).map((g) => (trash ? (g.deletedAt ?? g.createdAt) : g.createdAt)));
    return prefs.splitByDate ? splitByDate(entries, when) : [{ key: 0, label: "", items: entries }];
  }, [entries, prefs.splitByDate, trash]);

  // --- Selection ---------------------------------------------------------------------------
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const order = useMemo(() => sections.flatMap((s) => s.items.flatMap((e) => [e, ...(e.type === "stack" && expanded.has(e.key) ? e.items.map((g) => ({ type: "single" as const, key: g.id, g })) : [])])), [sections, expanded]);
  const latest = useRef({ order, selected, items });
  useEffect(() => {
    latest.current = { order, selected, items };
  });
  const lastKey = useRef<string | null>(null);
  const clear = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
  }, []);
  // A new tab or folder starts a new selection.
  const scope = `${tab.id}/${folderId ?? ""}`;
  const [lastScope, setLastScope] = useState(scope);
  if (lastScope !== scope) {
    setLastScope(scope);
    setSelected(new Set());
    setSelecting(false);
  }

  const selectedGens = useMemo(() => items.filter((g) => selected.has(g.id)), [items, selected]);

  // --- Viewer --------------------------------------------------------------------------------
  const [open, setOpen] = useState<{ id: string; index: number } | null>(null);
  const flat = useMemo(
    () => order.flatMap((e) => members(e)).filter((g, i, all) => g.status === "succeeded" && g.outputs.length && all.findIndex((x) => x.id === g.id) === i).flatMap((g) => (isLayered(g) ? [{ g, i: 0 }] : g.outputs.map((_, i) => ({ g, i })))),
    [order],
  );
  const pos = open ? flat.findIndex((f) => f.g.id === open.id && (f.i === open.index || isLayered(f.g))) : -1;

  const api = useMemo<CardApi>(
    () => ({
      open: (g, index) => setOpen({ id: g.id, index }),
      expand: (key) =>
        setExpanded((s) => {
          const n = new Set(s);
          if (n.has(key)) n.delete(key);
          else n.add(key);
          return n;
        }),
      toggle: (key, list, shift) => {
        setSelecting(true);
        const { order, selected } = latest.current;
        const next = new Set(selected);
        if (shift && lastKey.current) {
          const a = order.findIndex((e) => e.key === lastKey.current);
          const b = order.findIndex((e) => e.key === key);
          if (a >= 0 && b >= 0) {
            for (const e of order.slice(Math.min(a, b), Math.max(a, b) + 1)) ids(e).forEach((id) => next.add(id));
            lastKey.current = key;
            setSelected(next);
            return;
          }
        }
        const all = list.every((id) => next.has(id));
        list.forEach((id) => (all ? next.delete(id) : next.add(id)));
        lastKey.current = key;
        setSelected(next);
      },
      dragIds: (list) => {
        const { selected } = latest.current;
        return list.every((id) => selected.has(id)) ? [...selected] : list;
      },
      retry: (g) => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) }),
      runner: { onOpen: (g, index) => setOpen({ id: g.id, index }) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable],[role=dialog],[role=menu]")) return;
      if (e.key === "Escape" && (selecting || latest.current.selected.size)) {
        e.preventDefault();
        clear();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && selecting) {
        e.preventDefault();
        setSelected(new Set(latest.current.items.map((g) => g.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clear]);

  // --- Paging ---------------------------------------------------------------------------------
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = lib;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || uploadsTab) return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && !isFetchingNextPage && void fetchNextPage(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, uploadsTab]);

  const go = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    window.scrollTo({ top: 0 });
  };

  const moveTo = async (list: string[], folderIdTo: string | null, name: string) => {
    const gens = list.map((id) => latest.current.items.find((g) => g.id === id)).filter((g): g is Generation => !!g);
    if (!gens.length) return;
    const n = await actions.move(gens, folderIdTo);
    if (n) toast.success(folderIdTo ? `Moved ${n} to “${name}”` : `Took ${n} out of the folder`);
    clear();
  };

  const [newFolderFor, setNewFolderFor] = useState<string[] | null>(null);
  const [confirmForever, setConfirmForever] = useState<Generation[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const loading = uploadsTab ? uploads.isLoading : lib.isLoading;
  const refreshing = !uploadsTab && lib.isPlaceholderData;
  const count = (t: (typeof TABS)[number]) => {
    const f = facets.data;
    if (!f) return undefined;
    if (t.id === "trash") return f.trash || undefined;
    if (t.id === "favorites") return f.favorites || undefined;
    if (t.kinds) return f.kinds[t.kinds[0]] || undefined;
    return undefined;
  };
  const visibleTabs = TABS.filter((t) => !t.kinds || t.id === "images" || t.id === "videos" || t.id === "audio" || (facets.data?.kinds[t.kinds[0]] ?? 0) > 0 || tab.id === t.id);
  const allFav = selectedGens.length > 0 && selectedGens.every((g) => g.favorite);

  const empty = () => {
    if (dq) {
      return (
        <Empty title={`No matches for “${dq}”`}>
          Try another word.{" "}
          <button onClick={() => setQ("")} className="text-brand-text hover:underline">
            Clear search
          </button>
        </Empty>
      );
    }
    if (hasFilters(filters)) {
      return (
        <Empty title="Nothing matches your filters">
          <button onClick={() => setFilters(NO_FILTERS)} className="text-brand-text hover:underline">
            Clear filters
          </button>
        </Empty>
      );
    }
    if (trash) return <Empty title="Trash is empty">Generations you delete stay here for {TRASH_DAYS} days, then go for good.</Empty>;
    if (folder) return <Empty title="This folder is empty">Drag cards onto it, or select some and choose Move to folder.</Empty>;
    if (tab.id === "favorites") return <Empty title="Nothing liked yet">Mark the ones you like with the heart to keep them here.</Empty>;
    if (uploadsTab) return <Empty title="No uploads yet">Files you add to a studio show up here.</Empty>;
    return (
      <Empty title="Your creations will appear here">
        Generate something and it lands here.{" "}
        <Link href="/image" className="text-brand-text hover:underline">
          Create an image
        </Link>
      </Empty>
    );
  };

  return (
    <PageShell wide>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-5">
        {folder ? (
          <FolderHeader folder={folder} onBack={() => go({ folder: undefined })} onMoveOut={(list) => void moveTo(list, null, "Library")} />
        ) : (
          <div className="min-w-0">
            <h1 className="font-heading text-[34px] leading-tight">Library</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">Everything you make, across cloud and open-source runs.</p>
          </div>
        )}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
              placeholder="Search prompts"
              aria-label="Search prompts"
              className="h-8 w-full rounded-full border bg-background pr-8 pl-8 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-brand-faint"
            />
            {refreshing || (q.trim() !== dq && q.trim()) ? (
              <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : q ? (
              <button onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          {!uploadsTab && (
            <button
              onClick={() => (selecting ? clear() : setSelecting(true))}
              aria-pressed={selecting}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                selecting ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
              )}
            >
              <CheckSquare className="size-3.5" /> <span className="hidden sm:inline">{selecting ? "Done" : "Select"}</span>
            </button>
          )}
          <ViewOptions prefs={prefs} onChange={setPrefs} />
        </div>
      </div>

      {!folder && (
        <div className="scrollbar-none mb-4 flex gap-4 overflow-x-auto border-b">
          {visibleTabs.map((t) => {
            const n = count(t);
            return (
              <button
                key={t.id}
                onClick={() => go({ tab: t.id === "all" ? undefined : t.id, folder: undefined })}
                className={cn(
                  "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-1 pb-2 text-[14px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  tab.id === t.id && "border-foreground font-medium text-foreground",
                )}
              >
                {t.label}
                {n ? <span className="font-mono text-[11px] text-muted-foreground">{n}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {tab.id === "all" && !folder && (folders.data?.length || !loading) ? (
        <div className="mb-4">
          <FolderStrip folders={folders.data ?? []} onOpen={(f) => go({ folder: f.id })} onMove={(list, f) => void moveTo(list, f.id, f.name)} />
        </div>
      ) : null}

      {!uploadsTab && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <FilterBar value={filters} onChange={setFilters} facets={facets.data} />
          {trash && (
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span>Items stay here for {TRASH_DAYS} days.</span>
              {items.length > 0 && (
                <button onClick={() => setConfirmEmpty(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-destructive hover:bg-accent">
                  <Trash2 className="size-3.5" /> Empty trash
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {loading && !items.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,calc(50vw-22px)),1fr))] gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : !items.length ? (
        empty()
      ) : (
        <div className={cn("space-y-7 transition-opacity", refreshing && "opacity-70")}>
          {sections.map((s) => (
            <section key={s.key} aria-label={s.label || "Results"}>
              {s.label && (
                <h2 className="mb-2.5 flex items-baseline gap-2 text-[13px] font-medium">
                  {s.label} <span className="font-mono text-[11px] font-normal text-muted-foreground">{s.items.reduce((n, e) => n + members(e).length, 0)}</span>
                </h2>
              )}
              <Cards
                entries={s.items}
                prefs={prefs}
                expanded={expanded}
                render={(e) => (
                  <AssetCard key={e.key} entry={e} layout={prefs.layout} fit={prefs.fit} selecting={selecting} selected={ids(e).every((id) => selected.has(id))} expanded={expanded.has(e.key)} api={api} />
                )}
                panel={(e) =>
                  e.type === "stack" && (
                    <div key={`${e.key}:open`} className={cn("rounded-2xl border bg-card p-3", prefs.layout === "square" && "col-span-full", prefs.layout === "list" && "my-1")}>
                      <div className="mb-2.5 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-heading text-[19px] leading-snug">{e.title}</p>
                          <p className="text-[12px] text-muted-foreground">{e.label}</p>
                        </div>
                        <button onClick={() => api.expand(e.key)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
                          <ChevronUp className="size-4" /> Collapse
                        </button>
                      </div>
                      <div className={cn(prefs.layout === "list" ? "flex flex-col gap-0.5" : "grid grid-cols-[repeat(auto-fill,minmax(min(170px,calc(50vw-40px)),1fr))] gap-2")}>
                        {e.items.map((g) => (
                          <AssetCard
                            key={g.id}
                            entry={singleEntry(g)}
                            layout={prefs.layout === "list" ? "list" : "square"}
                            fit={prefs.fit}
                            selecting={selecting}
                            selected={selected.has(g.id)}
                            api={api}
                          />
                        ))}
                      </div>
                    </div>
                  )
                }
              />
            </section>
          ))}
          <div ref={sentinel} className="flex flex-col items-center gap-2 py-4">
            {!uploadsTab && hasNextPage ? (
              <button
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-[13px] font-medium hover:bg-accent disabled:opacity-60"
              >
                {isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />} Load more
              </button>
            ) : (
              <p className="text-[12px] text-subtle-foreground">{items.length > 12 ? "That's everything" : ""}</p>
            )}
          </div>
        </div>
      )}

      {(selecting || selected.size > 0) && !uploadsTab && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pl-[var(--sidebar-width,0px)]">
          <div role="toolbar" aria-label="Selection" className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border bg-background p-1.5 shadow-strong">
            <span className="shrink-0 px-2.5 text-[13px] font-medium whitespace-nowrap">{selected.size ? `${selected.size} selected` : "Select items"}</span>
            {trash ? (
              <>
                <BarButton icon={ArchiveRestore} label="Restore" disabled={!selected.size} onClick={() => void actions.restore(selectedGens).then((n) => (n && toast(`Restored ${n}`), clear()))} />
                <BarButton icon={Trash2} label="Delete forever" destructive disabled={!selected.size} onClick={() => setConfirmForever(selectedGens)} />
              </>
            ) : (
              <>
                <BarButton
                  icon={Download}
                  label="Download"
                  disabled={!selectedGens.some((g) => g.status === "succeeded")}
                  onClick={() => downloadUrl(`/api/generations/zip?ids=${[...selected].slice(0, 500).join(",")}`)}
                />
                <BarButton icon={Heart} label={allFav ? "Unlike" : "Like"} disabled={!selected.size} onClick={() => void actions.favoriteMany(selectedGens, !allFav)} />
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild disabled={!selected.size}>
                    <button className={BAR} disabled={!selected.size}>
                      <FolderInput className="size-4" /> <span className="hidden sm:inline">Move to</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="center" collisionPadding={12}>
                    <MoveMenuItems folders={folders.data ?? []} current={folderId} onMove={(fid, name) => void moveTo([...selected], fid, name)} onNew={() => setNewFolderFor([...selected])} />
                  </DropdownMenuContent>
                </DropdownMenu>
                <BarButton
                  icon={Trash2}
                  label="Delete"
                  destructive
                  disabled={!selected.size}
                  onClick={() => {
                    void actions.trash(selectedGens);
                    clear();
                  }}
                />
              </>
            )}
            <span className="mx-1 h-5 w-px shrink-0 bg-border" />
            <button onClick={clear} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Unselect all">
              <X className="size-3.5" /> <span className="hidden sm:inline">Unselect all</span> <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </button>
          </div>
        </div>
      )}

      {newFolderFor && (
        <FolderDialog
          open
          onOpenChange={(v) => !v && setNewFolderFor(null)}
          onSaved={(f) => {
            void moveTo(newFolderFor, f.id, f.name);
            setNewFolderFor(null);
          }}
        />
      )}

      <AlertDialog open={!!confirmForever} onOpenChange={(v) => !v && setConfirmForever(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmForever?.length === 1 ? "this for good" : `${confirmForever?.length} items for good`}?</AlertDialogTitle>
            <AlertDialogDescription>They&apos;ll be removed with their files and can&apos;t be recovered.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmForever) void actions.deleteForever(confirmForever).then((n) => n && toast(`Deleted ${n} for good`));
                clear();
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the Trash?</AlertDialogTitle>
            <AlertDialogDescription>Everything in it, including what your filters hide, is deleted with its files and can&apos;t be recovered.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void actions.emptyTrash().then(() => toast("Trash emptied"));
              }}
            >
              Empty trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open && pos >= 0 && (
        <Viewer
          generation={flat[pos].g}
          index={isLayered(flat[pos].g) ? open.index : flat[pos].i}
          onIndex={(index) => setOpen({ id: flat[pos].g.id, index })}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen({ id: flat[pos - 1].g.id, index: flat[pos - 1].i }) : undefined}
          onNext={pos < flat.length - 1 ? () => setOpen({ id: flat[pos + 1].g.id, index: flat[pos + 1].i }) : undefined}
        />
      )}
    </PageShell>
  );
}

const BAR = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

function BarButton({ icon: Icon, label, onClick, disabled, destructive }: { icon: typeof Download; label: string; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cn(BAR, destructive && "text-destructive")}>
      <Icon className="size-4" /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function LibraryView() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
