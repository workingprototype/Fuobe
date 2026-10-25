"use client";

import { Box, Clapperboard, Download, PersonStanding, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { createElement, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadFile, useHydrated } from "@/lib/api";
import { animateSpinHref, animationName, model3dView, type Model3dView } from "@/lib/av/model3d";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import type { Model3dInfo } from "./model3d-studio";
import { RigDialog } from "./rig-dialog";
import { recordableType, recordTurntable } from "./turntable";

/** Downloads besides the main file, by the name the provider gave them. */
const FORMAT_LABEL: Record<string, string> = { rigged: "Rigged .glb", walking: "Walk .glb", running: "Run .glb", fbx: ".fbx", splat: "Splat" };
const formatLabel = (k: string) => FORMAT_LABEL[k] ?? `.${k}`;

/** What the viewer shows of a rig: the result itself, or one of Meshy's walk and run cycles. */
function rigClips(g: Generation, view: Model3dView): { key: string; label: string; url: string }[] {
  if (!view.rigged || !view.glb) return [];
  const animation = g.request.params?.animation;
  const main = view.animated ? (typeof animation === "number" ? animationName(animation) : "Animation") : "Rigged";
  return [
    { key: "main", label: main, url: view.glb },
    ...(["walking", "running"] as const).filter((k) => view.formats[k]).map((k) => ({ key: k, label: k === "walking" ? "Walk" : "Run", url: view.formats[k] })),
  ];
}

/**
 * A finished 3D model: the GLB in an orbitable viewer (playing its animation when it has one), or a splat as its
 * orbit video or preview with the file to download; the turntable, Animate the spin and Rig & animate.
 */
export function ModelCard({ g, info, cloudAllowed }: { g: Generation; info: Record<string, Model3dInfo>; cloudAllowed: boolean }) {
  const view = model3dView(g);
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<{ url: string; saved?: string } | null>(null);
  const [rigging, setRigging] = useState(false);
  const hydrated = useHydrated();
  const canRecord = hydrated && !!recordableType();
  useEffect(() => {
    if (!view.glb) return;
    let live = true;
    import("@google/model-viewer").then(
      () => live && setReady(true),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [view.glb]);
  // The recorded clip's blob URL lives until another recording replaces it (saving it doesn't change it).
  const recordedUrl = recorded?.url;
  useEffect(() => () => void (recordedUrl && URL.revokeObjectURL(recordedUrl)), [recordedUrl]);
  // The turntable that came with the model (TRELLIS.2, TripoSplat, demo) or the one recorded here, shown in place of the 3D view.
  const clip = view.turntable ?? recordedUrl;
  // A splat opens on its orbit video when it has one (the page doesn't draw splats).
  const [show, setShow] = useState<"3d" | "video">(view.splat && view.turntable ? "video" : "3d");
  const clips = rigClips(g, view);
  const [clipKey, setClipKey] = useState("main");
  const src = clips.find((c) => c.key === clipKey)?.url ?? view.glb;
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
  const spin = view.rigged ? null : animateSpinHref(view, recorded?.saved);
  const name = (g.modelName ?? "model").replace(/[^\w .-]+/g, "");
  const notices = info[g.modelId]?.licence?.notices ?? [];
  // A rigged result rigs its source model again with another animation.
  const rigSource = view.rigged ? (g.request.inputs?.model3d ?? view.glb) : view.glb;
  const splatPicture = view.splat && !(show === "video" && clip);
  return (
    <article className="overflow-hidden rounded-2xl border bg-background shadow-soft">
      <div className="relative aspect-[4/3] bg-[radial-gradient(circle_at_50%_40%,var(--muted),var(--background))]">
        {show === "video" && clip ? (
          <video src={clip} controls loop muted playsInline autoPlay preload="metadata" aria-label={`Turntable of the ${g.modelName ?? "3D"} model`} className="size-full bg-media object-contain" />
        ) : splatPicture ? (
          view.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.poster} alt="The subject the splat was made from, cut out" className="size-full object-contain p-4" />
          ) : (
            <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">
              <div>
                <Box className="mx-auto mb-2 size-8" aria-hidden />
                Gaussian splat ready — download it below.
              </div>
            </div>
          )
        ) : failed ? (
          <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the 3D viewer — download the .glb to open it.</div>
        ) : !ready || !src ? (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Box className="size-8 animate-pulse" aria-hidden />
          </div>
        ) : (
          createElement("model-viewer", {
            key: src,
            ref: setViewer,
            src,
            poster: view.poster,
            alt: `3D model made with ${g.modelName ?? "a 3D model"}`,
            "camera-controls": "",
            // A character that moves plays its animation; a still model turns.
            ...(view.rigged ? { autoplay: "" } : { "auto-rotate": "" }),
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
        {(clip || clips.length > 1) && recording === null && (
          <div role="radiogroup" aria-label="Show" className="absolute top-3 right-3 inline-flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end rounded-full bg-background/85 p-0.5 shadow-soft backdrop-blur">
            {clips.length > 1
              ? clips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={show === "3d" && clipKey === c.key}
                    onClick={() => {
                      setShow("3d");
                      setClipKey(c.key);
                    }}
                    className={cn("h-6 max-w-32 truncate rounded-full px-2.5 text-[11px] font-medium transition", show === "3d" && clipKey === c.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                  >
                    {c.label}
                  </button>
                ))
              : (["3d", "video"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={show === v}
                    onClick={() => setShow(v)}
                    className={cn("h-6 rounded-full px-2.5 text-[11px] font-medium transition", show === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                  >
                    {v === "3d" ? (view.splat ? "Preview" : "3D") : "Turntable"}
                  </button>
                ))}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-[13px] text-muted-foreground">
          {g.modelName}
          {g.prompt && !view.rigged ? ` · ${g.prompt}` : ""}
        </p>
        {view.splat && (
          <p className="text-[12px] text-muted-foreground">
            Fuobe doesn&apos;t draw splats yet: {clip ? "the turntable shows it turning" : "the picture is what the model saw"}. Open the .{view.splat.format} in a Gaussian-splat viewer (SuperSplat, for one) to look around it.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {view.splat ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={view.splat.url} download={`${name}.${view.splat.format}`}>
                <Download className="size-3.5" /> .{view.splat.format}
              </a>
            </Button>
          ) : (
            view.glb && (
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <a href={view.glb} download={`${name}.glb`}>
                  <Download className="size-3.5" /> .glb
                </a>
              </Button>
            )
          )}
          {Object.entries(view.formats)
            .filter(([k]) => k !== "glb")
            .slice(0, 4)
            .map(([k, url]) => (
              <Button key={k} asChild variant="ghost" size="sm" className="rounded-full">
                <a href={url} download>
                  {formatLabel(k)}
                </a>
              </Button>
            ))}
          {clip ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={clip} download={`${name} turntable.${view.turntable ? "mp4" : "webm"}`} aria-label="Download the turntable video">
                <Video className="size-3.5" /> Turntable
              </a>
            </Button>
          ) : (
            view.glb &&
            !view.rigged && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={record} disabled={!ready || !canRecord || recording !== null}>
                <Clapperboard className="size-3.5" /> Record turntable
              </Button>
            )
          )}
          {rigSource && !view.splat && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setRigging(true)}>
              <PersonStanding className="size-3.5" /> {view.rigged ? "Another animation" : "Rig & animate"}
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
        {notices.length > 0 && <p className="text-[11px] text-muted-foreground">{notices.join(" · ")}</p>}
      </div>
      {rigSource && rigging && <RigDialog glb={rigSource} open={rigging} onOpenChange={setRigging} cloudAllowed={cloudAllowed} />}
    </article>
  );
}
