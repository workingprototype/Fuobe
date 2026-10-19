"use client";

import { Check } from "lucide-react";
import { memo, useId } from "react";
import { getStyle, type VisualStyle } from "@/lib/catalog/faceless";
import { cn } from "@/lib/utils";

/**
 * A small procedural picture of each visual style (no generated samples needed): a motif per family —
 * cutouts and labels, line drawings, paper layers, 3D spheres, watercolour blooms, flat shapes, pixels,
 * clay — tinted with the style's hue.
 */

type Motif = "graphics" | "lines" | "paper" | "solid3d" | "paint" | "flat" | "pixel" | "clay" | "iso" | "poly";

const MOTIF: Record<string, Motif> = {
  "editorial-motion-graphics": "graphics",
  "stickman-cartoon": "lines",
  "watercolor-chronicle": "paint",
  "fairy-tale-myth": "paint",
  "paper-diorama": "paper",
  "pastel-flat-2d": "flat",
  "colorful-3d": "solid3d",
  "hand-drawn": "lines",
  "poster-vector": "flat",
  mannequin: "solid3d",
  "whiteboard-doodle": "lines",
  "3d-papercraft": "paper",
  "mixed-media": "graphics",
  "low-poly": "poly",
  "2d-illustrator": "flat",
  "pixel-art": "pixel",
  claymotion: "clay",
  "isometric-flat-vector": "iso",
  "3d-mix": "solid3d",
  "studio-3d": "solid3d",
  "fluffy-toy": "clay",
  "paper-collage": "paper",
};

const c = (l: number, ch: number, h: number) => `oklch(${l} ${ch} ${h % 360})`;

function Motif({ style, u }: { style: VisualStyle; u: string }) {
  const h = style.hue;
  const m = MOTIF[style.id] ?? "flat";
  switch (m) {
    case "graphics":
      return (
        <>
          <rect width="160" height="100" fill={c(0.93, 0.03, h)} />
          <rect x="18" y="16" width="70" height="52" rx="4" fill={c(0.62, 0.15, h)} />
          <circle cx="112" cy="40" r="22" fill={c(0.78, 0.13, h + 60)} />
          <rect x="96" y="70" width="48" height="8" rx="4" fill={c(0.3, 0.05, h)} />
          <rect x="18" y="76" width="38" height="6" rx="3" fill={c(0.3, 0.05, h)} />
          <path d="M60 86 L92 58" stroke={c(0.3, 0.05, h)} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M86 56 L93 57 L91 64" fill="none" stroke={c(0.3, 0.05, h)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "lines": {
      const ink = style.id === "whiteboard-doodle" ? "#1f2937" : c(0.25, 0.03, h);
      const paper = style.id === "whiteboard-doodle" ? "#fbfbfa" : c(0.96, 0.02, h + 40);
      return (
        <>
          <rect width="160" height="100" fill={paper} />
          <g fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="52" cy="30" r="9" />
            <path d="M52 39 L52 64 M52 46 L38 56 M52 46 L68 40 M52 64 L42 82 M52 64 L62 82" />
            <circle cx="112" cy="34" r="9" />
            <path d="M112 43 L112 66 M112 50 L98 44 M112 50 L126 58 M112 66 L104 84 M112 66 L121 84" />
            <path d="M74 30 Q82 22 90 30" strokeWidth="2" />
          </g>
          <circle cx="132" cy="18" r="6" fill={c(0.72, 0.16, h)} />
        </>
      );
    }
    case "paper":
      return (
        <>
          <rect width="160" height="100" fill={c(0.88, 0.05, h + 30)} />
          <path d="M0 62 Q30 44 60 58 T120 52 T160 56 V100 H0Z" fill={c(0.72, 0.1, h)} filter={`url(#${u}pshadow)`} />
          <path d="M0 76 Q40 62 80 74 T160 70 V100 H0Z" fill={c(0.6, 0.12, h + 20)} filter={`url(#${u}pshadow)`} />
          <path d="M0 90 Q50 80 100 88 T160 86 V100 H0Z" fill={c(0.48, 0.1, h + 40)} filter={`url(#${u}pshadow)`} />
          <circle cx="120" cy="26" r="12" fill={c(0.85, 0.12, h + 70)} filter={`url(#${u}pshadow)`} />
          <path d="M40 66 L46 46 L52 66Z" fill={c(0.35, 0.06, h)} />
        </>
      );
    case "solid3d":
      return (
        <>
          <rect width="160" height="100" fill={style.id === "studio-3d" ? c(0.9, 0.01, h) : c(0.86, 0.06, h + 20)} />
          <ellipse cx="80" cy="84" rx="54" ry="8" fill="black" opacity="0.12" />
          <circle cx="62" cy="54" r="24" fill={`url(#${u}ball)`} />
          <circle cx="106" cy="62" r="16" fill={`url(#${u}ball2)`} />
          <rect x="88" y="22" width="24" height="24" rx="6" fill={c(0.7, 0.14, h + 120)} />
        </>
      );
    case "paint":
      return (
        <>
          <rect width="160" height="100" fill={c(0.95, 0.02, h + 50)} />
          <g filter={`url(#${u}blur)`} opacity="0.85">
            <circle cx="50" cy="44" r="28" fill={c(0.72, 0.12, h)} />
            <circle cx="104" cy="56" r="30" fill={c(0.66, 0.12, h + 50)} />
            <circle cx="84" cy="26" r="16" fill={c(0.82, 0.1, h + 100)} />
          </g>
          <path d="M18 84 Q60 70 100 82 T150 80" stroke={c(0.4, 0.06, h)} strokeWidth="2" fill="none" opacity="0.6" />
        </>
      );
    case "pixel": {
      const cells: React.ReactNode[] = [];
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 16; x++) {
          const ground = y >= 7;
          const sun = (x - 12) ** 2 + (y - 2) ** 2 <= 2;
          const hill = y >= 5 && Math.abs(x - 5) <= y - 5;
          const fill = sun ? c(0.85, 0.16, h + 60) : ground ? c(0.55, 0.14, h + 100 + ((x + y) % 2) * 8) : hill ? c(0.5, 0.12, h + 140) : c(0.8, 0.08, h + ((x + y) % 3) * 4);
          cells.push(<rect key={`${x}-${y}`} x={x * 10} y={y * 10} width="10" height="10" fill={fill} />);
        }
      return <>{cells}</>;
    }
    case "clay":
      return (
        <>
          <rect width="160" height="100" fill={c(0.88, 0.05, h + 40)} />
          <ellipse cx="80" cy="86" rx="60" ry="10" fill={c(0.7, 0.08, h + 40)} />
          <ellipse cx="66" cy="58" rx="22" ry="26" fill={`url(#${u}ball)`} />
          <circle cx="60" cy="52" r="3" fill="#222" />
          <circle cx="74" cy="52" r="3" fill="#222" />
          <ellipse cx="108" cy="66" rx="14" ry="16" fill={`url(#${u}ball2)`} />
        </>
      );
    case "iso":
      return (
        <>
          <rect width="160" height="100" fill={c(0.94, 0.03, h)} />
          <path d="M80 20 L120 40 L80 60 L40 40Z" fill={c(0.8, 0.1, h)} />
          <path d="M40 40 L80 60 L80 86 L40 66Z" fill={c(0.62, 0.13, h)} />
          <path d="M120 40 L80 60 L80 86 L120 66Z" fill={c(0.5, 0.12, h)} />
          <path d="M104 22 L118 29 L104 36 L90 29Z" fill={c(0.86, 0.12, h + 120)} />
        </>
      );
    case "poly":
      return (
        <>
          <rect width="160" height="100" fill={c(0.9, 0.04, h)} />
          <path d="M0 100 L40 40 L70 100Z" fill={c(0.55, 0.1, h)} />
          <path d="M40 40 L90 100 L70 100Z" fill={c(0.45, 0.1, h)} />
          <path d="M60 100 L105 30 L150 100Z" fill={c(0.62, 0.11, h + 20)} />
          <path d="M105 30 L130 100 L150 100Z" fill={c(0.5, 0.1, h + 20)} />
          <path d="M120 18 L130 24 L124 32 L114 26Z" fill={c(0.85, 0.14, h + 70)} />
        </>
      );
    default:
      return (
        <>
          <rect width="160" height="100" fill={c(0.94, 0.04, h)} />
          <circle cx="118" cy="30" r="16" fill={c(0.84, 0.1, h + 60)} />
          <path d="M0 74 Q40 54 80 70 T160 64 V100 H0Z" fill={c(0.76, 0.09, h + 140)} />
          <rect x="40" y="38" width="22" height="38" rx="11" fill={c(0.66, 0.12, h)} />
          <circle cx="51" cy="32" r="9" fill={c(0.82, 0.08, h + 30)} />
        </>
      );
  }
}

