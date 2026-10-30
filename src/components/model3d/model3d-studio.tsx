"use client";

import { Box, Clapperboard, Download, Loader2, Pause, Play, Rotate3d, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FailedTile, PendingTile } from "@/components/studio/feed";
import type { SlotValue } from "@/components/studio/media-slot";
import { MediaDrop } from "@/components/av/media-drop";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { uploadFile, useCreateGeneration, useEngine, useGenerations, useHydrated } from "@/lib/api";
import { animateSpinHref, model3dRequest, model3dView, MODEL3D_FEATURE, MODELS_3D } from "@/lib/av/model3d";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { loadModelViewer, TURNTABLE_BACKDROP, useViewerSrc, viewerLook } from "./model-viewer";
import { recordableType, recordTurntable } from "./turntable";

/** Image to 3D / Product spin: a product photo → a .glb to spin and download, a turntable video, and on to a video. */
export function Model3dStudio({ names }: { names: Record<string, string> }) {
  const [engine] = useEngine();
  const create = useCreateGeneration();
  const results = useGenerations({ features: [MODEL3D_FEATURE, "app:app-image-to-3d"], limit: 24 });
  const [photo, setPhoto] = useState<SlotValue | null>(null);
  const [picked, setPicked] = useState<Partial<Record<"cloud" | "open", string>>>({});
  const modelId = picked[engine] ?? MODELS_3D[engine][0].id;
  const blocker = !photo ? "Add a product photo" : photo.uploading ? "Uploading…" : null;
  const go = () => {
    if (blocker) return void toast(blocker, { id: "3d-blocker" });
    create.mutate(model3dRequest({ engine, photo: photo!.ref, modelId }), {
      onSuccess: () => toast.success("Building your 3D model"),
      onError: (e) => toast.error((e as Error).message),
    });
  };
  const items = results.data ?? [];
  return (
    <ToolShell title="Image to 3D">
      <ToolHero title="Your product, in 3D" subtitle="One clear photo → a textured 3D model (.glb) you can spin, download, record as a turntable and turn into a video." />
      <div className="mx-auto mt-8 grid max-w-[880px] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MediaDrop kind="image" value={photo} onChange={setPhoto} title="Add a product photo" hint="One object, plain background, well lit" compact />
        <Panel title="Model">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m3d-model" className="sr-only">
              Model
            </Label>
            <Select value={modelId} onValueChange={(v) => setPicked((p) => ({ ...p, [engine]: v }))}>
              <SelectTrigger id="m3d-model" className="h-9 w-full rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS_3D[engine].map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {names[m.id] ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">{MODELS_3D[engine].find((m) => m.id === modelId)?.note}</p>
          </div>
          <Button size="lg" className={cn("mt-4 w-full rounded-full", blocker && "bg-muted text-subtle-foreground hover:bg-muted")} onClick={go} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />} Make it 3D
          </Button>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {engine === "open" ? "Open models also get a turntable video, rendered after the model is made." : "Cloud models return the .glb; record a turntable right here in your browser."}
          </p>
        </Panel>
      </div>
      <section className="mx-auto mt-12 max-w-[880px]" aria-labelledby="models3d">
        {(results.isLoading || items.length > 0) && (
          <h3 id="models3d" className="mb-3 font-heading text-[22px]">
            Your 3D models
          </h3>
        )}
        {results.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="aspect-[4/3] rounded-2xl" />
            <Skeleton className="aspect-[4/3] rounded-2xl" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((g) => (
              <ResultCard key={g.id} g={g} />
            ))}
          </div>
        )}
      </section>
    </ToolShell>
  );
}

function ResultCard({ g }: { g: Generation }) {
  const create = useCreateGeneration();
  if (g.status === "queued" || g.status === "running") return <PendingTile g={g} ratio={4 / 3} />;
  if (g.status !== "succeeded") return <FailedTile g={g} ratio={4 / 3} onRetry={() => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) })} />;
  return <ModelCard g={g} />;
}

