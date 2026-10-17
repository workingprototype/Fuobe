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

/*
 * Which preview plays. One at a time everywhere: the hovered or focused card on devices that can
 * hover, otherwise the card nearest the middle of the screen while it's mostly in view (phones).
 * Nothing plays when the user prefers reduced motion.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let active: string | null = null;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function setActive(id: string | null) {
  if (active === id) return;
  active = id;
  emit();
}

const mq = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
const canHover = () => mq("(hover: hover) and (pointer: fine)");
const reducedMotion = () => mq("(prefers-reduced-motion: reduce)");

/** Touch devices: the most visible card closest to the viewport's middle plays. */
const watched = new Map<Element, string>();
const ratios = new Map<Element, number>();
let observer: IntersectionObserver | null = null;
let raf = 0;

function pickCentered() {
  raf = 0;
  const mid = window.innerHeight / 2;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [el, ratio] of ratios) {
    if (ratio < 0.6) continue;
    const r = el.getBoundingClientRect();
    const dist = Math.abs(r.top + r.height / 2 - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = watched.get(el) ?? null;
    }
  }
  setActive(best);
}

const onScroll = () => {
  raf ||= requestAnimationFrame(pickCentered);
};

function watch(el: Element, id: string) {
  if (typeof IntersectionObserver === "undefined") return () => {};
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
      raf ||= requestAnimationFrame(pickCentered);
    },
    { threshold: [0, 0.6, 0.85, 1] },
  );
  if (!watched.size) window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  watched.set(el, id);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    watched.delete(el);
    ratios.delete(el);
    if (!watched.size) window.removeEventListener("scroll", onScroll, { capture: true });
    if (active === id) setActive(null);
  };
}

/**
 * Wire a card element to the playback store. Returns whether its preview should play and the
 * handlers to spread on the card (hover and focus on desktop; touch devices use visibility).
 */
export function usePreviewPlayback<T extends HTMLElement>(id: string) {
  const ref = useRef<T | null>(null);
  const playing = useSyncExternalStore(
    subscribe,
    () => active === id,
    () => false,
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || canHover() || reducedMotion()) return;
    return watch(el, id);
  }, [id]);
  useEffect(
    () => () => {
      if (active === id) setActive(null);
    },
    [id],
  );
  const on = () => {
    if (!reducedMotion()) setActive(id);
  };
  const off = () => {
    if (active === id) setActive(null);
  };
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
export const PresetPreview = memo(function PresetPreview({ preview, hue, playing }: { preview: Preview; hue: number; playing: boolean }) {
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
      aria-hidden
    >
      <div className="pv-cam">
        <div className="pv-shake">
          {/* The poster stays underneath, so nothing flashes while the layers load. */}
          <Dup src={preview.poster} className="pv-poster" />
          {spec &&
            armed &&
            PREVIEW_LAYERS.map((l) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={l} src={sceneLayer(preview.scene, l)} alt="" draggable={false} decoding="async" className={`pv-img pv-layer pv-l-${l}`} style={layerVars(l)} />
            ))}
          {preview.fx && (
            <div className="pv-fx">
              <Fx fx={preview.fx} scene={preview.scene} />
            </div>
          )}
        </div>
      </div>
      <i className="pv-tint" />
    </div>
  );
});
