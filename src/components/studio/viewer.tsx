"use client";

import { ChevronLeft, ChevronRight, Clapperboard, Columns2, Copy, Download, Heart, RotateCcw, Trash2, Wand2, X, ZoomIn } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { getModel, getPreset } from "@/lib/catalog";
import { OPERATION_LABELS, type Generation } from "@/lib/catalog/types";
import { useGenerationActions } from "@/lib/api";
import { formatCost, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompareSlider } from "./compare-slider";
import { downloadName } from "./feed";

function Row({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export function Viewer({
  generation: g,
  index,
  onClose,
  onPrev,
  onNext,
  onReuse,
}: {
  generation: Generation;
  index: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onReuse?: (g: Generation) => void;
}) {
  const { favorite, remove } = useGenerationActions();
  const o = g.outputs[index];
  const model = getModel(g.modelId);
  const preset = g.presetId ? getPreset(g.presetId) : undefined;
  const p = g.request.params ?? {};
  const dl = `${o.url}?download=${encodeURIComponent(downloadName(g, o, index))}`;
  // Edits, inpaints, upscales and app results can be compared with the image they started from.
  const source = o.kind === "image" && g.op !== "t2i" ? g.request.inputs?.images?.[0] : undefined;
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
      else if (e.key.toLowerCase() === "f") void favorite(g);
      else if (e.key.toLowerCase() === "c" && source) setComparing((v) => !v);
      else if (e.key.toLowerCase() === "d") {
        const a = document.createElement("a");
        a.href = dl;
        a.click();
      }
      else if (e.key.toLowerCase() === "r" && onReuse) {
        onReuse(g);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, favorite, g, dl, onReuse, onClose, source]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92vh,900px)] w-[min(96vw,1400px)] max-w-none gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{g.prompt ?? "Generation"}</DialogTitle>
        <DialogDescription className="sr-only">Preview and details</DialogDescription>
        <div className="relative flex min-w-0 flex-1 items-center justify-center bg-media">
          {o.kind === "video" ? (
            <video key={o.url} src={o.url} controls autoPlay loop playsInline className="max-h-full max-w-full" />
          ) : o.kind === "audio" ? (
            <audio key={o.url} src={o.url} controls autoPlay className="w-2/3" />
          ) : comparing && source ? (
            <CompareSlider before={source} after={o.url} alt={g.prompt ?? ""} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={o.url} src={o.url} alt={g.prompt ?? ""} className="max-h-full max-w-full object-contain" />
          )}
          {source && (
            <button
              onClick={() => setComparing((v) => !v)}
              className={cn(
                "absolute bottom-4 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium backdrop-blur transition-colors",
                comparing ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25",
              )}
            >
              <Columns2 className="size-4" /> {comparing ? "Hide original" : "Compare"}
            </button>
          )}
          {onPrev && (
            <button onClick={onPrev} aria-label="Previous" className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20">
              <ChevronLeft className="size-5" />
            </button>
          )}
          {onNext && (
            <button onClick={onNext} aria-label="Next" className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20">
              <ChevronRight className="size-5" />
            </button>
          )}
        </div>
        <aside className="hidden w-80 shrink-0 flex-col border-l bg-card md:flex">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="text-[12px] text-muted-foreground">{timeAgo(g.createdAt)}</span>
            <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <div>
              <p className="font-heading text-[20px] leading-snug">{g.request.prompt?.trim() || preset?.name || g.prompt}</p>
              {g.prompt && g.prompt !== g.request.prompt?.trim() && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Sent to the model: {g.prompt}</p>}
              {g.prompt && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(g.prompt ?? "");
                    toast("Prompt copied");
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" /> Copy prompt
                </button>
              )}
            </div>
            <div className="divide-y rounded-lg border px-3">
              <Row label="Model" value={model?.name ?? g.modelId} />
              <Row label="Engine" value={g.provider === "mock" ? "Demo" : g.engine === "open" ? "Open source · ComfyUI" : `Cloud · ${g.provider}`} />
              <Row label="Mode" value={OPERATION_LABELS[g.op]} />
              <Row label="Preset" value={preset?.name} />
              <Row label="Aspect ratio" value={p.aspectRatio} />
              <Row label="Quality" value={p.resolution} />
              <Row label="Duration" value={p.duration ? `${p.duration}s` : undefined} />
              <Row label="Seed" value={p.seed} mono />
              <Row label="Cost" value={g.costUsd != null ? formatCost(g.costUsd) : undefined} mono />
            </div>
            {g.request.negativePrompt && <p className="text-[12px] text-muted-foreground">Negative: {g.request.negativePrompt}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t p-3">
            <Button asChild variant="default" size="sm">
              <a href={dl}>
                <Download /> Download
              </a>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void favorite(g)}>
              <Heart className={cn(g.favorite && "fill-current text-highlight")} /> {g.favorite ? "Favorited" : "Favorite"}
            </Button>
            {o.kind === "image" && (
              <>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/video?image=${encodeURIComponent(o.url)}&prompt=${encodeURIComponent("")}`}>
                    <Clapperboard /> Animate
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/edit?image=${encodeURIComponent(o.url)}`}>
                    <Wand2 /> Edit
                  </Link>
                </Button>
              </>
            )}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/upscale?${o.kind === "video" ? "video" : "image"}=${encodeURIComponent(o.url)}`}>
                <ZoomIn /> Upscale
              </Link>
            </Button>
            {onReuse && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onReuse(g);
                  onClose();
                }}
              >
                <RotateCcw /> Reuse
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="col-span-2 text-destructive hover:text-destructive"
              onClick={() => {
                void remove(g);
                onClose();
                toast("Deleted");
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span><Kbd>←</Kbd> <Kbd>→</Kbd> browse</span>
            <span><Kbd>F</Kbd> favorite</span>
            {source && <span><Kbd>C</Kbd> compare</span>}
            <span><Kbd>D</Kbd> download</span>
            {onReuse && <span><Kbd>R</Kbd> reuse</span>}
          </p>
        </aside>
        <button onClick={onClose} className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur md:hidden" aria-label="Close">
          <X className="size-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