export const StyleArt = memo(function StyleArt({ styleId, className }: { styleId: string; className?: string }) {
  const style = getStyle(styleId);
  const h = style.hue;
  // Gradient and filter ids are document-wide: each picture gets its own.
  const u = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className={cn("size-full", className)} aria-hidden>
      <defs>
        <filter id={`${u}pshadow`} x="-10%" y="-10%" width="120%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodOpacity="0.25" />
        </filter>
        <filter id={`${u}blur`}>
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <radialGradient id={`${u}ball`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={c(0.92, 0.08, h)} />
          <stop offset="0.6" stopColor={c(0.66, 0.16, h)} />
          <stop offset="1" stopColor={c(0.42, 0.12, h)} />
        </radialGradient>
        <radialGradient id={`${u}ball2`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={c(0.94, 0.06, h + 60)} />
          <stop offset="0.6" stopColor={c(0.72, 0.14, h + 60)} />
          <stop offset="1" stopColor={c(0.48, 0.1, h + 60)} />
        </radialGradient>
      </defs>
      <Motif style={style} u={u} />
    </svg>
  );
});

/** A selectable style card (radio). */
export function StyleCard({ styleId, selected, onSelect, compact }: { styleId: string; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const s = getStyle(styleId);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group/style relative min-w-0 overflow-hidden rounded-xl border bg-background text-left transition-[box-shadow,border-color] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary ring-2 ring-brand-faint" : "hover:border-border-strong",
      )}
    >
      <div className={cn("relative w-full overflow-hidden", compact ? "aspect-[16/9]" : "aspect-[16/10]")}>
        <StyleArt styleId={styleId} className="transition-transform duration-300 ease-move group-hover/style:scale-[1.04]" />
        {selected && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
            <Check className="size-3" />
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[13px] font-medium">{s.name}</p>
        {!compact && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.description}</p>}
      </div>
    </button>
  );
}

/** The style grid (12 Faceless or 22 Explainer styles), a radio group. */
export function StyleGrid({ ids, value, onChange, compact, className }: { ids: string[]; value: string; onChange: (id: string) => void; compact?: boolean; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Visual style" className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {ids.map((id) => (
        <StyleCard key={id} styleId={id} selected={value === id} onSelect={() => onChange(id)} compact={compact} />
      ))}
    </div>
  );
}
