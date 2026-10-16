"use client";

import {
  AudioLines,
  Clapperboard,
  Copy,
  Download,
  Heart,
  ImagePlus,
  Mic2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Wand2,
  X,
  ZoomIn,
  Cpu,
  Cloud,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModel, getPreset } from "@/lib/catalog";
import { OPERATION_LABELS, type Generation, type OutputFile } from "@/lib/catalog/types";
import { useCreateGeneration, useGenerationActions } from "@/lib/api";
import { elapsed, formatCost, ratioValue, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Viewer } from "./viewer";

export function downloadName(g: Generation, o: OutputFile, i: number): string {
  const ext = o.url.split(".").pop()?.split("?")[0] ?? "bin";
  const base = (g.prompt ?? g.modelId).slice(0, 40).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "fuobe";
  return `${base}-${g.id.slice(0, 6)}${i ? `-${i + 1}` : ""}.${ext}`;
}

function IconAction({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) {
  const cls = "grid size-8 place-items-center rounded-lg text-white/90 transition-colors hover:bg-white/20 hover:text-white";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className={cls} aria-label={label} onClick={(e) => e.stopPropagation()}>
            {children}
          </Link>
        ) : (
          <button
            className={cls}
            aria-label={label}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MediaThumb({ output, className, autoPlay }: { output: OutputFile; className?: string; autoPlay?: boolean }) {
  if (output.kind === "video") {
    return (
      <video
        src={`${output.url}#t=0.1`}
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
        onMouseLeave={(e) => {
          if (!autoPlay) e.currentTarget.pause();
        }}
        className={cn("size-full object-cover", className)}
      />
    );
  }
  if (output.kind === "audio") {
    return (
      <div className={cn("flex size-full flex-col items-center justify-center gap-3 bg-brand-faint p-4 text-brand-text", className)}>
        <AudioLines className="size-8" />
        <audio src={output.url} controls className="w-full" onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={output.url} alt="" loading="lazy" className={cn("size-full object-cover", className)} />;
}

function tileRatio(g: Generation): number {
  const ar = g.request.params?.aspectRatio ?? getModel(g.modelId)?.defaults?.aspectRatio;
  if (g.kind === "audio") return 1.6;
  return ratioValue(ar && ar !== "auto" ? ar : undefined, g.kind === "video" ? 16 / 9 : 1);
}

function PendingTile({ g, ratio }: { g: Generation; ratio: number }) {
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
            <button onClick={() => void cancel(g)} className="grid size-7 shrink-0 place-items-center rounded-full bg-background/70 text-muted-foreground hover:text-foreground" aria-label="Cancel">
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

function FailedTile({ g, ratio, onRetry }: { g: Generation; ratio: number; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-dashed bg-background p-3" style={{ aspectRatio: Math.max(ratio, 0.8) }}>
      <div className="min-h-0 space-y-1 overflow-hidden">
        <p className="text-[13px] font-medium">{g.status === "canceled" ? "Canceled" : "Couldn't generate this one"}</p>
        {g.error && <p className="line-clamp-5 text-[12px] leading-snug break-words whitespace-pre-line text-muted-foreground">{g.error}</p>}
      </div>
      <button onClick={onRetry} className="mt-2 inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent">
        <RotateCcw className="size-3" /> Retry
      </button>
    </div>
  );
}

export function GenerationGroup({
  g,
  onOpen,
  onReuse,
}: {
  g: Generation;
  onOpen: (g: Generation, index: number) => void;
  onReuse?: (g: Generation) => void;
}) {
  const { favorite, remove } = useGenerationActions();
  const create = useCreateGeneration();
  const model = getModel(g.modelId);
  const preset = g.presetId ? getPreset(g.presetId) : undefined;
  const ratio = tileRatio(g);
  const active = g.status === "queued" || g.status === "running";
  const placeholders = Math.max(1, g.request.params?.numOutputs ?? 1);
  const retry = () =>
    create.mutate(g.request, {
      onError: (e) => toast.error((e as Error).message),
    });
  const p = g.request.params ?? {};
  const meta = [
    preset?.name,
    model?.name ?? g.modelId,
    OPERATION_LABELS[g.op],
    p.aspectRatio,
    p.resolution,
    p.duration ? `${p.duration >= 1000 ? p.duration / 1000 : p.duration}s` : undefined,
  ].filter(Boolean);

  return (
    <section className="group/gen animate-fade-up space-y-2.5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-heading text-[19px] leading-snug">{g.prompt || preset?.name || "Untitled"}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {g.engine === "open" ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
              {g.provider === "mock" ? "Demo" : g.engine === "open" ? "Open source" : "Cloud"}
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
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/gen:opacity-100 sm:focus-within:opacity-100">
          {onReuse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => onReuse(g)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                  <RotateCcw className="size-3.5" /> Reuse
                </button>
              </TooltipTrigger>
              <TooltipContent>Load prompt, model and settings into the composer</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="More">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(g.prompt ?? "");
                  toast("Prompt copied");
                }}
              >
                <Copy /> Copy prompt
              </DropdownMenuItem>
              <DropdownMenuItem onClick={retry}>
                <RotateCcw /> Run again
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void favorite(g)}>
                <Heart /> {g.favorite ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  void remove(g);
                  toast("Deleted");
                }}
              >
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
            <FailedTile g={g} ratio={ratio} onRetry={retry} />
          </div>
        )}
        {g.status === "succeeded" &&
          g.outputs.map((o, i) => (
            <div
              key={o.url}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(g, i)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(g, i)}
              className="group/tile relative h-56 max-w-full animate-fade-up cursor-zoom-in overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-64"
              style={{ aspectRatio: o.kind === "audio" ? 1.6 : ratio }}
            >
              <MediaThumb output={o} />
              {g.favorite && <Heart className="absolute top-2 right-2 size-4 fill-highlight text-highlight drop-shadow" />}
              {o.kind !== "audio" && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8 opacity-0 transition-opacity duration-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
                  <IconAction label="Download" href={`${o.url}?download=${encodeURIComponent(downloadName(g, o, i))}`}>
                    <Download className="size-4" />
                  </IconAction>
                  <IconAction label={g.favorite ? "Unfavorite" : "Favorite"} onClick={() => void favorite(g)}>
                    <Heart className={cn("size-4", g.favorite && "fill-current")} />
                  </IconAction>
                  {o.kind === "image" ? (
                    <>
                      <IconAction label="Animate" href={`/video?image=${encodeURIComponent(o.url)}`}>
                        <Clapperboard className="size-4" />
                      </IconAction>
                      <IconAction label="Edit" href={`/edit?image=${encodeURIComponent(o.url)}`}>
                        <Wand2 className="size-4" />
                      </IconAction>
                      <IconAction label="Upscale" href={`/upscale?image=${encodeURIComponent(o.url)}`}>
                        <ZoomIn className="size-4" />
                      </IconAction>
                      <IconAction label="Use as reference" href={`/image?ref=${encodeURIComponent(o.url)}`}>
                        <ImagePlus className="size-4" />
                      </IconAction>
                    </>
                  ) : (
                    <>
                      <IconAction label="Lipsync" href={`/lipsync?video=${encodeURIComponent(o.url)}`}>
                        <Mic2 className="size-4" />
                      </IconAction>
                      <IconAction label="Upscale" href={`/upscale?video=${encodeURIComponent(o.url)}`}>
                        <ZoomIn className="size-4" />
                      </IconAction>
                      <IconAction label="Add sound" href={`/audio?video=${encodeURIComponent(o.url)}`}>
                        <AudioLines className="size-4" />
                      </IconAction>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

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
  if (!items.length) return <>{empty}</>;
  const flat = items.flatMap((g) => (g.status === "succeeded" ? g.outputs.map((_, i) => ({ g, i })) : []));
  const pos = open ? flat.findIndex((f) => f.g.id === open.id && f.i === open.index) : -1;
  return (
    <>
      <div className="space-y-9">
        {items.map((g) => (
          <GenerationGroup key={g.id} g={g} onOpen={(gg, i) => setOpen({ id: gg.id, index: i })} onReuse={onReuse} />
        ))}
      </div>
      {open && pos >= 0 && (
        <Viewer
          generation={flat[pos].g}
          index={flat[pos].i}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen({ id: flat[pos - 1].g.id, index: flat[pos - 1].i }) : undefined}
          onNext={pos < flat.length - 1 ? () => setOpen({ id: flat[pos + 1].g.id, index: flat[pos + 1].i }) : undefined}
          onReuse={onReuse}
        />
      )}
    </>
  );
}
