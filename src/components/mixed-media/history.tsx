"use client";

import { Download, Shapes } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingTile } from "@/components/studio/feed";
import { MediaThumb } from "@/components/studio/result-media";
import { Viewer } from "@/components/studio/viewer";
import { useGenerations } from "@/lib/api";
import { MIXED_FEATURE } from "@/lib/catalog/mixed-media";
import type { Generation } from "@/lib/catalog/types";
import { timeAgo } from "@/lib/format";
import { downloadHref, downloadName, userTitle } from "@/lib/library";

const FILTER = { features: [MIXED_FEATURE], limit: 60 };

/** History: the finished (and rendering) Mixed Media videos, newest first. */
export function MixedHistory({ onStart }: { onStart: () => void }) {
  const list = useGenerations(FILTER);
  const [open, setOpen] = useState<Generation | null>(null);
  if (list.isLoading)
    return (
      <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  if (!list.data?.length)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-brand-faint text-brand-text">
          <Shapes className="size-5" />
        </span>
        <p className="mt-4 font-heading text-[22px]">Nothing here yet</p>
        <p className="mt-1 text-[14px] text-muted-foreground">Pick a preset, add a clip of up to 10 seconds and generate — your mixed-media videos show up here.</p>
        <button type="button" onClick={onStart} className="mt-5 h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
          Browse presets
        </button>
      </div>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
        {list.data.map((g) => {
          const out = g.status === "succeeded" ? g.outputs.find((o) => o.kind === "video") : undefined;
          return (
            <div key={g.id} className="min-w-0">
              <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                {out ? (
                  <button type="button" onClick={() => setOpen(g)} aria-label={`Open ${userTitle(g)}`} className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <MediaThumb output={out} />
                  </button>
                ) : g.status === "queued" || g.status === "running" ? (
                  <PendingTile g={g} ratio={1} />
                ) : (
                  <div className="flex size-full flex-col justify-center gap-1 border border-dashed p-3">
                    <p className="text-[13px] font-medium">{g.status === "canceled" ? "Canceled" : "Couldn't render this one"}</p>
                    {g.error && <p className="line-clamp-4 text-[12px] text-muted-foreground">{g.error}</p>}
                  </div>
                )}
              </div>
              <div className="flex items-start gap-1 px-0.5 pt-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{userTitle(g)}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{timeAgo(g.createdAt)}</p>
                </div>
                {out && (
                  <a href={downloadHref(out.url, downloadName(g, out, 0))} download={downloadName(g, out, 0)} aria-label="Download" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Download className="size-3.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {open && <Viewer generation={open} index={0} onClose={() => setOpen(null)} />}
    </>
  );
}
