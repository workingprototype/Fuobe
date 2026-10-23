"use client";

import { Cloud, Cpu, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { PresetPreview } from "@/components/preset-preview";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Preset } from "@/lib/catalog/types";
import { presetHowTo, presetRouteLines, previewFlip, toPresetCard } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";

const REDUCED = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => true,
  );
}

/**
 * The card a studio shows above its composer while a preset (app, camera motion, effect) is active
 * and the feed is still empty: the preview looping, the name, one line on what to do, the models it
 * runs on behind a Details popover, and a way to clear the preset.
 *
 * Hook (studio-page.tsx, empty state, above the composer):
 *   {preset && !hasItems && <PresetHeader preset={preset} modelName={(id) => getModel(id)?.name}
 *     onClear={config.preset ? undefined : () => setDraft({ presetId: undefined })} />}
 */
export function PresetHeader({
  preset,
  modelName,
  onClear,
  className,
}: {
  preset: Preset;
  /** Display name for a model id (the studio's model lookup). */
  modelName?: (id: string) => string | undefined;
  /** Clear the preset (motions/effects picked in a general studio); omit on a preset's own page. */
  onClear?: () => void;
  className?: string;
}) {
  const card = toPresetCard(preset);
  const reduced = useReducedMotion();
  const routes = presetRouteLines(preset, modelName);
  return (
    <div className={cn("mx-auto flex w-full max-w-[760px] items-center gap-3 rounded-2xl border bg-background p-2 pr-3 text-left shadow-soft", className)}>
      <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-32">
        <PresetPreview preview={card.preview} hue={card.hue} playing={!reduced} flip={previewFlip(card)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-[19px] leading-snug">{preset.name}</p>
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{presetHowTo(preset)}</p>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Info className="size-3.5" />
            <span className="max-sm:sr-only">Details</span>
            <span className="sr-only"> about {preset.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,360px)] space-y-2 p-3 text-[13px]">
          <p className="text-muted-foreground">{preset.description}</p>
          <ul className="space-y-1">
            {routes.map((r) => (
              <li key={r.engine} className="flex items-center gap-2">
                {r.engine === "cloud" ? <Cloud className="size-3.5 shrink-0" /> : <Cpu className="size-3.5 shrink-0" />}
                <span className="text-muted-foreground">{r.label}</span>
                <span className={cn("ml-auto truncate font-medium", !r.model && "font-normal text-muted-foreground")}>{r.model ?? "Not available yet"}</span>
              </li>
            ))}
          </ul>
          {preset.parity && <p className="border-t pt-2 text-[12px] text-muted-foreground">{preset.parity}</p>}
        </PopoverContent>
      </Popover>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Clear ${preset.name}`}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
