"use client";

import { ArrowUp, Loader2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Generation, MediaKind, ModelDef, Preset } from "@/lib/catalog/types";
import { useEngine, useGenerations } from "@/lib/api";
import type { StudioCatalog } from "@/lib/studio-catalog";
import { cn } from "@/lib/utils";
import { ComposerBridgeCtx, useComposerBridge, type ComposerBridge } from "./attachments";
import { CatalogProvider, useCatalog } from "./catalog";
import { Composer } from "./composer";
import { EngineSwitch } from "./engine-switch";
import { Feed } from "./feed";
import type { SlotValue } from "./media-slot";
import { StudioProvider, useStudioActions, type Draft, type StudioConfig } from "./studio-context";

function kindOfUrl(url: string): MediaKind {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a)(\?|$)/i.test(url)) return "audio";
  return "image";
}

const slot = (url: string | null | undefined): SlotValue | null =>
  url ? { ref: url, preview: url, kind: kindOfUrl(url), id: nanoid(6) } : null;

function initialDraft(
  config: StudioConfig,
  sp: URLSearchParams,
  engine: "cloud" | "open",
  lookup: { getModel: (id: string) => ModelDef | undefined; getPreset: (id: string) => Preset | undefined },
): Draft {
  const preset = sp.get("preset") ? lookup.getPreset(sp.get("preset")!) : config.preset;
  const presetRoute = preset ? ((engine === "open" ? preset.open : preset.cloud) ?? preset.cloud ?? preset.open) : null;
  const requested = sp.get("model");
  const modelId =
    (requested && lookup.getModel(requested)?.id) ||
    (preset?.type === "app" ? presetRoute?.modelId : undefined) ||
    config.defaultModels[engine] ||
    config.defaultModels.cloud ||
    // Open-only tools (Match colors) keep their open model under the Cloud switch, like cloud-only ones do under Open.
    config.defaultModels.open;
  const model = lookup.getModel(modelId);
  const slots: Draft["slots"] = {};
  const imageSlot = config.slots.find((s) => s.accept === "image")?.key ?? preset?.inputs.find((s) => s.accept === "image")?.key;
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
    presetStrength: r.presetStrength,
    mix: r.mix,
  };
}

/**
 * New results land at the top of the feed while the composer is docked at the bottom: when one
 * arrives off-screen (you scrolled down into your history), a pill above the composer jumps to it (U4).
 */
