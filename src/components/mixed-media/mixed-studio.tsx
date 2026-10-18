"use client";

import { ArrowDown, Cloud, Cpu, Download, ImageIcon, Info, Loader2, Search, Sparkles, Wand2, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { MediaThumb } from "@/components/studio/result-media";
import { VideoTrimmer, type VideoTrimmerHandle } from "@/components/studio/video-trimmer";
import { LookCard } from "@/components/shorts/preset-card";
import { ClipBar, ClipDrop, costText, Field, Segmented } from "@/components/shorts/ui";
import { clipDuration, useSourceClip } from "@/components/shorts/use-source-clip";
import { uploadFile, useEngine } from "@/lib/api";
import {
  clampFps,
  defaultValues,
  fpsChoices,
  MIXED,
  MIXED_PRESETS,
  mixedFrames,
  mixedPreview,
  mixedRangeProblem,
  type MixedPreset,
  type MixedResolution,
  type MixedValues,
} from "@/lib/catalog/mixed-media";
import type { RestyleModelInfo } from "@/lib/catalog/shorts-models";
import type { Engine, Generation } from "@/lib/catalog/types";
import { downloadHref, downloadName } from "@/lib/library";
import type { TrimRange } from "@/lib/trim-range";
import { cn } from "@/lib/utils";
import { MixedHistory } from "./history";
import { useMixedActions, useMixedEstimate, useWatchedGeneration, type MixedBody } from "./hooks";
import { AdvancedSettings, loadSaved } from "./settings";

type Tab = "presets" | "history" | "how";
const TABS: { id: Tab; label: string }[] = [
  { id: "presets", label: "All presets" },
  { id: "history", label: "History" },
  { id: "how", label: "How it works" },
];

const HOW = [
  { step: "Choose a preset", text: "Browse 33 mixed-media looks — sketch, comic, paper, neon, marble — and pick the one that fits your clip." },
  { step: "Upload your video", text: "Add a clip and trim it to up to 10 seconds. It needs at least 4 frames per second." },
  { step: "Customize settings", text: "Each preset has its own colours, materials and intensity. Save them per preset; they stay in this browser." },
  { step: "Generate & preview", text: "Make one preview frame first to check the look, then render the whole video. Frames are restyled at the rate you pick." },
];

/** Mixed Media: pick a look, add a ≤10 s clip, tune the settings, preview one frame, render. */
export function MixedStudio({ models }: { models: Record<Engine, RestyleModelInfo[]> }) {
  const [tab, setTab] = useState<Tab>("presets");
  const [engine, setEngine] = useEngine();
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
    if (t === "history" || t === "how") setTab(t);
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "presets") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };
  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-3 backdrop-blur sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="sr-only font-heading text-[22px] leading-none sm:not-sr-only sm:truncate">Mixed Media</h1>
        <div role="tablist" aria-label="Mixed Media" className="fade-x scrollbar-none flex h-8 min-w-0 items-center overflow-x-auto rounded-full bg-muted p-0.5 sm:ml-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => pick(t.id)}
              className={cn("h-7 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground", tab === t.id && "bg-background text-foreground shadow-soft")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto shrink-0">
          <EngineSwitch value={engine} onChange={setEngine} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] min-w-0 flex-1 px-3 pb-28 sm:px-6 lg:pb-16">
        {tab === "history" ? (
          <MixedHistory onStart={() => pick("presets")} />
        ) : tab === "how" ? (
          <How onStart={() => pick("presets")} />
        ) : (
          <>
            <div className="mx-auto max-w-[720px] pt-8 pb-6 text-center sm:pt-12">
              <p className="text-[12px] font-semibold tracking-[0.14em] text-brand-text uppercase">No prompts, just vibe</p>
              <h2 className="mt-2 font-heading text-display text-balance">Turn any video into mixed-media art</h2>
              <p className="mx-auto mt-2 max-w-[560px] text-body text-pretty text-muted-foreground">
                33 looks, each with its own colours and materials. Every frame is restyled at the frame rate you choose — preview one frame first.
              </p>
            </div>
            <Workspace engine={engine} models={models[engine]} />
          </>
        )}
      </main>
    </div>
  );
}

