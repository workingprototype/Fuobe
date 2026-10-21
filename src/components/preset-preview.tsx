"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CAMERA_MOVES,
  LAYER_DEPTH,
  LAYER_OFFSET,
  moveVars,
  PREVIEW_LAYERS,
  sceneLayer,
  scenePoster,
  type MoveSpec,
  type PresetPreview as Preview,
  type PreviewLayer,
  type PreviewScene,
} from "@/lib/preset-cards";
import { glyphFor } from "@/lib/move-glyphs";
import { browserPlaybackEnv, createPlaybackStore } from "@/lib/preview-playback";

/** One preview plays at a time (rules in lib/preview-playback.ts). */
const store = createPlaybackStore(browserPlaybackEnv);

/**
 * Wire a card element to the playback store. Returns whether its preview should play and the
 * handlers to spread on the card (hover and focus on desktop; touch devices use visibility).
 */
export function usePreviewPlayback<T extends HTMLElement>(id: string) {
  const ref = useRef<T | null>(null);
  const playing = useSyncExternalStore(
    store.subscribe,
    () => store.isActive(id),
    () => false,
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || store.canHover() || store.reducedMotion()) return;
    return store.watch(el, id);
  }, [id]);
  useEffect(() => () => store.stop(id), [id]);
  const on = () => store.play(id);
  const off = () => store.stop(id);
  return {
    ref,
    playing,
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && on(),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && off(),
      onFocus: on,
      onBlur: off,
    },
  };
}

const layerVars = (l: PreviewLayer) => ({ "--d": LAYER_DEPTH[l], "--o": LAYER_OFFSET[l] }) as React.CSSProperties;

/** The other still a transition wipes to. */
const NEXT_SCENE: Record<PreviewScene, PreviewScene> = { landscape: "city", city: "landscape", portrait: "landscape", product: "portrait" };

function Sparks({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className="pv-spark" style={{ "--i": i } as React.CSSProperties} />
      ))}
    </>
  );
}

