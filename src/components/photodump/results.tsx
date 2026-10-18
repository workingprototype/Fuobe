"use client";

import { Check, Download, Film, Maximize2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FailedTile, MediaThumb, PendingTile } from "@/components/studio/feed";
import { Viewer } from "@/components/studio/viewer";
import { useCreateGeneration, useGenerationActions } from "@/lib/api";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export interface Tile {
  g: Generation;
  /** Index into g.outputs (finished tiles). */
  i?: number;
  o?: OutputFile;
  key: string;
}

const order = (g: Generation) => g.request.step?.index ?? 0;

/** One tile per finished image, one per expected image while a job runs (a ×4 job shows four placeholders). */
export function tilesOf(items: Generation[]): Tile[] {
  return [...items]
    .sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt)
    .flatMap((g) =>
      g.status === "succeeded"
        ? g.outputs.filter((o) => o.kind === "image").map((o, i) => ({ g, i, o, key: `${g.id}:${i}` }))
        : g.status === "queued" || g.status === "running"
          ? Array.from({ length: Math.max(1, Math.min(4, g.request.params?.numOutputs ?? 1)) }, (_, k) => ({ g, key: `${g.id}:p${k}` }))
          : [{ g, key: `${g.id}:x` }],
    );
}

function IconLink({ href, label, icon: Icon, onClick }: { href?: string; label: string; icon: typeof Film; onClick?: () => void }) {
  const cls = "grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-soft outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} prefetch={false} aria-label={label} className={cls}>
            <Icon className="size-3.5" />
          </Link>
        ) : (
          <button type="button" aria-label={label} onClick={onClick} className={cls}>
            <Icon className="size-3.5" />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A grid of results: placeholders while they render, a retry card when one fails, and finished images
 * with Animate / Edit / Delete. With `onPick`, clicking an image selects it (Fashion Factory's "pick 1")
 * and the expand button opens the viewer; otherwise clicking opens the viewer.
 */
export function ResultsGrid({
  items,
  ratio = 3 / 4,
  picked,
  onPick,
  className,
}: {
  items: Generation[];
  ratio?: number;
  picked?: string;
  onPick?: (url: string) => void;
  className?: string;
}) {
  const tiles = useMemo(() => tilesOf(items), [items]);
  const done = tiles.filter((t) => t.o);
  const [open, setOpen] = useState<number | null>(null);
  const { trash } = useGenerationActions();
  const create = useCreateGeneration();
  const viewing = open !== null ? done[open] : undefined;
  return (
    <>
      <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", className)}>
        {tiles.map((t) => {
          if (!t.o) {
            if (t.g.status === "queued" || t.g.status === "running") return <PendingTile key={t.key} g={t.g} ratio={ratio} />;
            return (
              <FailedTile
                key={t.key}
                g={t.g}
                ratio={ratio}
                onRetry={() => create.mutate({ ...t.g.request, title: undefined, batchTitle: undefined }, { onError: (e) => toast.error((e as Error).message) })}
              />
            );
          }
          const url = t.o.url;
          const sel = picked === url;
          const idx = done.indexOf(t);
          return (
            <div key={t.key} className="group/tile relative overflow-hidden rounded-xl bg-muted animate-fade-up" style={{ aspectRatio: ratio }}>
              <button
                type="button"
                onClick={() => (onPick ? onPick(url) : setOpen(idx))}
                aria-pressed={onPick ? sel : undefined}
                aria-label={onPick ? `Pick ${t.g.request.step?.label ?? "this image"}` : `Open ${t.g.request.step?.label ?? "image"}`}
                className={cn("block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", sel && "ring-3 ring-primary ring-inset")}
              >
                <MediaThumb output={t.o} g={t.g} />
              </button>
              {sel && (
                <span className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
                  <Check className="size-3.5" />
                </span>
              )}
              <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/tile:opacity-100 sm:group-hover/tile:opacity-100">
                {onPick && <IconLink label="View" icon={Maximize2} onClick={() => setOpen(idx)} />}
                <IconLink href={`/video?image=${encodeURIComponent(url)}`} label="Animate" icon={Film} />
                <IconLink href={`/edit?image=${encodeURIComponent(url)}`} label="Edit" icon={Pencil} />
                <IconLink label="Delete" icon={Trash2} onClick={() => void trash([t.g])} />
              </div>
              {t.g.request.step && <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium">{t.g.request.step.label}</span>}
            </div>
          );
        })}
      </div>
      {viewing?.o && (
        <Viewer
          generation={viewing.g}
          index={viewing.i ?? 0}
          onClose={() => setOpen(null)}
          onPrev={open! > 0 ? () => setOpen(open! - 1) : undefined}
          onNext={open! < done.length - 1 ? () => setOpen(open! + 1) : undefined}
        />
      )}
    </>
  );
}

/** "Download (8 /10)": a zip of the finished images (the Library's zip endpoint). */
export function DownloadAll({ items, label = "Download" }: { items: Generation[]; label?: string }) {
  const tiles = tilesOf(items);
  const ready = items.filter((g) => g.status === "succeeded");
  const available = tiles.filter((t) => t.o).length;
  const total = tiles.length;
  const href = ready.length ? `/api/generations/zip?ids=${ready.map((g) => g.id).join(",")}` : undefined;
  return (
    <a
      href={href}
      download
      aria-disabled={!href}
      onClick={(e) => !href && e.preventDefault()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90",
        !href && "pointer-events-none opacity-50",
      )}
    >
      <Download className="size-3.5" />
      {available === total ? `${label} all` : `${label} (${available} /${total})`}
    </a>
  );
}
