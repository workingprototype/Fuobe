"use client";

import { Cloud, Copy, Cpu, FolderDown, Heart, MoreHorizontal, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OPERATION_LABELS, type Generation } from "@/lib/catalog/types";
import { useCreateGeneration, useGenerationActions } from "@/lib/api";
import { elapsed, formatCost, ratioValue, timeAgo } from "@/lib/format";
import { userTitle } from "@/lib/library";
import { isLayered } from "@/lib/output-actions";
import { cn } from "@/lib/utils";
import { TileActions, useCanHover, type RunnerOptions } from "./result-actions";
import { LayersStack, MediaThumb } from "./result-media";
import { Viewer } from "./viewer";

export { MediaThumb } from "./result-media";
export { downloadName } from "@/lib/library";

/** A result's tile shape: its aspect ratio (the request's or the model's default, from the server). */
export function tileRatio(g: Generation): number {
  if (g.kind === "audio") return 1.6;
  if (g.kind === "text") return 0.85;
  const ar = g.request.params?.aspectRatio ?? g.aspectRatio ?? undefined;
  return ratioValue(ar && ar !== "auto" ? ar : undefined, g.kind === "video" ? 16 / 9 : 1);
}

export function PendingTile({ g, ratio }: { g: Generation; ratio: number }) {
  const { cancel } = useGenerationActions();
  const pct = g.progress != null ? Math.round(g.progress * 100) : null;
  const label = g.status === "queued" ? (g.message ?? "Queued") : (g.message ?? "Generating…");
  return (
    <div className="relative h-full overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: ratio }}>
      <div className="skeleton-sweep absolute inset-0 animate-skeleton" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="shimmer-text animate-shimmer-text truncate text-[13px] font-medium">{label}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {pct != null ? `${pct}% · ` : ""}
            {elapsed(g.createdAt)}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void cancel(g);
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-background/70 text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Cancel</TooltipContent>
        </Tooltip>
      </div>
      {pct != null && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-transparent">
          <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function FailedTile({ g, ratio, onRetry }: { g: Generation; ratio: number; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-dashed bg-background p-3" style={{ aspectRatio: Math.max(ratio, 0.8) }}>
      <div className="min-h-0 space-y-1 overflow-hidden">
        <p className="text-[13px] font-medium">{g.status === "canceled" ? "Canceled" : "Couldn't generate this one"}</p>
        {g.error && <p className="line-clamp-5 text-[12px] leading-snug break-words whitespace-pre-line text-muted-foreground">{g.error}</p>}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
        className="mt-2 inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent"
      >
        <RotateCcw className="size-3" /> Retry
      </button>
    </div>
  );
}

/** Seedance draft mode: render the chosen 480p take again at 1080p with the same seed and settings. */
export function useFinalizeDraft() {
  const create = useCreateGeneration();
  return (g: Generation, draftId: string) =>
    create.mutate(
      { feature: g.feature, modelId: g.modelId, op: "finalize", prompt: g.request.prompt, params: { draftId, resolution: "1080p", duration: g.request.params?.duration } },
      { onSuccess: () => toast.success("Rendering the final 1080p version"), onError: (e) => toast.error((e as Error).message) },
    );
}

// ---------------------------------------------------------------------------
// Feed: one stable context for every group, so a poll or a keystroke re-renders only what changed.

interface FeedApi {
  open: (g: Generation, index: number) => void;
  retry: (g: Generation) => void;
  runner: RunnerOptions;
  reuse?: (g: Generation) => void;
}

const FeedCtx = createContext<FeedApi | null>(null);

function useFeed(): FeedApi {
  const c = useContext(FeedCtx);
  if (!c) throw new Error("GenerationGroup outside Feed");
  return c;
}

function DraftButton({ g, draftId }: { g: Generation; draftId: string }) {
  const finalize = useFinalizeDraft();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        finalize(g, draftId);
      }}
      className="absolute top-2 left-2 inline-flex h-7 items-center gap-1 rounded-full bg-black/55 pr-2.5 pl-2 text-[12px] font-medium text-white backdrop-blur transition-colors hover:bg-black/75"
    >
      <Sparkles className="size-3.5" /> Draft · render 1080p
    </button>
  );
}