function Dup({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" draggable={false} decoding="async" className={`pv-img ${className}`} />;
}

/** Per-treatment overlay markup; the look and motion live in globals.css (`.pv-*`). */
function Fx({ fx, scene }: { fx: NonNullable<Preview["fx"]>; scene: PreviewScene }) {
  const poster = scenePoster(scene);
  switch (fx) {
    case "fire":
      return (
        <>
          <i className="pv-fire" />
          <i className="pv-fire pv-fire-2" />
          <Sparks n={5} />
        </>
      );
    case "water":
      return (
        <>
          <i className="pv-wave" />
          <i className="pv-wave pv-wave-2" />
        </>
      );
    case "ice":
      return (
        <>
          <i className="pv-frost" />
          <Sparks n={4} />
        </>
      );
    case "wind":
      return <i className="pv-streaks" />;
    case "lightning":
      return (
        <>
          <svg className="pv-bolt" viewBox="0 0 40 100" aria-hidden>
            <path d="M24 0 L8 52 H20 L12 100 L34 40 H22 L30 0Z" />
          </svg>
          <i className="pv-flash" />
        </>
      );
    case "explode":
      return (
        <>
          <i className="pv-burst" />
          <i className="pv-flash" />
          <Sparks n={6} />
        </>
      );
    case "glow":
      return (
        <>
          <i className="pv-halo" />
          <Sparks n={6} />
        </>
      );
    case "sparkle":
      return <Sparks n={9} />;
    case "petals":
      return (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className="pv-petal" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </>
      );
    case "relight":
      return (
        <>
          <i className="pv-shade" />
          <i className="pv-light" />
        </>
      );
    case "dark":
      return (
        <>
          <i className="pv-vignette" />
          <i className="pv-blood" />
        </>
      );
    case "flare":
      return (
        <>
          <i className="pv-flare" />
          <i className="pv-flash pv-flash-soft" />
        </>
      );
    case "morph":
    case "swap":
      return (
        <>
          <Dup src={sceneLayer(scene, "subject")} className={`pv-wipe-v ${fx === "morph" ? "pv-morph" : "pv-recolor"}`} />
          <i className="pv-seam pv-seam-h" />
        </>
      );
    case "grade":
      return (
        <>
          <Dup src={poster} className="pv-wipe-h pv-graded" />
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "halftone":
      return (
        <>
          <span className="pv-wipe-h pv-halftone">
            <Dup src={poster} className="pv-inked" />
          </span>
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "sharpen":
      return (
        <>
          <Dup src={poster} className="pv-wipe-h pv-soft" />
          <i className="pv-seam pv-seam-v pv-knob" />
        </>
      );
    case "wipe":
      return (
        <>
          <Dup src={scenePoster(NEXT_SCENE[scene])} className="pv-wipe-h" />
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "glitch":
      return (
        <>
          <Dup src={poster} className="pv-rgb" />
          <Dup src={poster} className="pv-slice" />
          <Dup src={poster} className="pv-slice pv-slice-2" />
        </>
      );
    case "tiny":
      return <i className="pv-ring" />;
    case "scan":
      return (
        <>
          <i className="pv-grid" />
          <i className="pv-scanline" />
          <i className="pv-brackets" />
        </>
      );
    case "shine":
      return <i className="pv-shine" />;
    case "frame":
      return (
        <>
          <i className="pv-brackets pv-brackets-wide" />
          <i className="pv-rec" />
        </>
      );
    case "play":
      return (
        <>
          <i className="pv-progress" />
          <i className="pv-play" />
        </>
      );
    case "crack":
      return (
        <>
          <svg className="pv-crack" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden>
            <path d="M62 30 L69 22 L77 23 L86 10 L93 7 M62 30 L73 35 L86 33 L100 41 M62 30 L64 43 L58 54 L61 75 M62 30 L51 31 L41 25 L23 27 L0 19 M62 30 L53 41 L45 48 L31 62 L24 75 M62 30 L60 17 L54 7 L56 0 M77 23 L80 31 M51 31 L49 40 M58 54 L50 58" />
            <circle cx="62" cy="30" r="2.2" />
          </svg>
          <i className="pv-flash" />
        </>
      );
    case "pop":
    default:
      return <Sparks n={6} />;
  }
}

/**
 * A preset's preview: a real clip when the catalog has one, otherwise the procedural version, a
 * camera move over a layered sample still (motions) or an animated treatment (effects, apps).
 * At rest it shows the poster frame (and the treatment's still frame); `playing` runs it. The depth
 * layers a camera move needs are only mounted once the card first plays.
 */
export const PresetPreview = memo(function PresetPreview({
  preview,
  hue,
  playing,
  flip,
}: {
  preview: Preview;
  hue: number;
  playing: boolean;
  /** Mirror the still (see previewFlip). */
  flip?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  if (playing && !armed) setArmed(true);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});
    else {
      v.pause();
      v.currentTime = 0;
    }
  }, [playing]);

  if (preview.video)
    return (
      <video
        ref={video}
        src={preview.video}
        poster={preview.poster}
        muted
        loop
        playsInline
        preload="none"
        className="absolute inset-0 size-full object-cover"
        aria-hidden
      />
    );

  const spec: MoveSpec | undefined = preview.move ? CAMERA_MOVES[preview.move] : undefined;
  const glyph = preview.move ? glyphFor(preview.move) : undefined;
  const style = { "--pv-hue": hue, ...(spec ? moveVars(spec) : {}) } as React.CSSProperties;
  return (
    <div
      className="pv"
      style={style}
      data-playing={playing || undefined}
      data-profile={spec?.profile}
      data-stage={spec?.stage}
      data-through={spec?.through || undefined}
      data-fx={preview.fx}
      data-flip={flip || undefined}
      aria-hidden
    >
      <div className="pv-cam">
        <div className="pv-shake">
          {/* The poster stays underneath, so nothing flashes while the layers load. */}
          {/* A camera move's poster rests partway into the move (the subject layer's transform). */}
          {spec ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.poster} alt="" draggable={false} decoding="async" className="pv-img pv-poster pv-layer" style={layerVars("subject")} />
          ) : (
            <Dup src={preview.poster} className="pv-poster" />
          )}
          {spec &&
            armed &&
            PREVIEW_LAYERS.map((l) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={l} src={sceneLayer(preview.scene, l)} alt="" draggable={false} decoding="async" className={`pv-img pv-layer pv-l-${l}`} style={layerVars(l)} />
            ))}
          {/* The preset's hue recolors the still only; the treatment keeps its own colors. */}
          <i className="pv-tint" />
          {preview.fx && (
            <div className="pv-fx">
              <Fx fx={preview.fx} scene={preview.scene} />
            </div>
          )}
        </div>
      </div>
      {glyph && (
        <svg className="pv-glyph" viewBox="0 0 48 36" aria-hidden>
          {glyph.map((part, i) => (
            <path key={i} d={part.d} data-dashed={part.dashed || undefined} />
          ))}
        </svg>
      )}
    </div>
  );
});
