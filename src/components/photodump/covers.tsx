"use client";

import { hueOf } from "@/lib/catalog/packs";
import { cn } from "@/lib/utils";

/**
 * A drawn pack cover (Fuobe ships no copies of Higgsfield's sample photos): a 2×2 contact sheet of
 * soft tiles in the pack's hue family, its name and photo count.
 */
export function PackCover({ id, name, count, className, refs, bare }: { id: string; name: string; count: number; className?: string; refs?: string[]; bare?: boolean }) {
  const h = hueOf(id);
  // One hue family per pack (a little drift and different light per tile), so packs read apart at a glance.
  const tiles = [
    [0, 0.82],
    [18, 0.66],
    [-16, 0.58],
    [34, 0.74],
  ].map(([d, l], i) => `linear-gradient(${140 + i * 35}deg, oklch(${l} 0.11 ${(h + d + 360) % 360}), oklch(${l - 0.24} 0.13 ${(h + d + 30 + 360) % 360}))`);
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      <span className="grid size-full grid-cols-2 grid-rows-2 gap-0.5">
        {tiles.map((bg, i) =>
          refs?.[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={refs[i]} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span key={i} style={{ background: bg }} />
          ),
        )}
      </span>
      {!bare && (
        <>
          <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <span className="absolute inset-x-2.5 bottom-2.5 text-white">
            <span className="block font-heading text-[19px] leading-tight drop-shadow-sm">{name}</span>
            <span className="text-[11.5px] font-medium opacity-90">{count} photos</span>
          </span>
        </>
      )}
    </span>
  );
}
