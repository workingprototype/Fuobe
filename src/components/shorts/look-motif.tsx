/**
 * A small motif drawn over a look card's procedural preview, so presets that share a treatment
 * (halftone, pop, grade) still read apart at a glance: lettering on the type presets, scribbles on
 * the doodle ones, paper grain, a blueprint grid, comic panels, a desktop window, a film look…
 * Static SVG and CSS filters (no images, no animation), aria-hidden. Shared by Shorts Studio and
 * Mixed Media (keyed by preset id).
 */
import { useId } from "react";

type Motif =
  | { kind: "type"; style: "sticker" | "balloon" | "caption" | "kinetic" | "neon" | "stacked"; text: string }
  | { kind: "scribble" | "highlight" | "graffiti" | "polka" | "hearts" | "stars" | "pattern" | "collage" | "desktop" | "bbox" | "circuit" | "chrome" | "mascot" | "clay" | "comic" | "burst" | "frame" | "blueprint" | "pop" | "fragments" | "particles" | "bubbles" | "origami" | "magazine" | "mirror" | "marble" | "tracking"; text?: string }
  | { kind: "paper" | "watercolor" | "pencil" | "film" | "noir" }
  | { kind: "grade"; filter: string };

const MOTIFS: Record<string, Motif> = {
  // Shorts Studio
  "shorts-bold-urban": { kind: "grade", filter: "contrast(1.35) saturate(1.5)" },
  "shorts-green-contrast": { kind: "grade", filter: "contrast(1.45) hue-rotate(-25deg) saturate(1.2)" },
  "shorts-urban-serenity": { kind: "grade", filter: "saturate(0.55) brightness(1.12) contrast(0.9)" },
  "shorts-warm-glow": { kind: "grade", filter: "sepia(0.35) saturate(1.35) brightness(1.08)" },
  "shorts-yellow-frame": { kind: "frame" },
  "shorts-monochrome-vibes": { kind: "film" },
  "shorts-claymation": { kind: "clay" },
  "shorts-marker-scribble": { kind: "scribble" },
  "shorts-sticker-type": { kind: "type", style: "sticker", text: "WOW!" },
  "shorts-blue-comic": { kind: "comic", text: "ZAP!" },
  "shorts-red-graffiti": { kind: "graffiti" },
  "shorts-watercolor": { kind: "watercolor" },
  "shorts-pencil-sketch": { kind: "pencil" },
  "shorts-desktop": { kind: "desktop" },
  "shorts-acid-green": { kind: "grade", filter: "hue-rotate(70deg) saturate(1.9) contrast(1.15)" },
  "shorts-balloon-type": { kind: "type", style: "balloon", text: "YAY" },
  "shorts-blueprint": { kind: "blueprint" },
  "shorts-bold-caption": { kind: "type", style: "caption", text: "AND THEN…" },
  "shorts-bounding-box": { kind: "bbox" },
  "shorts-circuit": { kind: "circuit" },
  "shorts-comic-burst": { kind: "burst", text: "BAM!" },
  "shorts-comic-pop": { kind: "comic", text: "POW!" },
  "shorts-pink-wash": { kind: "grade", filter: "sepia(0.25) hue-rotate(-45deg) saturate(1.5) brightness(1.05)" },
  "shorts-gold-stars": { kind: "stars" },
  "shorts-graffiti": { kind: "graffiti", text: "tag" },
  "shorts-green-doodle": { kind: "scribble" },
  "shorts-green-pop": { kind: "pop" },
  "shorts-heart-pop": { kind: "hearts" },
  "shorts-kinetic-type": { kind: "type", style: "kinetic", text: "GO BIG NOW" },
  "shorts-liquid-chrome": { kind: "chrome" },
  "shorts-mascot": { kind: "mascot" },
  "shorts-neon-pop": { kind: "pop" },
  "shorts-neon-type": { kind: "type", style: "neon", text: "LIVE" },
  "shorts-patterned": { kind: "pattern" },
  "shorts-pink-pop": { kind: "pop" },
  "shorts-pink-scribble": { kind: "scribble" },
  "shorts-polka-pop": { kind: "polka" },
  "shorts-retro-collage": { kind: "collage" },
  "shorts-stacked-type": { kind: "type", style: "stacked", text: "BIG BOLD LOUD" },
  "shorts-star-comic": { kind: "stars", text: "comic" },
  "shorts-street-art": { kind: "graffiti" },
  "shorts-vintage-paper": { kind: "paper" },
  "shorts-yellow-burst": { kind: "burst", text: "YES!" },
  "shorts-yellow-doodle": { kind: "highlight" },
  // Mixed Media
  "mixed-layer-mixed-media": { kind: "collage" },
  "mixed-sketch": { kind: "pencil" },
  "mixed-canvas": { kind: "watercolor" },
  "mixed-flash-comic": { kind: "burst", text: "WHAM" },
  "mixed-overexposed": { kind: "grade", filter: "brightness(1.45) contrast(1.25) saturate(0.8)" },
  "mixed-paper": { kind: "paper" },
  "mixed-noir": { kind: "noir" },
  "mixed-particles": { kind: "particles" },
  "mixed-hand-paint": { kind: "watercolor" },
  "mixed-tracking": { kind: "tracking" },
  "mixed-windows": { kind: "desktop" },
  "mixed-acid": { kind: "grade", filter: "hue-rotate(110deg) saturate(2.2) contrast(1.2)" },
  "mixed-palette": { kind: "watercolor" },
  "mixed-comic": { kind: "comic", text: "POW!" },
  "mixed-multiverse": { kind: "grade", filter: "hue-rotate(140deg) saturate(1.6) contrast(1.1)" },
  "mixed-fragments": { kind: "fragments" },
  "mixed-vintage": { kind: "paper" },
  "mixed-magazine": { kind: "magazine" },
  "mixed-lsd": { kind: "grade", filter: "hue-rotate(200deg) saturate(2.4)" },
  "mixed-broken-mirror": { kind: "mirror" },
  "mixed-marble": { kind: "marble" },
  "mixed-toxic": { kind: "grade", filter: "hue-rotate(80deg) saturate(2.4) contrast(1.3)" },
  "mixed-ultraviolet": { kind: "grade", filter: "hue-rotate(250deg) saturate(1.8) contrast(1.2) brightness(0.9)" },
  "mixed-akrill": { kind: "pop" },
  "mixed-two-color": { kind: "grade", filter: "grayscale(1) contrast(2.2)" },
  "mixed-origami": { kind: "origami" },
  "mixed-random-glow": { kind: "particles" },
  "mixed-cannabis": { kind: "grade", filter: "hue-rotate(85deg) saturate(1.7) contrast(1.1) blur(0.6px)" },
  "mixed-bubbles": { kind: "bubbles" },
  "mixed-cold-vision": { kind: "grade", filter: "hue-rotate(190deg) saturate(1.3) contrast(1.25) brightness(0.92)" },
  "mixed-modern": { kind: "grade", filter: "saturate(0.35) contrast(1.15) brightness(1.1)" },
  "mixed-lava": { kind: "grade", filter: "sepia(0.6) hue-rotate(-30deg) saturate(2.2) contrast(1.2)" },
  "mixed-ocean": { kind: "grade", filter: "sepia(0.3) hue-rotate(160deg) saturate(1.6)" },
};

