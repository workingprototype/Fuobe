"use client";

import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { hexToRgb, hsvToHex, normalizeHex, rgbToHsv } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";

interface EyeDropperLike {
  open: () => Promise<{ sRGBHex: string }>;
}

const eyeDropper = (): (new () => EyeDropperLike) | null =>
  typeof window !== "undefined" && "EyeDropper" in window ? (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper : null;

/**
 * A colour picker: saturation/value field and hue slider (pointer and arrow keys), a hex field that
 * only hands on valid #RRGGBB values, the EyeDropper where the browser has it, and "Use as background".
 */
export function ColorPicker({
  value,
  onChange,
  background,
  onBackground,
}: {
  value: string;
  onChange: (hex: string) => void;
  background?: boolean;
  onBackground?: (on: boolean) => void;
}) {
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value)));
  const [text, setText] = useState(value.toUpperCase());
  const last = useRef(value.toUpperCase());
  // Follow outside changes (another swatch picked) without fighting our own drags.
  useEffect(() => {
    if (value.toUpperCase() === last.current) return;
    last.current = value.toUpperCase();
    setHsv(rgbToHsv(hexToRgb(value)));
    setText(value.toUpperCase());
  }, [value]);
  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = hsvToHex(h, s, v);
    last.current = hex;
    setText(hex);
    onChange(hex);
  };
  const field = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent, el: HTMLElement | null, fn: (x: number, y: number) => void) => {
    if (!el) return;
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [h, s, v] = hsv;
  const Dropper = eyeDropper();
  return (
    <div className="w-56 space-y-3">
      <div
        ref={field}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s * 100)}
        aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
        onPointerDown={(e) => drag(e, field.current, (x, y) => emit(h, x, 1 - y))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowRight") emit(h, Math.min(1, s + step), v);
          else if (e.key === "ArrowLeft") emit(h, Math.max(0, s - step), v);
          else if (e.key === "ArrowUp") emit(h, s, Math.min(1, v + step));
          else if (e.key === "ArrowDown") emit(h, s, Math.max(0, v - step));
          else return;
          e.preventDefault();
        }}
        className="relative h-36 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(h, 1, 1)})` }}
      >
        <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        onPointerDown={(e) => drag(e, e.currentTarget, (x) => emit(x * 360, s, v))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 3;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") emit((h + step) % 360, s, v);
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") emit((h - step + 360) % 360, s, v);
          else return;
          e.preventDefault();
        }}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${(h / 360) * 100}%`, background: hsvToHex(h, 1, 1) }} />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-primary">
          <span className="sr-only">Hex color code</span>
          <span className="size-4 shrink-0 rounded-sm ring-1 ring-foreground/10" style={{ background: normalizeHex(text) ?? value }} />
          <input
            value={text}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => {
              const t = e.target.value.toUpperCase();
              setText(t);
              const hex = /^#?[0-9A-F]{6}$/.test(t) ? normalizeHex(t) : null;
              if (hex) {
                last.current = hex;
                setHsv(rgbToHsv(hexToRgb(hex)));
                onChange(hex);
              }
            }}
            onBlur={() => setText(last.current)}
            aria-invalid={!normalizeHex(text)}
            className={cn("min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none", !/^#?[0-9A-F]{6}$/.test(text) && "text-destructive")}
          />
        </label>
        <button
          type="button"
          disabled={!Dropper}
          title={Dropper ? "Pick a color from the screen" : "Picking from the screen isn't supported in this browser"}
          aria-label="Pick a color from the screen"
          onClick={async () => {
            if (!Dropper) return;
            try {
              const { sRGBHex } = await new Dropper().open();
              const hex = normalizeHex(sRGBHex);
              if (hex) emit(...rgbToHsv(hexToRgb(hex)));
            } catch {
              // closed with Escape
            }
          }}
          className="grid size-8 shrink-0 place-items-center rounded-md border transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          <Pipette className="size-3.5" />
        </button>
      </div>
      {onBackground && (
        <label className="flex items-center justify-between gap-2 text-[12.5px]">
          Use as background
          <Switch checked={!!background} onCheckedChange={onBackground} size="sm" />
        </label>
      )}
    </div>
  );
}
