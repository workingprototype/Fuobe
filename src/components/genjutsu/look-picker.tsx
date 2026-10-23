"use client";

import { Check, ImagePlus, Loader2, Search } from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { fileToList, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { LookCard } from "@/components/shorts/preset-card";
import { tabKeys } from "@/components/shorts/ui";
import { GENJUTSU, type GenjutsuLook } from "@/lib/catalog/genjutsu";
import { SHORTS_PRESETS, shortsPreview } from "@/lib/catalog/shorts";
import { cn } from "@/lib/utils";
import { useHiggsfieldLooks } from "./hooks";

export type LookSource = "fuobe" | "higgsfield" | "custom";

/**
 * Restyle's look: one of the 44 Shorts looks, one of Higgsfield's own Genjutsu looks (with a key), or your own look
 * from up to 8 images and a few words.
 */
export function LookPicker({
  look,
  onLook,
  source,
  onSource,
  custom,
  onCustom,
  words,
  onWords,
  higgsfield,
}: {
  look: GenjutsuLook | null;
  onLook: (l: GenjutsuLook) => void;
  source: LookSource;
  onSource: (s: LookSource) => void;
  custom: SlotValue[];
  onCustom: (update: (xs: SlotValue[]) => SlotValue[]) => void;
  words: string;
  onWords: (w: string) => void;
  /** A Higgsfield key is set. */
  higgsfield: boolean;
}) {
  const [q, setQ] = useState("");
  const tabs: { id: LookSource; label: string }[] = [
    { id: "fuobe", label: "Looks" },
    { id: "higgsfield", label: "Higgsfield" },
    { id: "custom", label: "Your own" },
  ];
  const presets = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? SHORTS_PRESETS.filter((p) => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(t)) : SHORTS_PRESETS;
  }, [q]);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Where the look comes from" onKeyDown={tabKeys} className="flex w-full rounded-full bg-muted p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`look-tab-${t.id}`}
            aria-selected={source === t.id}
            aria-controls={`look-panel-${t.id}`}
            tabIndex={source === t.id ? 0 : -1}
            onClick={() => onSource(t.id)}
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center justify-center rounded-full px-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              source === t.id && "bg-background text-foreground shadow-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {source === "fuobe" && (
        <div role="tabpanel" id="look-panel-fuobe" aria-labelledby="look-tab-fuobe" className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 44 looks — claymation, comic, watercolour…" aria-label="Search looks" className="h-8 pl-8 text-[13px]" />
          </div>
          <div className="grid max-h-[460px] grid-cols-3 gap-1 overflow-y-auto pr-0.5 sm:grid-cols-4 xl:grid-cols-5">
            {presets.map((p) => (
              <LookCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                preview={shortsPreview(p)}
                hue={p.hue}
                selected={look?.kind === "preset" && look.id === p.id}
                onSelect={(id) => onLook({ kind: "preset", id })}
              />
            ))}
            {!presets.length && <p className="col-span-full py-6 text-center text-[13px] text-muted-foreground">No look matches “{q}”.</p>}
          </div>
        </div>
      )}

      {source === "higgsfield" && (
        <div role="tabpanel" id="look-panel-higgsfield" aria-labelledby="look-tab-higgsfield">
          <HiggsfieldLooks enabled={higgsfield} selected={look?.kind === "higgsfield" ? look.id : undefined} onPick={(id, name) => onLook({ kind: "higgsfield", id, name })} />
        </div>
      )}

      {source === "custom" && (
        <div role="tabpanel" id="look-panel-custom" aria-labelledby="look-tab-custom" className="space-y-2.5">
          <p className="text-[12px] text-muted-foreground">Up to {GENJUTSU.maxLookImages} images of the look you want — stills, paintings, frames from a film. Every frame takes their colours, textures and style.</p>
          <div className="flex flex-wrap gap-2">
            {custom.map((v) => (
              <MediaSlot key={v.id} label="Look image" kind="image" value={v} onChange={(nv) => onCustom((xs) => (nv ? xs.map((x) => (x.id === v.id ? { ...nv, id: v.id } : x)) : xs.filter((x) => x.id !== v.id)))} />
            ))}
            {custom.length < GENJUTSU.maxLookImages && (
              <MediaSlot label={custom.length ? "Add image" : "Add an image"} kind="image" value={null} onChange={(v) => v && onCustom((xs) => [...xs, { ...v, id: v.id ?? nanoid(8) }])} onFile={(f) => fileToList(f, onCustom, "image")} />
            )}
          </div>
          <Input value={words} onChange={(e) => onWords(e.target.value)} maxLength={300} placeholder="In a few words (optional) — e.g. “grainy 70s film, warm and faded”" aria-label="Describe your look" className="h-8 text-[13px]" />
        </div>
      )}
    </div>
  );
}

function HiggsfieldLooks({ enabled, selected, onPick }: { enabled: boolean; selected?: string; onPick: (id: string, name: string) => void }) {
  const list = useHiggsfieldLooks(enabled);
  if (!enabled) {
    return (
      <p className="rounded-xl bg-muted/60 p-3 text-[13px] text-muted-foreground">
        Higgsfield&apos;s own Genjutsu looks load live with a Higgsfield key (Settings → API keys). The 44 looks and Your own work without one.
      </p>
    );
  }
  if (list.isLoading) {
    return (
      <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading Higgsfield&apos;s looks…
      </p>
    );
  }
  const items = list.data?.items ?? [];
  if (!items.length) return <p className="py-6 text-[13px] text-muted-foreground">{list.data?.error ?? "Higgsfield returned no looks — try again later, or pick one of the 44 looks."}</p>;
  return (
    <div className="grid max-h-[460px] grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 xl:grid-cols-5">
      {items.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={selected === p.id}
          onClick={() => onPick(p.id, p.name)}
          className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selected === p.id && "bg-brand-faint hover:bg-brand-faint-hover")}
        >
          <span className={cn("relative grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-lg bg-muted", selected === p.id && "ring-2 ring-primary")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.preview ? <img src={p.preview} alt="" className="size-full object-cover" loading="lazy" /> : <ImagePlus className="size-5 text-muted-foreground" />}
            {selected === p.id && (
              <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3.5" />
              </span>
            )}
          </span>
          <span className="truncate px-0.5 text-[13px] font-medium">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
