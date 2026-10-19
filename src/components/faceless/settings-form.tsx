"use client";

import { AtSign, ChevronDown, Film, Images, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fileToList, SlotPreview, type SlotValue } from "@/components/studio/media-slot";
import { useElements } from "@/lib/api";
import {
  ANIMATION_MODES,
  DEFAULT_RESOLUTION,
  ENGINE_MODELS,
  FACELESS_LENGTHS,
  MAX_STYLE_REFS,
  type EpisodeSettings,
  type PickerData,
} from "@/lib/catalog/faceless";
import { cn } from "@/lib/utils";
import { Section, Segmented, ToggleRow } from "./controls";
import { NarratorList } from "./narrator";
import { StyleGrid } from "./style-art";

/** Up to 3 style reference images (they replace the preset). */
export function StyleRefs({ value, onChange }: { value: string[]; onChange: (urls: string[]) => void }) {
  const [list, setList] = useState<SlotValue[]>(() => value.map((url) => ({ ref: url, preview: url, kind: "image" })));
  const sync = setList;
  // Finished uploads become the settings' references.
  const done = list.filter((x) => !x.uploading && x.ref).map((x) => x.ref);
  const key = done.join("|");
  useEffect(() => {
    if (key !== value.join("|")) onChange(key ? key.split("|") : []);
    // Only when the uploaded list changes; `value` follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map((v, i) => (
        <div key={v.id ?? v.ref ?? i} className="relative size-20 overflow-hidden rounded-xl border bg-muted">
          <SlotPreview value={v} />
          <button
            type="button"
            onClick={() => sync((xs) => xs.filter((x) => x !== v))}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-soft"
            aria-label={`Remove style reference ${i + 1}`}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {list.length < MAX_STYLE_REFS && (
        <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text focus-within:ring-2 focus-within:ring-ring">
          <Plus className="size-4" />
          Add image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].slice(0, MAX_STYLE_REFS - list.length);
              e.target.value = "";
              for (const f of files) fileToList(f, sync, "image");
            }}
          />
        </label>
      )}
    </div>
  );
}