function ModelCard({ g }: { g: Generation }) {
  const view = model3dView(g);
  // The card plays the turntable (or shows the poster); the 3D viewer, and its GLB, load only when it's opened.
  const [show, setShow] = useState<"preview" | "3d">("preview");
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedEl, setLoadedEl] = useState<HTMLElement | null>(null);
  const loaded = !!viewer && loadedEl === viewer;
  const [recording, setRecording] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<{ url: string; saved?: string } | null>(null);
  const pendingRecord = useRef(false);
  // "View in 3D" unmounts itself: focus moves to the viewer once it's there.
  const focusViewer = useRef(false);
  const hydrated = useHydrated();
  const canRecord = hydrated && !!recordableType();
  const open3d = show === "3d";
  const src = useViewerSrc(viewer, view.web, view.glb);
  const onOriginal = src === view.glb;
  useEffect(() => {
    if (!open3d) return;
    let live = true;
    loadModelViewer().then(
      () => live && setReady(true),
      () => {
        if (!live) return;
        pendingRecord.current = false;
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [open3d]);
  // The recorded clip's blob URL lives until another recording replaces it (saving it doesn't change it).
  const recordedUrl = recorded?.url;
  useEffect(() => () => void (recordedUrl && URL.revokeObjectURL(recordedUrl)), [recordedUrl]);
  // The turntable the server rendered (open models, demo) or the one recorded here.
  const clip = view.turntable ?? recordedUrl;
  const still = view.poster ?? view.photo;
  const name = (g.modelName ?? "model").replace(/[^\w .-]+/g, "");
  const label = g.modelName ?? "3D";
  // Behind the viewer: the studio sweep the server's turntable and poster are on, so opening 3D doesn't jump.
  const backdrop = view.material ? TURNTABLE_BACKDROP : undefined;
  const startRecording = useCallback(
    async (el: HTMLElement) => {
      setRecording(0);
      try {
        const blob = await recordTurntable(el as Parameters<typeof recordTurntable>[0], { onProgress: setRecording });
        const url = URL.createObjectURL(blob);
        setRecorded({ url });
        // Keep it in the Library (Uploads) so it can go on to Edit video.
        const asset = await uploadFile(new File([blob], `${name} turntable.webm`, { type: "video/webm" }));
        setRecorded({ url, saved: asset.url });
        toast.success("Turntable recorded — saved to your uploads");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setRecording(null);
      }
    },
    [name],
  );
  useEffect(() => {
    if (!viewer) return;
    if (focusViewer.current) {
      focusViewer.current = false;
      // Its keyboard-focusable part (camera controls) is inside the shadow root.
      (viewer.shadowRoot?.querySelector<HTMLElement>(".userInput") ?? viewer).focus({ preventScroll: true });
    }
    const onLoad = () => {
      setLoadedEl(viewer);
      if (pendingRecord.current) {
        pendingRecord.current = false;
        void startRecording(viewer);
      }
    };
    // A model that can't load won't record either. (A web GLB that fails falls back to the original first.)
    const onError = () => void (onOriginal && (pendingRecord.current = false));
    viewer.addEventListener("load", onLoad);
    viewer.addEventListener("error", onError);
    return () => {
      viewer.removeEventListener("load", onLoad);
      viewer.removeEventListener("error", onError);
    };
  }, [viewer, startRecording, onOriginal]);
  const switchTo = (v: "preview" | "3d") => {
    // A recording asked for before the model loaded is off once the 3D view is closed.
    if (v === "preview") pendingRecord.current = false;
    setShow(v);
  };
  // Recording needs the 3D view: open it and start once the model has loaded.
  const record = () => {
    if (viewer && loaded) return void startRecording(viewer);
    pendingRecord.current = true;
    setShow("3d");
  };
  const spin = animateSpinHref(view, recorded?.saved);
  const placeholder = still ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={still} alt={`The ${label} model`} loading="lazy" decoding="async" className="size-full object-contain" />
  ) : (
    <div className="grid size-full place-items-center text-muted-foreground">
      <Box className="size-8" />
    </div>
  );
  return (
    <article className="overflow-hidden rounded-2xl border bg-background shadow-soft">
      <div className="relative aspect-[4/3] bg-[radial-gradient(circle_at_50%_40%,var(--muted),var(--background))]" style={open3d && backdrop ? { background: backdrop } : undefined}>
        {!open3d ? (
          <>
            {clip ? <TurntableLoop src={clip} poster={still} label={`Turntable of the ${label} model`} /> : placeholder}
            {view.glb && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-soft"
                onClick={() => {
                  focusViewer.current = true;
                  switchTo("3d");
                }}
              >
                <Rotate3d className="size-3.5" /> View in 3D
              </Button>
            )}
          </>
        ) : failed ? (
          <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the 3D viewer — download the .glb to open it.</div>
        ) : !ready || !src ? (
          // The poster (or the photo) while the viewer loads: the same picture the viewer starts from.
          <div className="relative size-full" role="status" aria-label="Loading the 3D viewer">
            {placeholder}
            <Loader2 className="absolute right-3 bottom-3 size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          createElement("model-viewer", {
            ref: setViewer,
            src,
            poster: still,
            alt: `3D model made with ${g.modelName ?? "a 3D model"}`,
            loading: "lazy",
            reveal: "auto",
            "camera-controls": "",
            "auto-rotate": "",
            "touch-action": "pan-y",
            "interaction-prompt": "none",
            ...viewerLook(view.material),
            style: { width: "100%", height: "100%", background: "transparent" },
          })
        )}
        {recording !== null && (
          <div className="absolute inset-x-3 bottom-3 rounded-full bg-background/90 px-3 py-1.5 text-[12px] font-medium shadow-soft" role="status">
            Recording the turntable… {Math.round(recording * 100)}%
          </div>
        )}
        {g.provider === "mock" && <span className="absolute top-3 left-3 rounded-full bg-highlight/40 px-2 py-0.5 text-[11px] font-medium">Demo</span>}
        {view.glb && recording === null && (
          <div role="radiogroup" aria-label="Show" className="absolute top-3 right-3 inline-flex rounded-full bg-background/85 p-0.5 shadow-soft backdrop-blur">
            {(["preview", "3d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={show === v}
                onClick={() => switchTo(v)}
                className={cn("h-6 rounded-full px-2.5 text-[11px] font-medium transition", show === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "3d" ? "3D" : clip ? "Turntable" : "Preview"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-[13px] text-muted-foreground">{g.modelName}</p>
        <div className="flex flex-wrap gap-1.5">
          {view.glb && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={view.glb} download={`${name}.glb`}>
                <Download className="size-3.5" /> .glb
              </a>
            </Button>
          )}
          {Object.entries(view.formats)
            .filter(([k]) => k !== "glb")
            .slice(0, 3)
            .map(([k, url]) => (
              <Button key={k} asChild variant="ghost" size="sm" className="rounded-full">
                <a href={url} download>
                  .{k}
                </a>
              </Button>
            ))}
          {clip ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={clip} download={`${name} turntable.${view.turntable ? "mp4" : "webm"}`} aria-label="Download the turntable video">
                <Video className="size-3.5" /> Turntable
              </a>
            </Button>
          ) : view.rendering ? (
            // The server renders it after the job (one at a time): it shows up here when it's done.
            <Button variant="outline" size="sm" className="rounded-full" disabled>
              <Loader2 className="size-3.5 animate-spin" /> {view.rendering.queued ? "Turntable queued" : `Rendering turntable… ${Math.round(view.rendering.progress * 100)}%`}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="rounded-full" onClick={record} disabled={!view.glb || !canRecord || recording !== null || failed}>
              <Clapperboard className="size-3.5" /> Record turntable
            </Button>
          )}
          {spin && (
            <Button asChild size="sm" className="rounded-full">
              <Link href={spin} prefetch={false}>
                <Sparkles className="size-3.5" /> Animate the spin
              </Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the user prefers reduced motion (true until hydrated, so nothing moves before it's known). */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
}

/**
 * A card's turntable loop: it loads and plays only while the card is on screen, not at all when the user
 * prefers reduced motion (the poster shows instead), and has a pause / play button (WCAG 2.2.2).
 */
function TurntableLoop({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();
  // What the user chose with the button; until then, play unless they prefer reduced motion.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const wanted = choice ? choice === "play" : !reduced;
  const playing = visible && wanted;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing]);
  return (
    <>
      <video ref={ref} src={src} poster={poster} loop muted playsInline preload="none" aria-label={label} className="size-full bg-media object-contain" />
      <button
        type="button"
        onClick={() => setChoice(wanted ? "pause" : "play")}
        aria-label={wanted ? "Pause the turntable" : "Play the turntable"}
        className="absolute right-3 bottom-3 grid size-7 place-items-center rounded-full bg-background/85 text-foreground shadow-soft backdrop-blur transition hover:bg-background"
      >
        {wanted ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    </>
  );
}
