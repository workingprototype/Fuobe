"use client";

import { ArrowRight } from "lucide-react";
import { CardPending, IntentLink } from "@/components/intent-link";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import type { PresetCardData } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";

/**
 * A tile of Home's wall: a real cover that plays in view, its name, and what it does. On a desktop the line and a
 * "Try it" pill come in on hover or focus; on touch the line always shows. The first tile is the page's largest
 * picture, fetched first; tiles 5 to 8 are hidden (and never fetched) where the wall has two columns.
 */
export function ShowcaseTile({ card, kind, caption, href, index }: { card: PresetCardData; kind: string; caption: string; href: string; index: number }) {
  const { ref, playing, handlers } = usePreviewPlayback<HTMLAnchorElement>(card.id, card.preview);
  return (
    <IntentLink
      ref={ref}
      href={href}
      {...handlers}
      aria-label={`${card.name}, ${kind.split(" ·")[0].toLowerCase()}: ${caption.charAt(0).toLowerCase()}${caption.slice(1)}. Try it`}
      className={cn(
        "group/tile relative isolate block overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        index >= 4 && "max-sm:hidden md:max-lg:hidden",
      )}
    >
      <div className="relative aspect-[4/3] ease-out motion-safe:transition-transform motion-safe:duration-[400ms] motion-safe:group-hover/tile:scale-[1.03]">
        <PresetPreview preview={card.preview} hue={card.hue} playing={playing} loading={index < 4 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : undefined} />
      </div>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/65 to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-2.5 flex min-w-0 flex-col text-left text-white [text-shadow:0_1px_2px_rgb(0_0_0/30%)]">
        <span className="hidden text-[11px] tracking-wide text-white/75 uppercase xl:block">{kind}</span>
        <span className="truncate text-[14px] leading-snug font-medium">{card.name}</span>
        <span className="truncate text-[12px] text-white/80 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 [@media(hover:hover)]:opacity-0">
          {caption}
        </span>
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute top-2.5 right-2.5 inline-flex h-7 translate-y-1 items-center gap-1 rounded-full bg-white px-3 text-[12px] font-medium text-black opacity-0 shadow-soft transition duration-150 group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-y-0 group-focus-visible/tile:opacity-100"
      >
        Try it <ArrowRight className="size-3" />
      </span>
      <CardPending />
    </IntentLink>
  );
}