/** Characters and places the script may use (their @handles go into the scenes). */
export function ElementsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const els = (useElements().data ?? []).filter((e) => e.kind === "character" || e.kind === "location" || e.kind === "prop");
  if (!els.length)
    return (
      <p className="text-[12px] text-muted-foreground">
        Save characters and places in <Link href="/elements?new=1" className="text-brand-text hover:underline">Elements</Link> to keep them the same in every scene.
      </p>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {els.map((e) => {
        const on = value.includes(e.handle);
        return (
          <button
            key={e.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((h) => h !== e.handle) : [...value, e.handle].slice(0, 8))}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-1 text-[13px] font-medium transition-colors",
              on ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary hover:bg-accent",
            )}
          >
            {e.references[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.references[0]} alt="" className="size-6 rounded-full object-cover" />
            ) : (
              <AtSign className="ml-1 size-3.5" />
            )}
            @{e.handle}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Video settings for an episode (Faceless) or an explainer: length, animation, format, style (or style
 * references), narrator, the characters to use, and the video model and quality.
 */
export function EpisodeSettingsForm({
  kind,
  value,
  onChange,
  picker,
  styleIds,
}: {
  kind: "faceless" | "explainer";
  value: EpisodeSettings;
  onChange: (patch: Partial<EpisodeSettings>) => void;
  picker: PickerData;
  styleIds: string[];
}) {
  const [own, setOwn] = useState(value.styleRefs.length > 0);
  const videos = picker.videoModels.filter((m) => m.engine === value.engine);
  const video = videos.find((m) => m.id === value.videoModel) ?? videos.find((m) => m.id === ENGINE_MODELS[value.engine].video) ?? videos[0];
  const resolution = value.resolution && video?.resolutions.includes(value.resolution) ? value.resolution : (DEFAULT_RESOLUTION[video?.id ?? ""]?.[value.animation] ?? video?.resolutions[0]);
  return (
    <div className="space-y-7">
      {kind === "faceless" && (
        <Section title="Length">
          <Segmented label="Episode length" value={value.length} options={FACELESS_LENGTHS.map((s) => ({ value: s, label: `${s / 60} min` }))} onChange={(length) => onChange({ length })} />
        </Section>
      )}

      <Section title="Animation">
        <div role="radiogroup" aria-label="Animation" className="grid gap-2 sm:grid-cols-2">
          {ANIMATION_MODES.map((m) => {
            const on = value.animation === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ animation: m.id, resolution: undefined })}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-[border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary ring-2 ring-brand-faint" : "hover:border-border-strong",
                )}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", on ? "bg-brand-faint text-brand-text" : "bg-muted text-muted-foreground")}>
                  {m.id === "animated" ? <Film className="size-4" /> : <Images className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{m.label}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{m.copy}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Format">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Aspect ratio"
            value={value.aspect}
            options={[
              { value: "16:9", label: "Horizontal 16:9" },
              { value: "9:16", label: "Vertical 9:16" },
            ]}
            onChange={(aspect) => onChange({ aspect })}
          />
        </div>
        <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <ToggleRow label="Subtitles" hint="Burned into the video, timed to the voice" checked={value.subtitles} onChange={(subtitles) => onChange({ subtitles })} />
          <ToggleRow
            label="Background music"
            hint={value.engine === "cloud" ? "An instrumental bed under the voice (mixed by ComfyUI: the cloud mixer takes one track)" : "An instrumental bed under the voice (ACE-Step)"}
            checked={value.music}
            onChange={(music) => onChange({ music })}
          />
        </div>
      </Section>

      <Section title="Style" hint="Choose either a style preset or your own style references.">
        <Segmented
          label="Style source"
          value={own ? "own" : "preset"}
          options={[
            { value: "preset", label: "Style presets" },
            { value: "own", label: "Use your own style" },
          ]}
          onChange={(v) => {
            setOwn(v === "own");
            if (v === "preset") onChange({ styleRefs: [] });
          }}
        />
        {own ? (
          <div className="space-y-2">
            <StyleRefs value={value.styleRefs} onChange={(styleRefs) => onChange({ styleRefs })} />
            <p className="text-[12px] text-muted-foreground">Up to 3 images in the look you want: palette, technique and texture are matched, nothing is copied.</p>
          </div>
        ) : (
          <StyleGrid ids={styleIds} value={value.styleId} onChange={(styleId) => onChange({ styleId })} />
        )}
      </Section>

      <Section title="Narrator">
        <div className="rounded-xl border p-2">
          <NarratorList engine={value.engine} voices={picker.voices} value={value.voice} onChange={(voice) => onChange({ voice })} />
        </div>
      </Section>

      <Section title="Characters and places" hint="The script puts them in the scenes where they belong; their pictures keep them the same.">
        <ElementsPicker value={value.elements} onChange={(elements) => onChange({ elements })} />
      </Section>

      <Collapsible>
        <CollapsibleTrigger className="group/adv inline-flex items-center gap-1 rounded text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="size-4 transition-transform group-data-[state=open]/adv:rotate-180" /> Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          {videos.length > 1 && (
            <Section title="Video model">
              <Segmented label="Video model" value={video?.id ?? ""} options={videos.map((m) => ({ value: m.id, label: m.name }))} onChange={(videoModel) => onChange({ videoModel, resolution: undefined })} />
            </Section>
          )}
          {video && video.resolutions.length > 1 && (
            <Section title="Quality" hint={value.animation === "frames" ? "Frame by frame renders at a lower quality to keep it light; raise it here." : undefined}>
              <Segmented label="Quality" value={resolution ?? ""} options={video.resolutions.map((r) => ({ value: r, label: r }))} onChange={(r) => onChange({ resolution: r })} />
            </Section>
          )}
          <p className="text-[12px] text-muted-foreground">
            {value.engine === "cloud"
              ? `Pictures: Nano Banana Pro · Video: ${video?.name ?? "Gemini Omni Flash"} · Voice: ElevenLabs v4 (Chatterbox for your own voice) · Subtitles: Auto Subtitle`
              : "Pictures: Z-Image Turbo · Video: Wan 2.2 Lightning · Voice: Chatterbox · Music: ACE-Step · Subtitles: Qwen3-ASR + burn-in"}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
