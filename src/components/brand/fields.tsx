"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ensureFont } from "@/components/ads/render";
import { cn } from "@/lib/utils";

/** Small form pieces shared by the brand kit and product forms. */

export const inputCls =
  "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-[13px] outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-brand-faint aria-invalid:border-destructive";
export const areaCls = cn(inputCls, "h-auto min-h-20 resize-y py-2 leading-relaxed");

export function FieldRow({ label, hint, children, className, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-subtle-foreground">{hint}</p>}
    </div>
  );
}

/** Tags: Enter or comma adds, Backspace on an empty field removes the last, × removes one. */
export function TagInput({ value, onChange, placeholder, max = 8, label }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; label: string }) {
  const [text, setText] = useState("");
  const id = useId();
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background p-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint">
      {value.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-[12px]">
          <span className="truncate">{t}</span>
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {value.length < max && (
        <input
          id={id}
          aria-label={label}
          value={text}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => add(text)}
          placeholder={value.length ? "Add…" : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-subtle-foreground"
        />
      )}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Brand colours: swatches with a picker and a hex field; the first is the main colour. */
export function ColorList({ value, onChange, max = 8 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {value.map((hex, i) => (
        <ColorSwatch
          key={i}
          hex={hex}
          main={i === 0}
          onChange={(h) => onChange(value.map((x, j) => (j === i ? h : x)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
          onMain={i ? () => onChange([hex, ...value.filter((_, j) => j !== i)]) : undefined}
        />
      ))}
      {value.length < max && (
        <button type="button" onClick={() => onChange([...value, "#888888"])} className="grid h-[68px] w-16 place-items-center rounded-xl border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:text-brand-text" aria-label="Add a colour">
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

function ColorSwatch({ hex, main, onChange, onRemove, onMain }: { hex: string; main: boolean; onChange: (h: string) => void; onRemove: () => void; onMain?: () => void }) {
  const [text, setText] = useState(hex);
  // A new colour from outside (the picker, "Main") replaces what's typed.
  const [shown, setShown] = useState(hex);
  if (shown !== hex) {
    setShown(hex);
    setText(hex);
  }
  return (
    <div className="group/sw relative w-16">
      <label className="block h-11 cursor-pointer overflow-hidden rounded-xl border shadow-soft" style={{ background: HEX.test(hex) ? hex : "#888" }}>
        <input type="color" value={HEX.test(hex) ? hex : "#888888"} onChange={(e) => onChange(e.target.value)} className="sr-only" aria-label={`Colour ${hex}${main ? " (main)" : ""}`} />
      </label>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
          if (HEX.test(v)) onChange(v.toLowerCase());
        }}
        aria-label="Hex colour"
        className="mt-1 h-6 w-full rounded-md bg-transparent px-1 text-center font-mono text-[11px] outline-none focus:bg-muted"
      />
      {main && <span className="absolute top-1 left-1 rounded-full bg-black/45 px-1.5 text-[9px] font-semibold tracking-wide text-white uppercase">Main</span>}
      <div className="absolute -top-1.5 -right-1.5 flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/sw:opacity-100 sm:group-focus-within/sw:opacity-100">
        {onMain && (
          <button type="button" onClick={onMain} className="h-5 rounded-full border bg-background px-1.5 text-[9px] font-semibold shadow-soft" aria-label="Make this the main colour">
            Main
          </button>
        )}
        <button type="button" onClick={onRemove} className="grid size-5 place-items-center rounded-full border bg-background shadow-soft" aria-label={`Remove ${hex}`}>
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

export const POPULAR_FONTS = [
  "Inter", "DM Sans", "Manrope", "Poppins", "Montserrat", "Space Grotesk", "Work Sans", "Nunito Sans", "Rubik", "Outfit", "Plus Jakarta Sans", "Sora", "Lexend", "Archivo",
  "Oswald", "Bebas Neue", "Anton", "Playfair Display", "Fraunces", "Cormorant Garamond", "DM Serif Display", "Libre Baskerville", "Lora", "Merriweather", "EB Garamond",
  "Instrument Serif", "Syne", "Unbounded", "Righteous", "Pacifico", "Caveat", "Permanent Marker", "Archivo Black", "Abril Fatface", "IBM Plex Sans", "Roboto", "Open Sans",
];

/** A Google Fonts family by name, with a live sample in that font. */
export function FontField({ label, value, onChange, sample }: { label: string; value?: string; onChange: (v: string) => void; sample: string }) {
  const id = useId();
  const [loadedFont, setLoadedFont] = useState<string | null>(null);
  const loaded = !!value && loadedFont === value;
  useEffect(() => {
    if (value) void ensureFont(value).then(() => setLoadedFont(value));
  }, [value]);
  return (
    <FieldRow label={label} htmlFor={id}>
      <input id={id} list={`${id}-fonts`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Playfair Display" className={inputCls} />
      <datalist id={`${id}-fonts`}>
        {POPULAR_FONTS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <p className={cn("truncate text-[20px] leading-tight transition-opacity", !loaded && value && "opacity-60")} style={{ fontFamily: value ? `"${value}", system-ui` : undefined }}>
        {sample}
      </p>
    </FieldRow>
  );
}