function useOffscreenResults(items: Generation[] | undefined) {
  const since = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    since.current = Date.now() - 2000;
  }, []);
  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((g) => g.id));
      return;
    }
    const known = seen.current;
    const added = items.filter((g) => !known.has(g.id) && g.createdAt >= since.current);
    items.forEach((g) => known.add(g.id));
    if (!added.length) return;
    const raf = requestAnimationFrame(() => {
      const off = added.filter((g) => !inView(g.id)).map((g) => g.id);
      if (off.length) setFresh((f) => [...new Set([...off, ...f])]);
    });
    return () => cancelAnimationFrame(raf);
  }, [items]);
  // Clear the ones you scrolled to.
  const pending = fresh.length > 0;
  useEffect(() => {
    if (!pending) return;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFresh((f) => (f.some(inView) ? f.filter((id) => !inView(id)) : f)));
    };
    window.addEventListener("scroll", check, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", check, { capture: true });
    };
  }, [pending]);
  const present = fresh.filter((id) => items?.some((g) => g.id === id));
  const working = present.filter((id) => items?.some((g) => g.id === id && (g.status === "queued" || g.status === "running"))).length;
  const jump = () => {
    document.querySelector(`[data-gen-id="${present[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFresh([]);
  };
  return { count: present.length, working, jump };
}

function inView(id: string): boolean {
  const el = document.querySelector(`[data-gen-id="${id}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 56 && r.top < window.innerHeight - 160;
}

const EMPTY: Generation[] = [];

/** Sticky page header (title + engine), with an optional row of mode tabs under it. */
function StudioHeader({ title, header, tabs }: { title: string; header?: React.ReactNode; tabs?: React.ReactNode }) {
  const [engine, setEngine] = useEngine();
  return (
    <div className="sticky top-0 z-20 bg-background/85 backdrop-blur">
      <header className="flex h-14 items-center gap-2 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-[1.15]">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {header}
          <EngineSwitch value={engine} onChange={setEngine} />
        </div>
      </header>
      {tabs}
    </div>
  );
}

function StudioBody({ header, tabs }: { header?: React.ReactNode; tabs?: React.ReactNode }) {
  // Config and actions only: the draft lives in the composer, so typing doesn't re-render the page or the feed.
  const { config, setDraft } = useStudioActions();
  const [engine, setEngine] = useEngine();
  const feed = useGenerations(config.feed);
  const bridge = useComposerBridge();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const items = feed.data ?? EMPTY;
  // While the feed loads (and in the prerendered shell) the page shows the hero and the composer, never a blank area.
  const hasItems = items.length > 0;
  const offscreen = useOffscreenResults(feed.data);

  const reuse = useCallback(
    (g: Generation) => {
      setDraft(draftFromGeneration(g, config));
      if (g.engine !== engine) setEngine(g.engine);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")?.focus());
    },
    [config, engine, setDraft, setEngine],
  );

  return (
    <div
      className="relative flex min-h-svh min-w-0 flex-col"
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
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        if (bridge?.current) bridge.current(files);
        else toast("Drop it on the composer");
      }}
    >
      <StudioHeader title={config.title} header={header} tabs={tabs} />

      <main className={cn("mx-auto w-full max-w-[1240px] min-w-0 px-3 sm:px-6", hasItems && "flex-1 pb-8")}>
        {hasItems ? (
          <div className="pt-4">
            <Feed items={items} onReuse={reuse} />
          </div>
        ) : (
          <div className="flex flex-col items-center pt-[16vh] text-center">
            <h2 className="font-heading text-display text-balance">{config.hero}</h2>
            {config.subtitle && <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{config.subtitle}</p>}
          </div>
        )}
      </main>

      {/* One composer for both layouts (centred under the hero, docked under the feed), so it keeps focus and state when the first result arrives. */}
      <div
        className={cn(
          hasItems
            ? "sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-3 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
            : "px-3 pt-10 sm:px-6",
        )}
      >
          {hasItems && offscreen.count > 0 && (
            <div className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center">
              <button
                onClick={offscreen.jump}
                className="pointer-events-auto inline-flex h-8 animate-pop-in items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background shadow-strong transition hover:opacity-90"
              >
                {offscreen.working ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {offscreen.working ? `${offscreen.working} generating` : `${offscreen.count} new result${offscreen.count === 1 ? "" : "s"}`}
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          )}
        <div data-composer className={cn("mx-auto w-full", hasItems ? "max-w-[800px]" : "max-w-[760px]")}>
          <Composer docked={hasItems} />
        </div>
      </div>

      {!hasItems && config.suggestions && (
        <div className="mx-auto mt-4 flex max-w-[760px] flex-wrap justify-center gap-2 px-3 pb-10">
          {config.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setDraft({ prompt: s })}
              className="h-8 max-w-full truncate rounded-full border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s.length > 48 ? `${s.slice(0, 46)}…` : s}
            </button>
          ))}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-overlay p-8">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background px-12 py-10 shadow-heavy">
            <Upload className="size-6 text-brand-text" />
            <p className="font-medium">Drop to attach</p>
            <p className="text-[13px] text-muted-foreground">Images, videos or audio · up to 200 MB</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface StudioPageProps {
  config: StudioConfig;
  /**
   * The models this studio needs, from the server (`studioCatalog(config)` in a server
   * component). Without it the page loads the catalog chunk itself.
   */
  catalog?: StudioCatalog;
  /** Extra header controls, left of the engine switch. */
  header?: React.ReactNode;
  /** A row under the header (mode tabs). */
  tabs?: React.ReactNode;
  initialRefs?: string[];
  /** Prompt to start with when the URL doesn't carry one (e.g. "@Maya "). */
  initialPrompt?: string;
}

type DraftProps = Omit<StudioPageProps, "catalog"> & { sp: URLSearchParams | null };

/** The studio for one set of URL params (null: the static shell, rendered before the URL is known). */
function StudioDraft({ config, sp, header, tabs, initialRefs, initialPrompt }: DraftProps) {
  const [engine] = useEngine();
  const catalog = useCatalog();
  const bridge = useMemo<ComposerBridge>(() => ({ current: null }), []);
  // Recompute the initial draft only when the handoff params change (or a client-side catalog arrives).
  const key = sp?.toString() ?? "";
  const initial = useMemo(() => {
    const d = initialDraft(config, new URLSearchParams(key), engine, catalog);
    if (initialRefs?.length) d.refs = [...initialRefs.map((u) => slot(u)!), ...d.refs];
    if (initialPrompt && !d.prompt) d.prompt = initialPrompt;
    return d;
  }, [config, key, catalog.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ComposerBridgeCtx.Provider value={bridge}>
      <StudioProvider key={`${key}|${catalog.ready}`} config={config} initial={initial}>
        <StudioBody header={header} tabs={tabs} />
      </StudioProvider>
    </ComposerBridgeCtx.Provider>
  );
}

function StudioFromUrl(props: Omit<DraftProps, "sp">) {
  const sp = useSearchParams();
  return <StudioDraft {...props} sp={sp} />;
}

/**
 * A studio page: header, hero, composer and feed. The URL (hand-off params) is read under
 * Suspense; its fallback is the same studio with a default draft, so the prerendered HTML already
 * holds the title, the hero and a composer instead of an empty main area.
 */
export function StudioPage({ catalog, ...props }: StudioPageProps) {
  return (
    <CatalogProvider catalog={catalog} config={props.config}>
      <Suspense fallback={<StudioDraft {...props} sp={null} />}>
        <StudioFromUrl {...props} />
      </Suspense>
    </CatalogProvider>
  );
}
