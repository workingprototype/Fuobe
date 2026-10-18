"use client";

import { Box, Clapperboard, Download, Loader2, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { createElement, useEffect, useState } from "react";
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
            {engine === "open" ? "TRELLIS.2 also renders a turntable video on your GPU." : "Cloud models return the .glb; record a turntable right here in your browser."}
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
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<{ url: string; saved?: string } | null>(null);
  const hydrated = useHydrated();
  const canRecord = hydrated && !!recordableType();
  useEffect(() => {
    let live = true;
    import("@google/model-viewer").then(
      () => live && setReady(true),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => void (recorded && URL.revokeObjectURL(recorded.url)), [recorded]);
  const record = async () => {
    if (!viewer) return;
    setRecording(0);
    try {
      const blob = await recordTurntable(viewer as Parameters<typeof recordTurntable>[0], { onProgress: setRecording });
      const url = URL.createObjectURL(blob);
      setRecorded({ url });
      // Keep it in the Library (Uploads) so it can go on to Edit video.
      const asset = await uploadFile(new File([blob], `${g.modelName ?? "model"} turntable.webm`, { type: "video/webm" }));
      setRecorded({ url, saved: asset.url });
      toast.success("Turntable recorded — saved to your uploads");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRecording(null);
    }
  };
  const spin = animateSpinHref(view, recorded?.saved);
  const name = (g.modelName ?? "model").replace(/[^\w .-]+/g, "");
  return (
    <article className="overflow-hidden rounded-2xl border bg-background shadow-soft">
      <div className="relative aspect-[4/3] bg-[radial-gradient(circle_at_50%_40%,var(--muted),var(--background))]">
        {failed ? (
          <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the 3D viewer — download the .glb to open it.</div>
        ) : !ready || !view.glb ? (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Box className="size-8 animate-pulse" />
          </div>
        ) : (
          createElement("model-viewer", {
            ref: setViewer,
            src: view.glb,
            poster: view.poster,
            alt: `3D model made with ${g.modelName ?? "a 3D model"}`,
            "camera-controls": "",
            "auto-rotate": "",
            "shadow-intensity": "1",
            exposure: "1",
            "touch-action": "pan-y",
            "interaction-prompt": "none",
            style: { width: "100%", height: "100%", background: "transparent" },
          })
        )}
        {recording !== null && (
          <div className="absolute inset-x-3 bottom-3 rounded-full bg-background/90 px-3 py-1.5 text-[12px] font-medium shadow-soft" role="status">
            Recording the turntable… {Math.round(recording * 100)}%
          </div>
        )}
        {g.provider === "mock" && <span className="absolute top-3 left-3 rounded-full bg-highlight/40 px-2 py-0.5 text-[11px] font-medium">Demo</span>}
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
          {view.turntable ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={view.turntable} download={`${name} turntable.mp4`}>
                <Video className="size-3.5" /> Turntable
              </a>
            </Button>
          ) : recorded ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={recorded.url} download={`${name} turntable.webm`}>
                <Video className="size-3.5" /> Turntable
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="rounded-full" onClick={record} disabled={!ready || !canRecord || recording !== null}>
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
        {view.turntable && <video src={view.turntable} muted loop playsInline autoPlay className="hidden" aria-hidden />}
      </div>
    </article>
  );
}
