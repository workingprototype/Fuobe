"use client";

import { ImageUp, Loader2, Plus, Shuffle, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { HARMONIES, harmonyPalette, hslToHex, kmeans, rgbToHex, type Harmony, type RGB } from "./color-math";

interface Point {
  /** 0–1 across the image. */
  x: number;
  y: number;
}

interface Sampled {
  url: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const pixelAt = (img: Sampled, p: Point): RGB => {
  const x = Math.min(img.width - 1, Math.max(0, Math.round(p.x * (img.width - 1))));
  const y = Math.min(img.height - 1, Math.max(0, Math.round(p.y * (img.height - 1))));
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

async function sampleImage(file: File): Promise<Sampled> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  return { url, width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/** k-means centres, then a draggable sample point on the pixel closest to each one. */
function extract(img: Sampled, count: number): Point[] {
  const step = Math.max(1, Math.floor((img.width * img.height) / 5000));
  const px: RGB[] = [];
  const pos: Point[] = [];
  for (let i = 0; i < img.width * img.height; i += step) {
    const o = i * 4;
    px.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
    pos.push({ x: (i % img.width) / Math.max(1, img.width - 1), y: Math.floor(i / img.width) / Math.max(1, img.height - 1) });
  }
  return kmeans(px, count).map((c) => {
    let best = 0;
    let bd = Infinity;
    px.forEach((p, i) => {
      const d = (p[0] - c.rgb[0]) ** 2 + (p[1] - c.rgb[1]) ** 2 + (p[2] - c.rgb[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return pos[best];
  });
}

function FromImage({ onColors }: { onColors: (hex: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<Sampled | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const publish = (im: Sampled, ps: Point[]) => onColors(ps.map((p) => rgbToHex(pixelAt(im, p))));
  const load = async (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("Pick an image file");
    setBusy(true);
    try {
      const s = await sampleImage(f);
      const ps = extract(s, count);
      setImg(s);
      setPoints(ps);
      publish(s, ps);
    } catch {
      toast.error("Couldn't read that image. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
    }
  };
  const move = (e: React.PointerEvent) => {
    if (drag === null || !img || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const p = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    const next = points.map((q, i) => (i === drag ? p : q));
    setPoints(next);
    publish(img, next);
  };

  return (
    <div className="space-y-3">
      {!img ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f);
          }}
          className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-[13px] text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
          {busy ? "Extracting colors from your image…" : "Drop an image or click to upload"}
        </button>
      ) : (
        <div
          ref={box}
          className="relative mx-auto max-h-[42vh] w-fit touch-none overflow-hidden rounded-xl"
          onPointerMove={move}
          onPointerUp={() => setDrag(null)}
          onPointerLeave={() => setDrag(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="block max-h-[42vh] w-auto select-none" draggable={false} />
          {points.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Sample point ${i + 1}`}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                setDrag(i);
              }}
              className={cn("absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow-strong active:cursor-grabbing", i === points.length - 1 && "size-6 ring-2 ring-primary")}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: rgbToHex(pixelAt(img, p)) }}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[12px] text-muted-foreground">Colours</span>
        <Slider
          value={[count]}
          min={3}
          max={12}
          step={1}
          onValueChange={([v]) => setCount(v)}
          onValueCommit={([v]) => {
            if (!img) return;
            const ps = extract(img, v);
            setPoints(ps);
            publish(img, ps);
          }}
          aria-label="Number of colours"
        />
        <span className="w-5 font-mono text-[12px]">{count}</span>
        {img && (
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
            Change image
          </Button>
        )}
      </div>
      {img && <p className="text-[11.5px] text-muted-foreground">Drag the sample points to pick colours; the largest ring is the main colour.</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const WHEEL_BASE = "#c0583a";

function ColorWheel({ onColors }: { onColors: (hex: string[]) => void }) {
  const [base, setBase] = useState(WHEEL_BASE);
  const [harmony, setHarmony] = useState<Harmony>("analogous");
  const [count, setCount] = useState(6);
  const update = (b = base, h = harmony, n = count) => onColors(harmonyPalette(b, h, n));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input type="color" value={base} onChange={(e) => {
            setBase(e.target.value);
            update(e.target.value);
          }} className="size-10 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5" aria-label="Base colour" />
        <Input
          value={base}
          onChange={(e) => {
            const v = e.target.value.trim();
            setBase(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) update(v);
          }}
          className="h-9 w-28 font-mono"
          aria-label="Base colour hex"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const b = hslToHex(Math.random() * 360, 0.35 + Math.random() * 0.45, 0.35 + Math.random() * 0.3);
            const h = HARMONIES[Math.floor(Math.random() * HARMONIES.length)].id;
            setBase(b);
            setHarmony(h);
            update(b, h);
          }}
        >
          <Shuffle /> Random
        </Button>
      </div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Harmony">
        {HARMONIES.map((h) => (
          <button
            key={h.id}
            type="button"
            role="radio"
            aria-checked={harmony === h.id}
            onClick={() => {
              setHarmony(h.id);
              update(base, h.id);
            }}
            className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium", harmony === h.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
          >
            {h.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[12px] text-muted-foreground">Colours</span>
        <Slider value={[count]} min={2} max={12} step={1} onValueChange={([v]) => {
            setCount(v);
            update(base, harmony, v);
          }} aria-label="Number of colours" />
        <span className="w-5 font-mono text-[12px]">{count}</span>
      </div>
    </div>
  );
}

/** New palette: from an image (k-means in the browser, draggable sample points) or a colour-wheel harmony. */
export function PaletteEditor({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (p: { name: string; hex: string[] }) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">{open && <EditorBody onClose={() => onOpenChange(false)} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function EditorBody({ onClose, onSave }: { onClose: () => void; onSave: (p: { name: string; hex: string[] }) => void }) {
  const [tab, setTab] = useState<"image" | "wheel">("image");
  const [hex, setHex] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const save = () => {
    if (!hex.length) return toast.error("Add some colours first");
    onSave({ name: name.trim() || `Palette ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, hex });
    toast.success("Palette saved", { duration: 1500 });
    onClose();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>New palette</DialogTitle>
        <DialogDescription>Pull colours from a frame you like, or build a harmony on the colour wheel.</DialogDescription>
      </DialogHeader>
      <div className="inline-flex w-fit rounded-full bg-muted p-0.5" role="tablist">
        {(
          [
            ["image", "From image"],
            ["wheel", "Color wheel"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              // The wheel starts from a harmony right away; the image tab waits for a picture.
              setHex(id === "wheel" ? harmonyPalette(WHEEL_BASE, "analogous", 6) : []);
            }} className={cn("h-7 rounded-full px-3 text-[12px] font-medium", tab === id ? "bg-background shadow-soft" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "image" ? <FromImage onColors={setHex} /> : <ColorWheel onColors={setHex} />}
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted-foreground">{hex.length ? "Click a colour to change it, drag to reorder." : "Your colours appear here."}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {hex.map((h, i) => (
            <span
              key={`${h}-${i}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag === null || drag === i) return;
                const next = [...hex];
                const [x] = next.splice(drag, 1);
                next.splice(i, 0, x);
                setHex(next);
                setDrag(null);
              }}
              className="group/sw relative"
            >
              <label className="block size-9 cursor-pointer rounded-lg border shadow-soft" style={{ background: h }} title={h}>
                <input
                  type="color"
                  value={h}
                  onChange={(e) => setHex(hex.map((x, j) => (j === i ? e.target.value : x)))}
                  className="sr-only"
                  aria-label={`Colour ${i + 1}`}
                />
              </label>
              <button
                type="button"
                onClick={() => setHex(hex.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-foreground text-background opacity-100 sm:opacity-0 sm:group-hover/sw:opacity-100"
                aria-label={`Remove colour ${i + 1}`}
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {hex.length > 0 && hex.length < 12 && (
            <button type="button" onClick={() => setHex([...hex, hex[hex.length - 1]])} className="grid size-9 place-items-center rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-brand-text" aria-label="Add colour">
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:items-center">
        <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Enter palette name" className="sm:max-w-60" onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button onClick={save}>Save palette</Button>
      </DialogFooter>
    </>
  );
}