const OutputTile = memo(function OutputTile({ g, index, ratio, layered }: { g: Generation; index: number; ratio: number; layered?: boolean }) {
  const feed = useFeed();
  const canHover = useCanHover();
  // Actions mount on first hover / focus / tap: a long feed shouldn't hold thousands of menus and tooltips.
  const [hot, setHot] = useState<false | "bar" | "menu">(false);
  const o = g.outputs[index];
  const ctx = useMemo(() => ({ reuse: !!feed.reuse }), [feed.reuse]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${o.kind === "text" ? "text" : o.kind}${g.outputs.length > 1 && !layered ? ` ${index + 1} of ${g.outputs.length}` : ""}`}
      onClick={() => feed.open(g, index)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          feed.open(g, index);
        }
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && !hot && setHot("bar")}
      onFocus={() => canHover && !hot && setHot("bar")}
      className="group/tile relative h-56 max-w-full animate-fade-up cursor-zoom-in overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-64"
      style={{ aspectRatio: o.kind === "audio" ? 1.6 : layered ? Math.max(ratio, 0.8) : ratio }}
    >
      {layered ? <LayersStack g={g} /> : <MediaThumb output={o} g={g} />}
      {o.draftId && <DraftButton g={g} draftId={o.draftId} />}
      {g.favorite && <Heart className="absolute top-2 right-2 size-4 fill-highlight text-highlight drop-shadow" />}
      {o.kind !== "audio" && canHover && hot === "bar" && (
        <TileActions
          g={g}
          index={index}
          ctx={ctx}
          opts={feed.runner}
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8 opacity-0 transition-opacity duration-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100"
        />
      )}
      {!canHover &&
        (hot === "menu" ? (
          <TileActions g={g} index={index} ctx={ctx} opts={feed.runner} menuOnly className={cn("absolute right-2", g.favorite ? "top-8" : "top-2")} />
        ) : (
          <button
            aria-label="More actions"
            onClick={(e) => {
              e.stopPropagation();
              setHot("menu");
            }}
            className={cn("absolute right-2 grid size-8 place-items-center rounded-lg bg-black/45 text-white backdrop-blur", g.favorite ? "top-8" : "top-2")}
          >
            <MoreHorizontal className="size-4" />
          </button>
        ))}
    </div>
  );
});

/** One request: the user's words in serif, a meta line, then its outputs (or progress / failure). */
export const GenerationGroup = memo(function GenerationGroup({ g }: { g: Generation }) {
  const feed = useFeed();
  const { favorite, trash } = useGenerationActions();
  const ratio = tileRatio(g);
  const active = g.status === "queued" || g.status === "running";
  const placeholders = Math.max(1, g.request.params?.numOutputs ?? 1);
  const layered = g.status === "succeeded" && isLayered(g);
  const p = g.request.params ?? {};
  const meta = [
    g.request.step?.label,
    g.presetName,
    g.modelName ?? g.modelId,
    OPERATION_LABELS[g.op],
    p.aspectRatio,
    p.resolution,
    p.duration ? `${p.duration >= 1000 ? p.duration / 1000 : p.duration}s` : undefined,
  ].filter(Boolean);

  return (
    <section data-gen-id={g.id} className="group/gen animate-fade-up space-y-2.5 [contain-intrinsic-size:auto_330px] [content-visibility:auto]">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-heading text-[19px] leading-snug" title={g.prompt ?? undefined}>
            {userTitle(g)}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {g.engine === "open" ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
              {g.provider === "mock" ? "Demo" : g.provider === "local" ? "Browser" : g.engine === "open" ? "Open source" : "Cloud"}
            </span>
            {meta.map((m, i) => (
              <span key={i} className="before:mr-1.5 before:content-['·']">
                {m}
              </span>
            ))}
            <span className="before:mr-1.5 before:content-['·']">{timeAgo(g.createdAt)}</span>
            {g.costUsd ? <span className="font-mono before:mr-1.5 before:content-['·']">{formatCost(g.costUsd)}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/gen:opacity-100 sm:focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {feed.reuse && (
            <button
              onClick={() => feed.reuse?.(g)}
              title="Load prompt, model and settings into the composer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" /> Reuse
            </button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="More">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(g.prompt ?? "");
                  toast("Prompt copied");
                }}
              >
                <Copy /> Copy prompt
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => feed.retry(g)}>
                <RotateCcw /> Run again
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void favorite(g)}>
                <Heart /> {g.favorite ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
              {g.status === "succeeded" && g.outputs.length > 1 && (
                <DropdownMenuItem asChild>
                  <a href={`/api/generations/zip?ids=${g.id}`} download>
                    <FolderDown /> Download all ({g.outputs.length})
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void trash([g])}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        {active &&
          Array.from({ length: placeholders }, (_, i) => (
            <div key={i} className="h-56 max-w-full sm:h-64">
              <PendingTile g={g} ratio={ratio} />
            </div>
          ))}
        {(g.status === "failed" || g.status === "canceled") && (
          <div className="h-56 max-w-full sm:h-64">
            <FailedTile g={g} ratio={ratio} onRetry={() => feed.retry(g)} />
          </div>
        )}
        {g.status === "succeeded" &&
          (layered ? <OutputTile g={g} index={0} ratio={ratio} layered /> : g.outputs.map((o, i) => <OutputTile key={o.url} g={g} index={i} ratio={ratio} />))}
      </div>
    </section>
  );
});

export function Feed({
  items,
  onReuse,
  empty,
}: {
  items: Generation[];
  onReuse?: (g: Generation) => void;
  empty?: React.ReactNode;
}) {
  const [open, setOpen] = useState<{ id: string; index: number } | null>(null);
  const create = useCreateGeneration();
  // Groups get stable callbacks that read the latest props through refs.
  const createRef = useRef(create);
  const reuseRef = useRef(onReuse);
  useEffect(() => {
    createRef.current = create;
    reuseRef.current = onReuse;
  });
  const hasReuse = !!onReuse;
  const openAt = useCallback((g: Generation, index: number) => setOpen({ id: g.id, index }), []);
  const api = useMemo<FeedApi>(
    () => ({
      open: openAt,
      retry: (g) => createRef.current.mutate(g.request, { onError: (e) => toast.error((e as Error).message) }),
      reuse: hasReuse ? (g) => reuseRef.current?.(g) : undefined,
      runner: { onOpen: openAt, onReuse: hasReuse ? (g) => reuseRef.current?.(g) : undefined },
    }),
    [openAt, hasReuse],
  );
  if (!items.length) return <>{empty}</>;
  const flat = items.flatMap((g) => (g.status === "succeeded" ? (isLayered(g) ? [{ g, i: 0 }] : g.outputs.map((_, i) => ({ g, i }))) : []));
  const pos = open ? flat.findIndex((f) => f.g.id === open.id && (f.i === open.index || isLayered(f.g))) : -1;
  return (
    <FeedCtx.Provider value={api}>
      <div className="space-y-9">
        {items.map((g) => (
          <GenerationGroup key={g.id} g={g} />
        ))}
      </div>
      {open && pos >= 0 && (
        <Viewer
          generation={flat[pos].g}
          index={isLayered(flat[pos].g) ? open.index : flat[pos].i}
          onIndex={(index) => setOpen({ id: flat[pos].g.id, index })}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen({ id: flat[pos - 1].g.id, index: flat[pos - 1].i }) : undefined}
          onNext={pos < flat.length - 1 ? () => setOpen({ id: flat[pos + 1].g.id, index: flat[pos + 1].i }) : undefined}
          onReuse={onReuse}
        />
      )}
    </FeedCtx.Provider>
  );
}
