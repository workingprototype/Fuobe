"use client";

import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { cn } from "@/lib/utils";

/** Segmented control (the app's track + white thumb), a radio group for keyboards and screen readers. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={radioKeys} className={cn("grid h-9 rounded-full bg-muted p-0.5 text-[13px] font-medium", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={radioTab(value === v)}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            "truncate rounded-full px-2 transition-colors disabled:opacity-50",
            value === v ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A labelled row inside a tool form. */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-muted-foreground">
          {label}
        </label>
        {hint && <span className="font-mono text-[12px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Checkerboard-backed thumbnail of a transparent image. */
export function Thumb({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  return (
    <span className={cn("checkerboard grid shrink-0 place-items-center overflow-hidden rounded-md border", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