const BOX = "absolute inset-0 size-full pointer-events-none";
const ink = (hue: number, l = 0.7, c = 0.19) => `oklch(${l} ${c} ${hue})`;

/** A backdrop filter over the preview (a grade, black and white). */
function Filter({ filter, children }: { filter: string; children?: React.ReactNode }) {
  return (
    <div className={BOX} style={{ backdropFilter: filter, WebkitBackdropFilter: filter }}>
      {children}
    </div>
  );
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg className={BOX} viewBox="0 0 80 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {children}
    </svg>
  );
}

const grain = (u: string) => (
  <pattern id={`${u}-grain`} width="3" height="3" patternUnits="userSpaceOnUse">
    <circle cx="0.6" cy="0.8" r="0.35" fill="#000" opacity="0.18" />
    <circle cx="2.1" cy="2.2" r="0.3" fill="#fff" opacity="0.25" />
  </pattern>
);

function TypeMotif({ style, text, hue, u }: { style: Extract<Motif, { kind: "type" }>["style"]; text: string; hue: number; u: string }) {
  const font = { fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif", fontWeight: 900 } as const;
  if (style === "sticker")
    return (
      <Svg>
        <g transform="rotate(-8 40 32)">
          <rect x="13" y="20" width="54" height="22" rx="6" fill="#fff" stroke="#111" strokeWidth="1.2" />
          <text x="40" y="36.5" textAnchor="middle" fontSize="15" fill={ink(hue, 0.6, 0.24)} style={font}>
            {text}
          </text>
        </g>
        <circle cx="66" cy="76" r="7" fill="#ffd43b" stroke="#fff" strokeWidth="2" />
        <circle cx="64" cy="74.5" r="0.9" fill="#111" />
        <circle cx="68" cy="74.5" r="0.9" fill="#111" />
        <path d="M63 78 q3 2.5 6 0" stroke="#111" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      </Svg>
    );
  if (style === "balloon")
    return (
      <Svg>
        <text x="40" y="40" textAnchor="middle" fontSize="24" fill={ink(hue, 0.78, 0.17)} stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" paintOrder="stroke" style={{ ...font, letterSpacing: -1 }}>
          {text}
        </text>
        <ellipse cx="33" cy="30" rx="3" ry="1.4" fill="#fff" opacity="0.7" />
      </Svg>
    );
  if (style === "caption")
    return (
      <Svg>
        <text x="40" y="82" textAnchor="middle" fontSize="9" fill="#fff" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" paintOrder="stroke" style={font}>
          {text}
        </text>
        <rect x="22" y="85.5" width="36" height="2.2" rx="1.1" fill={ink(hue, 0.82, 0.18)} />
      </Svg>
    );
  if (style === "neon")
    return (
      <Svg>
        <defs>
          <filter id={`${u}-neon`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <text x="40" y="34" textAnchor="middle" fontSize="18" fill="none" stroke={ink(hue, 0.85, 0.2)} strokeWidth="1.3" filter={`url(#${u}-neon)`} style={{ ...font, fontWeight: 700, letterSpacing: 2 }}>
          {text}
        </text>
      </Svg>
    );
  const words = text.split(" ");
  if (style === "kinetic")
    return (
      <Svg>
        {words.map((w, i) => (
          <text key={w} x={16 + i * 14} y={28 + i * 13} fontSize={12 - i * 1.5} fill={i === 1 ? ink(hue, 0.85, 0.2) : "#fff"} stroke="#000" strokeWidth="1" paintOrder="stroke" transform={`rotate(${-10 + i * 7} ${16 + i * 14} ${28 + i * 13})`} style={font}>
            {w}
          </text>
        ))}
      </Svg>
    );
  return (
    <Svg>
      {words.map((w, i) => (
        <text key={w} x="40" y={30 + i * 17} textAnchor="middle" fontSize="15" textLength="64" lengthAdjust="spacingAndGlyphs" fill={i === 1 ? ink(hue, 0.85, 0.2) : "#fff"} opacity="0.95" style={{ ...font, letterSpacing: -0.5 }}>
          {w}
        </text>
      ))}
    </Svg>
  );
}

function Draw({ m, hue, u }: { m: Motif; hue: number; u: string }) {
  const c = ink(hue);
  switch (m.kind) {
    case "type":
      return <TypeMotif style={m.style} text={m.text} hue={hue} u={u} />;
    case "grade":
      return <Filter filter={m.filter} />;
    case "film":
    case "noir":
      return (
        <Filter filter={m.kind === "noir" ? "grayscale(1) contrast(1.6) brightness(0.8)" : "grayscale(1) contrast(1.25)"}>
          <Svg>
            {grain(u)}
            <rect width="80" height="100" fill={`url(#${u}-grain)`} />
            {m.kind === "noir" ? (
              <g fill="#000" opacity="0.35">
                {Array.from({ length: 6 }, (_, i) => (
                  <rect key={i} x="-10" y={i * 18} width="100" height="7" transform="rotate(-18 40 50)" />
                ))}
              </g>
            ) : (
              <path d="M18 0 L19 100 M61 0 L60.5 100" stroke="#fff" strokeWidth="0.3" opacity="0.5" />
            )}
          </Svg>
        </Filter>
      );
    case "pencil":
      return (
        <Filter filter="grayscale(1) contrast(1.4) brightness(1.15)">
          <Svg>
            <g stroke="#333" strokeWidth="0.35" opacity="0.45">
              {Array.from({ length: 22 }, (_, i) => (
                <path key={i} d={`M${i * 5 - 20} 100 L${i * 5 + 10} 0`} />
              ))}
            </g>
            <path d="M8 90 q20 -6 34 -2 t30 -3" stroke="#222" strokeWidth="0.8" fill="none" strokeLinecap="round" />
          </Svg>
        </Filter>
      );
    case "paper":
      return (
        <Filter filter="sepia(0.55) contrast(0.95) brightness(1.05)">
          <Svg>
            {grain(u)}
            <rect width="80" height="100" fill={`url(#${u}-grain)`} />
            <path d="M0 37 L80 41 M44 0 L41 100" stroke="#5b4630" strokeWidth="0.5" opacity="0.35" />
            <rect x="1.5" y="1.5" width="77" height="97" fill="none" stroke="#5b4630" strokeWidth="1.2" opacity="0.25" />
          </Svg>
        </Filter>
      );
    case "watercolor":
      return (
        <Filter filter="saturate(1.2) contrast(0.92) brightness(1.06)">
          <Svg>
            {grain(u)}
            <g opacity="0.35" style={{ mixBlendMode: "multiply" }}>
              <ellipse cx="18" cy="22" rx="20" ry="14" fill={ink(hue, 0.78, 0.14)} />
              <ellipse cx="62" cy="70" rx="24" ry="17" fill={ink(hue + 120, 0.8, 0.13)} />
              <ellipse cx="28" cy="86" rx="16" ry="9" fill={ink(hue + 220, 0.82, 0.12)} />
            </g>
            <rect width="80" height="100" fill={`url(#${u}-grain)`} />
          </Svg>
        </Filter>
      );
    case "scribble":
      return (
        <Svg>
          <g fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 18 c6 -8 14 -2 10 4 s-12 4 -6 10" />
            <path d="M58 14 l3 6 l6 1 l-5 4 l1 6 l-5 -3 l-5 3 l1 -6 l-4 -4 l6 -1z" />
            <path d="M10 70 q10 -10 18 -2 M24 64 l4 6 l-7 1" />
            <path d="M54 84 c4 -6 10 -6 14 0 c-4 6 -10 6 -14 0z" />
            <path d="M60 46 q4 -4 8 0 q4 4 8 0" />
          </g>
        </Svg>
      );
    case "highlight":
      return (
        <Svg>
          <g fill="none" stroke="oklch(0.92 0.2 100)" strokeLinecap="round" opacity="0.75">
            <path d="M10 22 q20 -4 34 2" strokeWidth="5" />
            <path d="M40 86 q14 -3 30 0" strokeWidth="5" />
          </g>
          <g fill="none" stroke="oklch(0.86 0.19 95)" strokeWidth="1.6" strokeLinecap="round">
            <path d="M64 14 v8 M60 18 h8 M14 54 v6 M11 57 h6 M66 56 l4 -4 M62 64 c6 2 10 -2 8 -6" />
          </g>
        </Svg>
      );
    case "graffiti":
      return (
        <Svg>
          <g fill={ink(hue, 0.6, 0.23)}>
            {[14, 30, 52, 66].map((x, i) => (
              <g key={x}>
                <rect x={x} y="0" width="3" height={14 + ((i * 7) % 12)} rx="1.5" />
                <circle cx={x + 1.5} cy={15 + ((i * 7) % 12)} r="2" />
              </g>
            ))}
          </g>
          <path d="M10 80 c8 -12 14 6 20 -6 s10 10 18 -4 s8 8 20 -2" fill="none" stroke={ink(hue, 0.6, 0.23)} strokeWidth="3" strokeLinecap="round" />
          {m.text && (
            <text x="58" y="94" fontSize="9" fill="#fff" stroke="#111" strokeWidth="0.8" paintOrder="stroke" fontStyle="italic" style={{ fontWeight: 900 }}>
              {m.text}
            </text>
          )}
        </Svg>
      );
    case "polka":
      return (
        <Svg>
          <pattern id={`${u}-polka`} width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="5" r="2.2" fill={c} />
          </pattern>
          <rect width="80" height="100" fill={`url(#${u}-polka)`} opacity="0.55" />
        </Svg>
      );
    case "hearts":
    case "stars":
      return (
        <Svg>
          {[
            [12, 16, 1.1],
            [64, 22, 0.8],
            [56, 74, 1.3],
            [18, 82, 0.7],
            [40, 10, 0.6],
          ].map(([x, y, s], i) =>
            m.kind === "hearts" ? (
              <path key={i} transform={`translate(${x} ${y}) scale(${s})`} d="M0 3 C0 -1 -6 -1 -6 3 C-6 6 0 9 0 11 C0 9 6 6 6 3 C6 -1 0 -1 0 3z" fill={ink(hue, 0.68, 0.24)} stroke="#fff" strokeWidth="0.8" />
            ) : (
              <path key={i} transform={`translate(${x} ${y}) scale(${s})`} d="M0 -6 L1.8 -1.8 L6 -1.6 L2.7 1.2 L3.8 5.6 L0 3.2 L-3.8 5.6 L-2.7 1.2 L-6 -1.6 L-1.8 -1.8Z" fill="oklch(0.86 0.17 88)" stroke="oklch(0.6 0.13 70)" strokeWidth="0.5" />
            ),
          )}
          {m.text && <rect x="3" y="3" width="74" height="94" fill="none" stroke="#111" strokeWidth="2" />}
        </Svg>
      );
    case "pattern":
      return (
        <Svg>
          <pattern id={`${u}-zig`} width="12" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 6 L3 2 L6 6 L9 2 L12 6" fill="none" stroke={c} strokeWidth="1.4" />
          </pattern>
          <rect width="80" height="22" fill={`url(#${u}-zig)`} opacity="0.85" />
          <rect y="78" width="80" height="22" fill={`url(#${u}-zig)`} opacity="0.85" />
        </Svg>
      );
    case "collage":
      return (
        <Svg>
          <path d="M4 8 L34 5 L36 30 L6 33z" fill="oklch(0.95 0.03 90)" opacity="0.88" />
          <path d="M48 64 L76 60 L78 92 L50 95z" fill={ink(hue, 0.82, 0.12)} opacity="0.85" />
          <rect x="22" y="2" width="16" height="5" fill="oklch(0.9 0.06 85)" opacity="0.9" transform="rotate(12 30 4)" />
          <rect x="54" y="57" width="14" height="5" fill="oklch(0.9 0.06 85)" opacity="0.9" transform="rotate(-10 61 59)" />
        </Svg>
      );
    case "desktop":
      return (
        <Svg>
          <g>
            <rect x="8" y="12" width="64" height="44" rx="2.5" fill="none" stroke="#fff" strokeWidth="1.2" />
            <rect x="8" y="12" width="64" height="7" rx="2.5" fill="#fff" opacity="0.92" />
            {[13, 17.5, 22].map((x, i) => (
              <circle key={x} cx={x} cy="15.5" r="1.3" fill={["#ff5f57", "#febc2e", "#28c840"][i]} />
            ))}
            <rect x="26" y="50" width="46" height="34" rx="2.5" fill="none" stroke="#fff" strokeWidth="1" opacity="0.9" />
            <rect x="26" y="50" width="46" height="6" rx="2.5" fill={ink(hue, 0.8, 0.12)} opacity="0.9" />
          </g>
          <path d="M58 70 l0 11 l3 -3 l2.5 5 l2 -1 l-2.5 -5 l4 0z" fill="#fff" stroke="#111" strokeWidth="0.6" />
        </Svg>
      );
    case "bbox":
    case "tracking":
      return (
        <Svg>
          <g fill="none" stroke="oklch(0.85 0.2 145)" strokeWidth="1">
            <rect x="22" y="24" width="36" height="54" />
            <rect x="6" y="70" width="18" height="16" />
            {m.kind === "tracking" && <path d="M40 51 C30 40 20 50 15 78" strokeDasharray="2 2" />}
          </g>
          <rect x="22" y="19" width="26" height="5" fill="oklch(0.85 0.2 145)" />
          <text x="23.5" y="22.8" fontSize="3.6" fill="#05260f" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
            person 0.98
          </text>
        </Svg>
      );
    case "circuit":
      return (
        <Svg>
          <g fill="none" stroke={ink(hue, 0.8, 0.17)} strokeWidth="0.9" opacity="0.9">
            <path d="M0 20 H20 L28 28 H44 M80 34 H58 L50 42 V60 M0 76 H16 L24 68 H40 M80 84 H62 L54 92" />
          </g>
          <g fill={ink(hue, 0.85, 0.18)}>
            {[
              [44, 28],
              [50, 60],
              [40, 68],
              [54, 92],
            ].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />
            ))}
          </g>
        </Svg>
      );
    case "chrome":
      return (
        <Svg>
          <defs>
            <linearGradient id={`${u}-chrome`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
              <stop offset="0.35" stopColor="#9aa4b1" stopOpacity="0.15" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.65" />
              <stop offset="0.7" stopColor="#58606b" stopOpacity="0.2" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <rect width="80" height="100" fill={`url(#${u}-chrome)`} style={{ mixBlendMode: "overlay" }} />
          <path d="M20 30 c10 -8 30 -8 40 0 c-6 10 -34 10 -40 0z" fill="#fff" opacity="0.35" />
        </Svg>
      );
    case "mascot":
    case "clay":
      return (
        <Svg>
          {m.kind === "mascot" ? (
            <g transform="translate(58 18)">
              <circle r="11" fill={ink(hue, 0.82, 0.16)} stroke="#fff" strokeWidth="1.5" />
              <circle cx="-3.5" cy="-2" r="2.6" fill="#fff" />
              <circle cx="3.5" cy="-2" r="2.6" fill="#fff" />
              <circle cx="-3" cy="-1.6" r="1.2" fill="#111" />
              <circle cx="4" cy="-1.6" r="1.2" fill="#111" />
              <path d="M-4 4 q4 4 8 0" stroke="#111" strokeWidth="1" fill="none" strokeLinecap="round" />
            </g>
          ) : (
            <g opacity="0.55" fill="none" stroke="#fff" strokeWidth="0.6">
              {[3, 5, 7, 9].map((r) => (
                <ellipse key={r} cx="62" cy="80" rx={r} ry={r * 0.8} />
              ))}
            </g>
          )}
        </Svg>
      );
    case "comic":
      return (
        <Svg>
          <g fill="none" stroke="#111" strokeWidth="2.2">
            <rect x="1.5" y="1.5" width="77" height="97" />
            <path d="M1.5 62 L78.5 54 M44 54.5 L40 98.5" />
          </g>
          <path d="M8 6 h30 a4 4 0 0 1 4 4 v9 a4 4 0 0 1 -4 4 h-18 l-6 6 l1 -6 h-7 a4 4 0 0 1 -4 -4 v-9 a4 4 0 0 1 4 -4z" fill="#fff" stroke="#111" strokeWidth="1" />
          <text x="23" y="18.5" textAnchor="middle" fontSize="9" fill={ink(hue, 0.55, 0.22)} style={{ fontWeight: 900 }}>
            {m.text}
          </text>
        </Svg>
      );
    case "burst":
      return (
        <Svg>
          <path
            transform="translate(56 24)"
            d={Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const r = i % 2 ? 9 : 19;
              return `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r * 0.85).toFixed(1)}`;
            }).join(" ") + "Z"}
            fill="oklch(0.9 0.19 95)"
            stroke="#111"
            strokeWidth="1"
          />
          <text x="56" y="27.5" textAnchor="middle" fontSize="8" fill="#d6262c" transform="rotate(-8 56 24)" style={{ fontWeight: 900 }}>
            {m.text}
          </text>
        </Svg>
      );
    case "frame":
      return (
        <Svg>
          <rect x="3" y="3" width="74" height="94" fill="none" stroke="oklch(0.88 0.18 95)" strokeWidth="6" />
        </Svg>
      );
    case "blueprint":
      return (
        <Filter filter="grayscale(1) contrast(1.3)">
          <Svg>
            <rect width="80" height="100" fill="oklch(0.42 0.14 255)" opacity="0.55" style={{ mixBlendMode: "multiply" }} />
            <pattern id={`${u}-grid`} width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M8 0 H0 V8" fill="none" stroke="#fff" strokeWidth="0.3" opacity="0.55" />
            </pattern>
            <rect width="80" height="100" fill={`url(#${u}-grid)`} />
            <path d="M10 90 H70 M10 87 V93 M70 87 V93" stroke="#fff" strokeWidth="0.6" />
          </Svg>
        </Filter>
      );
    case "pop":
      return (
        <Svg>
          <rect x="0" y="0" width="80" height="26" fill={ink(hue, 0.82, 0.2)} opacity="0.75" style={{ mixBlendMode: "multiply" }} />
          <pattern id={`${u}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.9" fill="#111" opacity="0.5" />
          </pattern>
          <rect x="44" y="70" width="36" height="30" fill={`url(#${u}-dots)`} />
        </Svg>
      );
    case "fragments":
    case "mirror":
      return (
        <Svg>
          <g fill="none" stroke="#fff" strokeWidth={m.kind === "mirror" ? 0.7 : 1.4} opacity="0.85">
            <path d="M40 46 L8 0 M40 46 L80 18 M40 46 L70 100 M40 46 L0 70 M40 46 L36 100 M40 46 L52 0" />
          </g>
          {m.kind === "fragments" && <rect x="44" y="52" width="22" height="18" fill={ink(hue, 0.8, 0.15)} opacity="0.5" transform="rotate(8 55 61)" />}
        </Svg>
      );
    case "particles":
    case "bubbles":
      return (
        <Svg>
          {[
            [12, 20, 2],
            [26, 70, 3],
            [62, 30, 4],
            [70, 76, 2.5],
            [44, 12, 1.5],
            [52, 88, 2],
            [8, 52, 1.2],
          ].map(([x, y, r], i) =>
            m.kind === "bubbles" ? (
              <circle key={i} cx={x} cy={y} r={r * 2} fill="none" stroke="#fff" strokeWidth="0.6" opacity="0.8" />
            ) : (
              <circle key={i} cx={x} cy={y} r={r} fill={ink(hue + i * 30, 0.9, 0.16)} opacity="0.85" />
            ),
          )}
        </Svg>
      );
    case "origami":
      return (
        <Svg>
          <path d="M0 100 L40 56 L80 100z" fill="#fff" opacity="0.28" />
          <path d="M40 56 L80 100 L80 40z" fill={ink(hue, 0.7, 0.12)} opacity="0.35" />
          <path d="M0 0 L36 0 L0 34z" fill="#fff" opacity="0.22" />
        </Svg>
      );
    case "magazine":
      return (
        <Svg>
          <text x="6" y="16" fontSize="13" fill="#fff" style={{ fontFamily: "Georgia, serif", fontWeight: 900, letterSpacing: -0.5 }}>
            ISSUE 07
          </text>
          <rect x="6" y="84" width="28" height="2" fill="#fff" />
          <rect x="6" y="88" width="20" height="2" fill="#fff" opacity="0.7" />
        </Svg>
      );
    case "marble":
      return (
        <Filter filter="grayscale(0.85) brightness(1.15) contrast(1.1)">
          <Svg>
            <path d="M0 30 C20 24 30 44 50 36 S70 50 80 44 M0 72 C14 66 30 80 46 72 S70 84 80 78" fill="none" stroke="#9aa0a6" strokeWidth="0.6" opacity="0.7" />
          </Svg>
        </Filter>
      );
  }
}

/** The preset's motif over its preview card, if it has one. */
export function LookMotif({ id, hue }: { id: string; hue: number }) {
  // Pattern and filter ids are per card: 44 cards on a page, each with its own colours.
  const u = `lm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const m = MOTIFS[id];
  if (!m) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden" aria-hidden>
      <Draw m={m} hue={hue} u={u} />
    </div>
  );
}

/** Presets with a motif (for tests). */
export const MOTIF_IDS = Object.keys(MOTIFS);
