"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { MoodboardStatus } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type CuratedMoodboard, type Moodboard } from "./logic";

/** A drawn cover for a curated look (no Higgsfield images are hot-linked): its hue, its name. */
export function CuratedCover({ m, className }: { m: Pick<CuratedMoodboard, "name" | "hue">; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative block overflow-hidden", className)}
      style={{ background: `radial-gradient(120% 90% at 20% 15%, oklch(0.86 0.09 ${m.hue}), transparent 60%), linear-gradient(160deg, oklch(0.62 0.14 ${(m.hue + 30) % 360}), oklch(0.32 0.08 ${(m.hue + 70) % 360}))` }}
    >
      <span className="absolute inset-x-2 bottom-2 font-heading text-[19px] leading-tight text-white drop-shadow-sm">{m.name}</span>
    </span>
  );
}

export function StatusBadge({ status, className }: { status: MoodboardStatus; className?: string }) {
  const busy = status !== "complete" && status !== "failed";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full bg-background/95 px-2 text-[11px] font-medium shadow-soft",
        status === "complete" ? "text-success" : status === "failed" ? "text-destructive" : "text-foreground",
        className,
      )}
    >
      {busy && <Loader2 className="size-3 animate-spin" />}
      {status === "complete" && <Check className="size-3" />}
      {status === "failed" && <AlertCircle className="size-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A personal board's cover: the cover image (or a 2×2 of its first images while it builds). */
export function BoardCover({ m, className }: { m: Pick<Moodboard, "cover" | "images" | "status">; className?: string }) {
  const done = m.status === "complete" && m.cover;
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {done ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.cover!} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-px opacity-80">
          {m.images.slice(0, 4).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading="lazy" className="size-full object-cover" />
          ))}
        </span>
      )}
    </span>
  );
}
