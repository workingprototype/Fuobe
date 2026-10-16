"use client";

import { Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getModel, getPreset } from "@/lib/catalog";
import type { Generation, MediaKind } from "@/lib/catalog/types";
import { useEngine, useGenerations } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { EngineSwitch } from "./engine-switch";
import { Feed } from "./feed";
import { fileToSlot, type SlotValue } from "./media-slot";
import { StudioProvider, useStudio, type Draft, type StudioConfig } from "./studio-context";

function kindOfUrl(url: string): MediaKind {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a)(\?|$)/i.test(url)) return "audio";
  return "image";
}

const slot = (url: string | null | undefined): SlotValue | null =>
  url ? { ref: url, preview: url, kind: kindOfUrl(url), id: nanoid(6) } : null;

function initialDraft(config: StudioConfig, sp: URLSearchParams, engine: "cloud" | "open"): Draft {
  const preset = sp.get("preset") ? getPreset(sp.get("preset")!) : config.preset;
  const presetRoute = preset ? (engine === "open" ? preset.open : preset.cloud) ?? preset.cloud ?? preset.open : null;
  const requested = sp.get("model");
  const modelId =
    (requested && getModel(requested)?.id) ||
    (preset?.type === "app" ? presetRoute?.modelId : undefined) ||
    config.defaultModels[engine] ||
    config.defaultModels.cloud;
  const model = getModel(modelId);
  const slots: Draft["slots"] = {};
  const imageSlot = config.slots.find((s) => s.accept === "image")?.key ?? (preset?.inputs.find((s) => s.accept === "image")?.key);
  const refs: SlotValue[] = [];
  if (sp.get("image") && imageSlot) slots[imageSlot] = slot(sp.get("image"));
  if (sp.get("ref")) {
    if (config.multiRef) refs.push(slot(sp.get("ref"))!);
    else if (imageSlot) slots[imageSlot] = slot(sp.get("ref"));
  }
  if (sp.get("video")) slots.video = slot(sp.get("video"));
  if (sp.get("audio")) slots.audio = slot(sp.get("audio"));
  return {
    prompt: sp.get("prompt") ?? "",
    negativePrompt: "",
    modelId,
    params: { ...model?.defaults, ...(preset?.type === "app" ? presetRoute?.params : {}) },
    slots,
    refs,
    presetId: sp.get("preset") ?? config.preset?.id,
    presetOptions: {},
  };
}

/** Rebuild a composer draft from a past generation ("Reuse"). */
function draftFromGeneration(g: Generation, config: StudioConfig): Partial<Draft> {
  const r = g.request;
  const imgs = r.inputs?.images ?? [];
  const imageKeys = config.slots.filter((s) => s.accept === "image" && s.key !== "endImage" && s.key !== "mask").map((s) => s.key);
  const slots: Draft["slots"] = {};
  imageKeys.forEach((k, i) => (slots[k] = slot(imgs[i])));
  const refs = config.multiRef ? imgs.slice(imageKeys.length).map((u) => slot(u)!).filter(Boolean) : [];
  if (r.inputs?.endImage) slots.endImage = slot(r.inputs.endImage);
  if (r.inputs?.video) slots.video = slot(r.inputs.video);
  if (r.inputs?.audio) slots.audio = slot(r.inputs.audio);
  return {
    prompt: r.prompt ?? "",
    negativePrompt: r.negativePrompt ?? "",
    modelId: r.modelId,
    params: { ...r.params },
    slots,
    refs,
    presetId: r.presetId,
    presetOptions: r.presetOptions ?? {},
  };
}

function StudioBody({ header }: { header?: React.ReactNode }) {
  const { config, setDraft, addImage } = useStudio();
  const [engine, setEngine] = useEngine();
  const feed = useGenerations(config.feed);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const items = feed.data ?? [];
  const hasItems = items.length > 0;

  const reuse = (g: Generation) => {
    setDraft(draftFromGeneration(g, config));
    const model = getModel(g.modelId);
    if (model && model.engine !== engine) setEngine(model.engine);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")?.focus());
  };

  const composer = (docked: boolean) => (
    <div data-composer className={cn("mx-auto w-full", docked ? "max-w-[800px]" : "max-w-[760px]")}>
      <Composer docked={docked} />
    </div>
  );

  return (
    <div
      className="relative flex min-h-svh flex-col"
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        for (const f of [...e.dataTransfer.files].slice(0, 6)) {
          const id = nanoid(6);
          void fileToSlot(f, (v) => v && !v.uploading && addImage({ ...v, id }));
        }
      }}
    >
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-3 backdrop-blur sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="font-heading text-[22px] leading-none">{config.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {header}
          <EngineSwitch value={engine} onChange={setEngine} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-3 pb-8 sm:px-6">
        {feed.isLoading ? (
          <div className="space-y-3 pt-6">
            <Skeleton className="h-6 w-1/3" />
            <div className="flex gap-2">
              <Skeleton className="h-56 w-56 rounded-xl" />
              <Skeleton className="h-56 w-56 rounded-xl" />
            </div>
          </div>
        ) : hasItems ? (
          <div className="pt-4">
            <Feed items={items} onReuse={reuse} />
          </div>
        ) : (
          <div className="flex flex-col items-center pt-[16vh] text-center">
            <h2 className="font-heading text-display text-balance">{config.hero}</h2>
            {config.subtitle && <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{config.subtitle}</p>}
            <div className="mt-10 w-full">{composer(false)}</div>
            {config.suggestions && (
              <div className="mt-4 flex max-w-[760px] flex-wrap justify-center gap-2">
                {config.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft({ prompt: s })}
                    className="h-8 rounded-full border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s.length > 48 ? `${s.slice(0, 46)}…` : s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {hasItems && (
        <div className="sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-3 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {composer(true)}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-overlay p-8">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background px-12 py-10 shadow-heavy">
            <Upload className="size-6 text-brand-text" />
            <p className="font-medium">Drop to use as reference</p>
            <p className="text-[13px] text-muted-foreground">Images, videos or audio · up to 200 MB</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StudioInner({ config, header, initialRefs }: { config: StudioConfig; header?: React.ReactNode; initialRefs?: string[] }) {
  const sp = useSearchParams();
  const [engine] = useEngine();
  // Recompute the initial draft only when the handoff params change.
  const key = sp.toString();
  const initial = useMemo(() => {
    const d = initialDraft(config, new URLSearchParams(key), engine);
    if (initialRefs?.length) d.refs = [...initialRefs.map((u) => slot(u)!), ...d.refs];
    return d;
  }, [config, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <StudioProvider key={key} config={config} initial={initial}>
      <StudioBody header={header} />
    </StudioProvider>
  );
}

export function StudioPage({ config, header, initialRefs }: { config: StudioConfig; header?: React.ReactNode; initialRefs?: string[] }) {
  return (
    <Suspense fallback={null}>
      <StudioInner config={config} header={header} initialRefs={initialRefs} />
    </Suspense>
  );
}
