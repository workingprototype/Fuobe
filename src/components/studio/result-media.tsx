"use client";

import { AudioLines, Box, FileText, Layers } from "lucide-react";
import { createElement, useEffect, useState } from "react";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { cuesOf, cueTime, isLayered, layerInfo, modelPreview, textOf } from "@/lib/output-actions";
import { cn } from "@/lib/utils";

/** Any result as a tile picture: image, video (plays on hover), audio, text card, 3D preview. */
export function MediaThumb({
  output,
  g,
  className,
  autoPlay,
  fit,
  tag,
  inset,
}: {
  output: OutputFile;
  /** The generation it belongs to (3D models show a sibling turntable or poster). */
  g?: Pick<Generation, "outputs">;
  className?: string;
  autoPlay?: boolean;
  /** Letterbox instead of crop (Library "Fit"). */
  fit?: boolean;
  /** A small badge ("Demo") a text card shows in its own header row, where it can't cover the label. */
  tag?: string;
  /** Room at the end of a text card's header for a control in the tile's top-right corner (the feed's ⋯ or heart). */
  inset?: boolean;
}) {
  const object = fit ? "object-contain" : "object-cover";
  if (output.kind === "video") {
    return (
      <video
        src={`${output.url}#t=0.1`}
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
        onMouseLeave={(e) => {
          if (!autoPlay) e.currentTarget.pause();
        }}
        className={cn("size-full", object, className)}
      />
    );
  }
  if (output.kind === "audio") {
    return (
      <div className={cn("flex size-full flex-col items-center justify-center gap-3 bg-brand-faint p-4 text-brand-text", className)}>
        <AudioLines className="size-8" />
        <audio src={output.url} controls className="w-full max-w-64" onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
  if (output.kind === "text") return <TextPreview output={output} className={className} tag={tag} inset={inset} />;
  if (output.kind === "model3d") {
    const { poster, video } = modelPreview(g ?? { outputs: [output] }, output);
    if (video) return <MediaThumb output={{ url: video, kind: "video" }} autoPlay={autoPlay} fit={fit} className={className} />;
    return (
      <div className={cn("relative flex size-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground", className)}>
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 size-full", object)} />
        ) : (
          <>
            <Box className="size-8" />
            <span className="text-[12px] font-medium">3D model</span>
          </>
        )}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={output.url} alt="" loading="lazy" decoding="async" className={cn("size-full", object, className)} />;
}

/** A 56 px thumbnail for list rows: media where it reads at that size, an icon where it doesn't. */
export function SmallThumb({ g, output }: { g: Generation; output: OutputFile }) {
  if (output.kind === "audio" || output.kind === "text") {
    const Icon = output.kind === "audio" ? AudioLines : FileText;
    return (
      <div className="grid size-full place-items-center bg-brand-faint text-brand-text">
        <Icon className="size-5" />
      </div>
    );
  }
  if (isLayered(g)) return <LayersStack g={g} bare />;
  return <MediaThumb output={output} g={g} />;
}

/** A transcript, translation or script as a readable card: the first lines and a cue count. */
export function TextPreview({ output, className, tag, inset }: { output: OutputFile; className?: string; tag?: string; inset?: boolean }) {
  const cues = cuesOf(output);
  const text = textOf(output).trim();
  return (
    // A size container: on a narrow tile (a phone's three-column grid) the header drops its icon to keep the label readable.
    <div className={cn("@container flex size-full flex-col gap-2 bg-card p-4 text-left", className)}>
      <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase", inset && "pr-7")}>
        <FileText className="size-3.5 shrink-0 @max-[8rem]:hidden" />
        <span className="min-w-0 flex-1 truncate">{cues.length ? `Transcript · ${cues.length} lines` : "Text"}</span>
        {tag && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tracking-normal text-foreground normal-case">{tag}</span>}
      </span>
      <p className="line-clamp-[8] min-h-0 flex-1 overflow-hidden text-[13px] leading-relaxed break-words whitespace-pre-line text-foreground">{text || "Empty"}</p>
    </div>
  );
}

/** The full text, with cue timings when there are any (viewer). */
export function TextReader({ output }: { output: OutputFile }) {
  const cues = cuesOf(output);
  if (!cues.length) {
    return <div className="size-full overflow-y-auto p-6 text-body leading-relaxed whitespace-pre-wrap text-foreground sm:p-10">{textOf(output) || "Empty"}</div>;
  }
  return (
    <ol className="size-full space-y-1 overflow-y-auto p-4 sm:p-8">
      {cues.map((c, i) => (
        <li key={i} className="grid grid-cols-[auto_1fr] gap-x-4 rounded-lg px-2 py-1.5 hover:bg-accent">
          <span className="pt-0.5 font-mono text-[12px] text-muted-foreground tabular-nums">
            {cueTime(c.start)} – {cueTime(c.end)}
          </span>
          <span className="text-body leading-relaxed">{c.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Layers of one picture as a stack: the composite on a checkerboard and the layer names. */
export function LayersStack({ g, className, bare }: { g: Generation; className?: string; bare?: boolean }) {
  const layers = g.outputs.map((o, i) => ({ o, ...layerInfo(o, i) })).sort((a, b) => a.z - b.z);
  const composite = (
    <div className="checkerboard absolute inset-0">
      {layers.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={l.o.url} src={l.o.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-contain" />
      ))}
    </div>
  );
  if (bare) return <div className={cn("relative size-full overflow-hidden", className)}>{composite}</div>;
  return (
    <div className={cn("relative size-full overflow-hidden", className)}>
      {composite}
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-black/55 px-2 text-[11px] font-medium text-white backdrop-blur">
          <Layers className="size-3" /> {layers.length} layers
        </span>
      </div>
      <ul className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
        {[...layers].reverse().slice(0, 4).map((l) => (
          <li key={l.o.url} className="max-w-32 truncate rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
            {l.name}
          </li>
        ))}
        {layers.length > 4 && <li className="rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur">+{layers.length - 4}</li>}
      </ul>
    </div>
  );
}

/** A .glb in an orbitable viewer. @google/model-viewer (with three.js) loads only when one is opened. */
export function ModelViewer({ output, g }: { output: OutputFile; g: Generation }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
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
  const { poster } = modelPreview(g, output);
  if (failed) return <p className="text-[13px] text-white/80">Couldn&apos;t load the 3D viewer. Download the .glb to open it.</p>;
  if (!ready) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/80">
        <Box className="size-8 animate-pulse" />
        <span className="text-[13px]">Loading 3D viewer…</span>
      </div>
    );
  }
  return createElement("model-viewer", {
    src: output.url,
    poster,
    alt: g.request.prompt || "3D model",
    "camera-controls": "",
    "auto-rotate": "",
    "shadow-intensity": "1",
    exposure: "1",
    "touch-action": "pan-y",
    style: { width: "100%", height: "100%", background: "transparent" },
  });
}
