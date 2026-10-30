"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { releaseVideo } from "@/lib/media-release";
import type { PreviewSources } from "@/lib/preview-media";

/** How long a stopped clip stays mounted: its fade-out, and a quick hover back resumes it instead of reloading. */
const LINGER_MS = 250;

/**
 * A card's rendered preview (lib/preview-media.ts), filling its positioned parent: the poster as a
 * <picture> (AVIF srcset with a WebP fallback, lazy unless `priority`) and, only while `playing`,
 * the muted loop, which fades in over the poster once it actually plays and is unmounted shortly
 * after it stops. One preview plays at a time (lib/preview-playback.ts), so a page keeps at most
 * one video element alive, plus one fading out. With reduced motion only the poster shows.
 * `onError` fires when the poster or the clip doesn't load, so the card can show something else.
 */
export function PreviewMedia({
  src,
  playing,
  sizes,
  priority,
  onError,
}: {
  src: PreviewSources;
  playing: boolean;
  /** How wide the card is drawn (PREVIEW_SIZES), for picking from the AVIF srcset. */
  sizes: string;
  /** Load the poster at once, ahead of other images (a gallery's first row). */
  priority?: boolean;
  onError?: () => void;
}) {
  const reduced = useReducedMotion();
  // A still (no clip yet) only ever shows its poster.
  const play = playing && !reduced && src.mp4Src !== undefined;
  const img = useRef<HTMLImageElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  // The clip's element exists from the moment it should play until LINGER_MS after it stops…
  const [mounted, setMounted] = useState(false);
  // …and shows once it has started; until then the poster shows through.
  const [started, setStarted] = useState(false);
  if (play && !mounted) setMounted(true);

  useEffect(() => {
    if (play || !mounted) return;
    // State only, the element is let go below once it's really gone: a hover back that lands before
    // React commits this keeps the element, still playing and shown.
    const t = setTimeout(() => setMounted(false), LINGER_MS);
    return () => clearTimeout(t);
  }, [play, mounted]);

  const mp4 = src.mp4Src;
  useEffect(() => {
    if (!mounted || !mp4) return;
    const v = video.current;
    if (!v) return;
    // A re-run after this effect's cleanup (Strict Mode, a page shown again from a hidden <Activity>) gets its source back.
    if (!v.getAttribute("src")) v.setAttribute("src", mp4);
    // autoPlay starts it as well; this covers browsers that hold the attribute back.
    void v.play().catch(() => {});
    return () => {
      // Let go of the decoder and the connection when the element goes, not when it's garbage collected.
      releaseVideo(v);
      setStarted(false);
    };
  }, [mounted, mp4]);

  // A poster that failed before hydration fired its error event before React was listening.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && !el.naturalWidth) onError?.();
  }, [onError]);

  return (
    <>
      <picture>
        <source type="image/avif" srcSet={src.avifSrcSet} sizes={sizes} />
        <img
          ref={img}
          src={src.webpSrc}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          draggable={false}
          onError={onError}
          className="absolute inset-0 size-full object-cover select-none"
        />
      </picture>
      {mounted && mp4 && (
        <video
          ref={video}
          src={mp4}
          muted
          playsInline
          loop
          autoPlay
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          aria-hidden
          onPlaying={() => setStarted(true)}
          // Letting go of the source (above) isn't a failure.
          onError={(e) => e.currentTarget.hasAttribute("src") && onError?.()}
          data-shown={(play && started) || undefined}
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200 data-shown:opacity-100"
        />
      )}
    </>
  );
}
