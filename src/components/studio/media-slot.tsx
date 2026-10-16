"use client";

import { AudioLines, FileVideo, ImagePlus, Library, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadFile, useAssets } from "@/lib/api";
import type { MediaKind } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export interface SlotValue {
  /** Client-side identity for list items (references). */
  id?: string;
  /** What the server receives: an /api/files URL (or any URL). */
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
}

const ACCEPT: Record<MediaKind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/mp4,audio/webm",
};

const MAX_MB = 200;

/** Upload a File and stream state changes back (preview first, then server ref). */
export async function fileToSlot(file: File, onChange: (v: SlotValue | null) => void, kind?: MediaKind): Promise<void> {
  const k: MediaKind = kind ?? (file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image");
  if (file.size > MAX_MB * 1024 * 1024) {
    toast.error(`That file's over ${MAX_MB} MB. Try a smaller one.`);
    return;
  }
  const preview = URL.createObjectURL(file);
  onChange({ ref: "", preview, kind: k, name: file.name, uploading: true });
  try {
    const asset = await uploadFile(file);
    onChange({ ref: asset.url, preview: asset.url, kind: asset.kind, name: file.name });
  } catch (e) {
    onChange(null);
    toast.error((e as Error).message || "Upload failed. Please try again.");
  }
}

function KindIcon({ kind, className }: { kind: MediaKind; className?: string }) {
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "audio") return <AudioLines className={className} />;
  return <ImagePlus className={className} />;
}

export function SlotPreview({ value, className }: { value: SlotValue; className?: string }) {
  if (value.kind === "video")
    return <video src={value.preview} muted playsInline loop autoPlay className={cn("size-full object-cover", className)} />;
  if (value.kind === "audio")
    return (
      <div className={cn("grid size-full place-items-center bg-brand-faint text-brand-text", className)}>
        <AudioLines className="size-5" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={value.preview} alt={value.name ?? ""} className={cn("size-full object-cover", className)} />;
}

function LibraryPicker({ kind, onPick }: { kind: MediaKind; onPick: (v: SlotValue) => void }) {
  const [open, setOpen] = useState(false);
  const assets = useAssets(undefined, kind);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-soft transition-opacity group-hover/slot:opacity-100 hover:text-foreground focus-visible:opacity-100"
          aria-label="Choose from library"
          onClick={(e) => e.stopPropagation()}
        >
          <Library className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
        {assets.data?.length ? (
          <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto">
            {assets.data.map((a) => (
              <button
                key={a.id}
                className="aspect-square overflow-hidden rounded-md bg-muted ring-primary transition hover:ring-2"
                onClick={() => {
                  onPick({ ref: a.url, preview: a.url, kind: a.kind, name: a.name ?? undefined });
                  setOpen(false);
                }}
              >
                <SlotPreview value={{ ref: a.url, preview: a.url, kind: a.kind }} />
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A compact attachment tile: empty (dashed, click/drop to upload) or filled (thumbnail + remove). */
export function MediaSlot({
  label,
  kind,
  value,
  onChange,
  required,
  size = "md",
  onFile,
}: {
  label: string;
  kind: MediaKind;
  value: SlotValue | null;
  onChange: (v: SlotValue | null) => void;
  required?: boolean;
  size?: "md" | "lg";
  /** Take over file handling (e.g. to append to a list with a stable id). */
  onFile?: (f: File) => void;
}) {
  const handleFile = (f: File) => (onFile ? onFile(f) : void fileToSlot(f, onChange, kind));
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dim = size === "lg" ? "size-20" : "size-14";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn("group/slot relative shrink-0", dim)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          {value ? (
            <div className="size-full overflow-hidden rounded-xl border bg-muted">
              <SlotPreview value={value} />
              {value.uploading && (
                <div className="absolute inset-0 grid place-items-center rounded-xl bg-background/60">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
              <button
                onClick={() => onChange(null)}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-soft"
                aria-label={`Remove ${label}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className={cn(
                "flex size-full flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-border-strong text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text",
                over && "border-primary bg-brand-faint text-brand-text",
              )}
            >
              {over ? <Upload className="size-4" /> : <KindIcon kind={kind} className="size-4" />}
              <span className="line-clamp-2 max-w-full px-1 text-center text-[10px] leading-[1.1] font-medium">{label}</span>
            </button>
          )}
          {!value && <LibraryPicker kind={kind} onPick={onChange} />}
          <input
            ref={input}
            type="file"
            accept={ACCEPT[kind]}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {required ? " (required)" : " (optional)"} — click, drop or paste
      </TooltipContent>
    </Tooltip>
  );
}