function How({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-[920px] pt-10">
      <h2 className="text-center font-heading text-[34px] leading-tight">How it works</h2>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2">
        {HOW.map((h, i) => (
          <li key={h.step} className="rounded-2xl border bg-background p-5">
            <span className="grid size-7 place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">{i + 1}</span>
            <p className="mt-3 text-[15px] font-semibold">{h.step}</p>
            <p className="mt-1 text-[14px] text-muted-foreground">{h.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-2xl bg-muted/60 p-5 text-[13px] text-muted-foreground">
        <p className="font-medium text-foreground">Cost</p>
        <p className="mt-1">
          A render is counted in frames: seconds × frame rate, rounded down (10 s at 8 FPS = 80 frames). On the open engine every frame runs on your GPU for free; cloud
          models are priced by the model (per second or per video) and the estimate shows before you generate.
        </p>
      </div>
      <div className="mt-6 text-center">
        <button type="button" onClick={onStart} className="h-10 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
          Choose a preset
        </button>
      </div>
    </div>
  );
}

function Workspace({ engine, models }: { engine: Engine; models: RestyleModelInfo[] }) {
  const [presetId, setPresetId] = useState<string | null>(null);
  const preset = MIXED_PRESETS.find((p) => p.id === presetId) ?? null;
  const [values, setValues] = useState<MixedValues>({});
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim().toLowerCase());
  const list = useMemo(() => MIXED_PRESETS.filter((p) => !query || `${p.name} ${p.description}`.toLowerCase().includes(query)), [query]);
  const panel = useRef<HTMLElement>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { rootMargin: "0px 0px -30% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const select = (id: string) => {
    const p = MIXED_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setValues(loadSaved(p) ?? defaultValues(p));
  };
  // Hand-off: /mixed-media?preset=mixed-sketch.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    if (!id) return;
    const p = MIXED_PRESETS.find((x) => x.id === id);
    if (!p) return;
    /* eslint-disable react-hooks/set-state-in-effect -- read once after hydration */
    setPresetId(id);
    setValues(loadSaved(p) ?? defaultValues(p));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <section aria-labelledby="mm-presets" className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h3 id="mm-presets" className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-primary text-[12px] text-primary-foreground">1</span>
            Choose a preset
          </h3>
          <div className="relative w-full sm:ml-auto sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${MIXED_PRESETS.length} presets`}
              aria-label="Search presets"
              className="h-9 w-full rounded-full border bg-background pr-9 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {list.length ? (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
            {list.map((p) => (
              <LookCard key={p.id} id={p.id} name={p.name} description={p.description} preview={mixedPreview(p)} hue={p.hue} selected={presetId === p.id} onSelect={select} />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="font-heading text-[22px]">No presets match “{q.trim()}”</p>
            <button type="button" onClick={() => setQ("")} className="mt-3 h-8 rounded-full border px-3 text-[13px] font-medium hover:bg-accent">
              Clear search
            </button>
          </div>
        )}
      </section>
      <aside ref={panel} id="mm-editor" className="scrollbar-none min-w-0 scroll-mt-16 lg:sticky lg:top-16 lg:max-h-[calc(100svh-4.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl">
        <Editor engine={engine} models={models} preset={preset} values={values} setValues={setValues} />
      </aside>
      {preset && !panelVisible && (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:hidden">
          <button
            type="button"
            onClick={() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex h-12 w-full items-center gap-2 rounded-full bg-foreground px-4 text-[14px] font-medium text-background shadow-strong"
          >
            <Sparkles className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{preset.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              Add a clip <ArrowDown className="size-4" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

const LIMITS = "MP4 or MOV · 1 to 10 s · up to 50 MB · at least 4 FPS";
type FpsChoice = number | "manual";

function Editor({
  engine,
  models,
  preset,
  values,
  setValues,
}: {
  engine: Engine;
  models: RestyleModelInfo[];
  preset: MixedPreset | null;
  values: MixedValues;
  setValues: (v: MixedValues) => void;
}) {
  const source = useSourceClip(MIXED.maxBytes);
  const { clip } = source;
  // Hand-off: /mixed-media?video=/api/files/… (a result or a Library clip).
  useEffect(() => {
    const video = new URLSearchParams(window.location.search).get("video");
    if (video?.startsWith("/api/files/")) source.adopt(video, video.split("/").pop());
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const trimmer = useRef<VideoTrimmerHandle>(null);
  const [range, setRange] = useState<TrimRange | null>(null);
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>(MIXED.defaultFps as number);
  const [manual, setManual] = useState<number>(MIXED.defaultFps);
  const [resolution, setResolution] = useState<MixedResolution>("1K");
  const [pickedModel, setModel] = useState<Record<Engine, string>>({ cloud: "", open: "" });
  const modelId = pickedModel[engine] || models[0]?.id;
  const model = models.find((m) => m.id === modelId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [renderId, setRenderId] = useState<string | null>(null);
  const [anchorOff, setAnchorOff] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const actions = useMixedActions();
  const preview = useWatchedGeneration(previewId).data;
  const render = useWatchedGeneration(renderId).data;

  const duration = clipDuration(clip);
  const sourceFps = clip?.info?.fps;
  const fps = clampFps(fpsChoice === "manual" ? manual : fpsChoice, sourceFps);
  // A choice above the clip's own frame rate drops to the highest allowed ("Uploaded video has 6 FPS").
  const choices = fpsChoices(sourceFps);
  const mmRange = range ? { start: range.startTime, end: range.endTime } : null;
  const problem = mmRange ? mixedRangeProblem(mmRange, duration, sourceFps) : null;
  const frames = mmRange ? mixedFrames(mmRange.end - mmRange.start, fps) : 0;
  const previewImage = preview?.status === "succeeded" ? preview.outputs.find((o) => o.kind === "image") : undefined;
  const anchor = engine === "cloud" && model?.image && previewImage && !anchorOff ? previewImage.url : undefined;

  const body: MixedBody | null =
    preset && mmRange && !problem
      ? {
          engine,
          presetId: preset.id,
          values,
          source: { url: clip?.url ?? "/api/files/placeholder.mp4", name: clip?.name, duration, fps: sourceFps },
          range: mmRange,
          fps,
          resolution,
          modelId,
          ...(anchor ? { anchor } : {}),
        }
      : null;
  const estimate = useMixedEstimate(body);
  const est = estimate.data;

  // A new clip, preset or engine starts without a preview.
  const key = `${preset?.id}|${clip?.preview}|${engine}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPreviewId(null);
    setAnchorOff(false);
  }

  const blocker = !preset
    ? "Pick a preset first"
    : !clip
      ? "Add a clip"
      : clip.error
        ? clip.error
        : !duration || !range
          ? "Reading the clip…"
          : problem
            ? problem
            : clip.uploading
              ? clip.progress < 1
                ? `Uploading… ${Math.round(clip.progress * 100)}%`
                : "Reading the clip…"
              : estimate.error
                ? (estimate.error as Error).message
                : null;

  const makePreview = async () => {
    if (blocker || !body) return void toast(blocker ?? "Not ready yet", { id: "mm-blocker" });
    let frameUrl: string | undefined;
    if (engine === "cloud") {
      setGrabbing(true);
      try {
        const blob = await trimmer.current?.grabFrame(range!.startTime);
        if (!blob) return void toast.error("This browser can't read frames of this clip — try an MP4 (H.264), or generate the full video");
        frameUrl = (await uploadFile(new File([blob], "frame.jpg", { type: "image/jpeg" }))).url;
      } catch (e) {
        return void toast.error((e as Error).message);
      } finally {
        setGrabbing(false);
      }
    }
    actions.preview.mutate({ ...body, frameUrl }, { onSuccess: (g) => setPreviewId(g.id), onError: (e) => toast.error((e as Error).message) });
  };

  const generate = () => {
    if (blocker || !body) return void toast(blocker ?? "Not ready yet", { id: "mm-blocker" });
    actions.render.mutate(body, {
      onSuccess: (r) => {
        setRenderId(r.final.id);
        toast("Rendering your video", { description: "It shows up in History too." });
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <div className="space-y-5 rounded-2xl border bg-background p-4 shadow-soft sm:p-5">
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px]">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-text" />
        {preset ? (
          <span className="min-w-0">
            <span className="font-medium">{preset.name}</span> <span className="text-muted-foreground">· {preset.description}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Pick a preset to start</span>
        )}
      </div>

      <Field label="Your video">
        {!clip ? (
          <ClipDrop
            accept={MIXED.accept}
            limits={LIMITS}
            onFile={(f) => {
              const err = source.pick(f);
              if (err) toast.error(err);
              else setRange(null);
            }}
            onLibrary={(url, name) => {
              source.adopt(url, name);
              setRange(null);
            }}
          />
        ) : (
          <div className="space-y-3">
            <ClipBar
              clip={clip}
              onRemove={() => {
                source.clear();
                setRange(null);
              }}
            />
            <VideoTrimmer
              ref={trimmer}
              src={clip.preview}
              value={range}
              onChange={setRange}
              min={MIXED.minSeconds}
              max={MIXED.maxSeconds}
              duration={clip.info?.duration}
              label="Part of the clip to transform"
              onMeta={(m) => source.setBrowserDuration(m.duration)}
            />
          </div>
        )}
      </Field>

      <Field label="Frame rate" hint={sourceFps ? `Uploaded video has ${Math.round(sourceFps)} FPS` : "8 FPS is the classic stop-motion look"}>
        <Segmented<FpsChoice>
          label="Frame rate"
          value={fpsChoice}
          onChange={setFpsChoice}
          options={[
            ...choices.map((c) => ({ value: c.fps as FpsChoice, label: String(c.fps), disabled: c.disabled, title: c.disabled ? "Above the clip's own frame rate" : `${c.fps} FPS` })),
            { value: "manual" as FpsChoice, label: "Manual" },
          ]}
        />
        {fpsChoice === "manual" && (
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            Choose frames manually
            <input
              type="number"
              min={MIXED.manualFps.min}
              max={Math.min(MIXED.manualFps.max, sourceFps ? Math.floor(sourceFps) : MIXED.manualFps.max)}
              value={manual}
              onChange={(e) => setManual(Number(e.target.value) || MIXED.manualFps.min)}
              aria-label="Frames per second"
              className="h-7 w-16 rounded-md border bg-background px-2 font-mono text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint"
            />
            FPS
          </label>
        )}
        {fps !== (fpsChoice === "manual" ? manual : fpsChoice) && <p className="text-[12px] text-warning">Using {fps} FPS — the clip itself has no more frames than that.</p>}
      </Field>

      <Field label="Resolution">
        <Segmented<MixedResolution> label="Resolution" value={resolution} onChange={setResolution} options={MIXED.resolutions.map((r) => ({ value: r, label: r }))} />
      </Field>

      {preset && <AdvancedSettings preset={preset} values={values} onChange={setValues} />}

      <Field
        label="Model"
        hint={
          engine === "open" ? (
            <span className="inline-flex items-center gap-1">
              <Cpu className="size-3" /> Open source
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Cloud className="size-3" /> Cloud
            </span>
          )
        }
      >
        {models.length > 1 ? (
          <Select value={modelId} onValueChange={(v) => setModel((m) => ({ ...m, [engine]: v }))}>
            <SelectTrigger className="w-full" aria-label="Model">
              <SelectValue>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{model?.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{model?.price}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{m.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{m.price}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="rounded-lg border px-3 py-2 text-[13px]">
            <span className="font-medium">{model?.name ?? "—"}</span> <span className="text-muted-foreground">· {model?.price}</span>
          </div>
        )}
        {model && <p className="text-[12px] leading-snug text-muted-foreground">{model.tagline}</p>}
      </Field>

      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Preview frame</span>
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">Preview costs: {est ? costText({ costUsd: est.previewUsd, demo: est.demo }, engine) : "—"}</span>
        </div>
        <p className="text-[12px] text-muted-foreground">Generate one frame with your current settings before creating the full video.</p>
        {preview && (
          <div className="relative mx-auto aspect-video w-full max-w-[320px] overflow-hidden rounded-lg bg-muted">
            {preview.status === "succeeded" && preview.outputs[0] ? (
              <MediaThumb output={preview.outputs[0]} fit />
            ) : preview.status === "failed" || preview.status === "canceled" ? (
              <div className="grid size-full place-items-center p-3 text-center text-[12px] text-muted-foreground">{preview.error ?? "Canceled"}</div>
            ) : (
              <div className="skeleton-sweep grid size-full animate-skeleton place-items-center">
                <span className="shimmer-text animate-shimmer-text text-[12px] font-medium">Restyling one frame…</span>
              </div>
            )}
          </div>
        )}
        {anchor && (
          <p className="flex items-center gap-1.5 text-[12px] text-brand-text">
            <Wand2 className="size-3.5 shrink-0" /> {model?.name} follows this frame for the whole video
            <button type="button" onClick={() => setAnchorOff(true)} className="ml-auto text-muted-foreground underline-offset-2 hover:underline">
              Don&apos;t use it
            </button>
          </p>
        )}
        <button
          type="button"
          onClick={makePreview}
          aria-disabled={!!blocker || actions.preview.isPending || grabbing}
          className={cn(
            "flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[13px] font-medium",
            blocker ? "text-subtle-foreground" : "bg-background hover:bg-accent",
          )}
        >
          {actions.preview.isPending || grabbing ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          {preview ? "Generate another preview frame" : "Generate preview frame"}
        </button>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">{frames ? `${frames} frames · ${fps} FPS` : "Estimate"}</span>
          <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium tabular-nums" aria-live="polite">
            {estimate.isFetching && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            {body ? costText(est, engine) : "—"}
          </span>
        </div>
        {est?.notes.map((n) => (
          <p key={n} className="flex gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {n}
          </p>
        ))}
        <button
          type="button"
          onClick={generate}
          aria-disabled={!!blocker || actions.render.isPending}
          aria-describedby={blocker ? "mm-blocker" : undefined}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-colors",
            blocker ? "bg-muted text-subtle-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {actions.render.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Generate video
        </button>
        {blocker && (
          <p id="mm-blocker" className="text-center text-[12px] text-muted-foreground">
            {blocker}
          </p>
        )}
        {render && <LatestRender g={render} />}
      </div>
    </div>
  );
}

function LatestRender({ g }: { g: Generation }) {
  const out = g.status === "succeeded" ? g.outputs.find((o) => o.kind === "video") : undefined;
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3" aria-live="polite">
      <p className="text-[13px] font-medium">Your video</p>
      <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {out ? (
          <video src={out.url} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
        ) : g.status === "failed" || g.status === "canceled" ? (
          <div className="grid size-full place-items-center p-3 text-center text-[12px] text-muted-foreground">{g.error ?? "Canceled"}</div>
        ) : (
          <div className="skeleton-sweep grid size-full animate-skeleton place-items-center">
            <span className="shimmer-text animate-shimmer-text text-[12px] font-medium">{g.message ?? "Rendering…"}</span>
          </div>
        )}
      </div>
      {out && (
        <a href={downloadHref(out.url, downloadName(g, out, 0))} download={downloadName(g, out, 0)} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[12px] font-medium hover:bg-accent">
          <Download className="size-3.5" /> Download
        </a>
      )}
    </div>
  );
}
