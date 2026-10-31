"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { cn } from "@/lib/utils";

export interface BeforeAfterPair {
  id: string;
  name: string;
  before: string;
  after: string;
  /** What each side shows: "Sketch", "Photo". */
  tags: string[];
  /** How much both pictures are enlarged, so an edge in the source never shows. */
  zoom: number;
  href: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** The one-time peek: where the handle goes, and how long it takes, once the picture is mostly in view. */
const PEEK = [50, 80, 20, 50];
const PEEK_MS = 1400;

/**
 * An app's before and after, to drag between, with a tab per app. The first time it's mostly in view (and both
 * pictures are in), the handle sweeps once to show it moves; any touch or key stops that, and with reduced motion it
 * never moves by itself. Stills only: it plays no clip.
 */
export function BeforeAfter({ pairs }: { pairs: BeforeAfterPair[] }) {
  const [tab, setTab] = useState(0);
  const [pos, setPos] = useState(50);
  /** Bumped as each picture comes in, to look again whether the peek can start. */
  const [loaded, setLoaded] = useState(0);
  const [inView, setInView] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** Set once the peek ran, or the viewer moved the handle first. */
  const peeked = useRef(false);
  const frame = useRef(0);
  const id = useId();
  const pair = pairs[tab];
  const [beforeTag, afterTag] = pair.tags;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio < 0.6) return;
      setInView(true);
      io.disconnect();
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    // Both pictures in (a load before hydration fires no onLoad, so look at them too).
    const shown = [...(box.current?.querySelectorAll("img") ?? [])].every((img) => img.complete && img.naturalWidth > 0);
    if (!inView || !shown || peeked.current) return;
    peeked.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / PEEK_MS);
      const leg = Math.min(PEEK.length - 2, Math.floor(p * (PEEK.length - 1)));
      const local = p * (PEEK.length - 1) - leg;
      setPos(PEEK[leg] + (PEEK[leg + 1] - PEEK[leg]) * easeInOut(local));
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [inView, loaded]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** The viewer takes over: no more peeking. */
  const take = () => {
    peeked.current = true;
    cancelAnimationFrame(frame.current);
  };
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100);
  };
  const pick = (i: number) => {
    if (i === tab) return;
    take();
    setTab(i);
    setPos(50);
  };
  const preload = (p: BeforeAfterPair) => {
    for (const src of [p.before, p.after]) new Image().src = src;
  };
  const value = Math.round(pos);

  return (
    <div className="w-full max-w-[512px] xl:max-w-[460px]">
      <div
        ref={box}
        id={`${id}-panel`}
        role="tabpanel"
        aria-label={`${pair.name}: ${beforeTag} and ${afterTag}`}
        className="relative isolate aspect-[4/3] cursor-ew-resize touch-pan-y overflow-hidden rounded-xl bg-muted select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          take();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPos(at(e.clientX));
        }}
        onPointerMove={(e) => dragging.current && setPos(at(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <div key={pair.id} className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          {/* Both enlarged alike (pair.zoom), so an edge in the source never shows; the after is cut at the handle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pair.before}
            alt=""
            width={512}
            height={384}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded((n) => n + 1)}
            className="absolute inset-0 size-full object-cover"
            style={{ scale: pair.zoom }}
          />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pair.after}
              alt=""
              width={512}
              height={384}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded((n) => n + 1)}
              className="absolute inset-0 size-full object-cover"
              style={{ scale: pair.zoom }}
            />
          </div>
        </div>
        <span className="pointer-events-none absolute top-2.5 left-2.5 rounded bg-black/45 px-1.5 text-[11px] leading-5 text-white">{beforeTag}</span>
        <span className="pointer-events-none absolute top-2.5 right-2.5 rounded bg-black/45 px-1.5 text-[11px] leading-5 text-white">{afterTag}</span>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_6px_rgb(0_0_0/35%)]" style={{ left: `${pos}%` }} />
        <span
          role="slider"
          tabIndex={0}
          aria-label={`Compare ${beforeTag.toLowerCase()} and ${afterTag.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={`${beforeTag} ${value}%, ${afterTag} ${100 - value}%`}
          onKeyDown={(e) => {
            const big = e.shiftKey ? 25 : 5;
            const next =
              e.key === "ArrowLeft" || e.key === "ArrowDown" ? pos - big : e.key === "ArrowRight" || e.key === "ArrowUp" ? pos + big : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
            if (next === null) return;
            e.preventDefault();
            take();
            setPos(clamp(next));
          }}
          className="absolute top-1/2 -mt-3.5 -ml-3.5 grid size-7 place-items-center rounded-full bg-white text-black shadow-[0_2px_8px_rgb(0_0_0/30%)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ left: `${pos}%` }}
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
            <path d="M6 4 2 8l4 4V4Zm4 0v8l4-4-4-4Z" />
          </svg>
        </span>
      </div>
      <div
        role="tablist"
        aria-label="Apps to compare"
        className="mt-2 flex gap-1.5"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const next = (tab + (e.key === "ArrowRight" ? 1 : pairs.length - 1)) % pairs.length;
          pick(next);
          (e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next] as HTMLElement | undefined)?.focus();
        }}
      >
        {pairs.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === tab}
            aria-controls={`${id}-panel`}
            tabIndex={i === tab ? 0 : -1}
            onClick={() => pick(i)}
            onPointerEnter={() => preload(p)}
            onFocus={() => preload(p)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg p-1 pr-1.5 text-left sm:gap-2 sm:pr-2 text-[12px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              i === tab && "bg-muted text-foreground",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/previews/presets/thumbs/${p.id}.jpg`} alt="" width={56} height={42} loading="lazy" decoding="async" className="h-6 w-8 shrink-0 rounded object-cover sm:h-[42px] sm:w-14 sm:rounded-md" />
            <span className="line-clamp-2 leading-tight">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
        <span>Drag to compare</span>
        <IntentLink href={pair.href} className="inline-flex items-center gap-1 font-medium text-brand-text hover:underline underline-offset-2">
          Try {pair.name} <ArrowRight className="size-3.5" />
        </IntentLink>
      </div>
    </div>
  );
}
