/**
 * Which gallery preview plays (preset-preview.tsx). One at a time everywhere: on devices that can
 * hover, the hovered or focused card once the pointer has rested on it for a moment (a pointer
 * crossing the grid doesn't start every card it passes); otherwise the card nearest the middle of
 * the screen while it's mostly in view, once scrolling has stopped (phones; not with Save-Data or
 * on a 2G connection). Nothing plays when the user prefers reduced motion.
 *
 * Pure apart from the environment it's given, so the rules are testable without a browser.
 */

/** What the store needs from the browser. */
export interface PlaybackEnv {
  matches(query: string): boolean;
  /** Undefined where IntersectionObserver doesn't exist (then nothing auto-plays). */
  IntersectionObserver?: new (cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => Pick<IntersectionObserver, "observe" | "unobserve">;
  /** Run `cb` after `ms` milliseconds; returns what cancels it. */
  delay(cb: () => void, ms: number): () => void;
  viewportHeight(): number;
  onScroll(cb: () => void): void;
  offScroll(cb: () => void): void;
  /** The user asked for less data (Save-Data), or the connection is 2G. */
  saveData(): boolean;
}

/** A card must be at least this much in view to play on a phone. */
export const MIN_VISIBLE = 0.6;
/** How long the pointer (or focus) rests on a card before it plays, in ms. */
export const HOVER_INTENT = 120;
/** On phones, how long scrolling must have stopped before the centred card plays, in ms. */
export const SCROLL_SETTLE = 400;

export function createPlaybackStore(env: PlaybackEnv) {
  const listeners = new Set<() => void>();
  let active: string | null = null;
  const watched = new Map<Element, string>();
  const ratios = new Map<Element, number>();
  let observer: Pick<IntersectionObserver, "observe" | "unobserve"> | null = null;
  /** The card a hover is about to play, and what calls that off. */
  let pending: { id: string; cancel: () => void } | null = null;
  let settle: (() => void) | null = null;

  const setActive = (id: string | null) => {
    if (active === id) return;
    active = id;
    listeners.forEach((l) => l());
  };
  const reducedMotion = () => env.matches("(prefers-reduced-motion: reduce)");
  const cancelPending = () => {
    pending?.cancel();
    pending = null;
  };

  /** Phones: the most visible card closest to the viewport's middle plays. */
  const pickCentered = () => {
    settle = null;
    const mid = env.viewportHeight() / 2;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const [el, ratio] of ratios) {
      if (ratio < MIN_VISIBLE) continue;
      const r = el.getBoundingClientRect();
      const dist = Math.abs(r.top + r.height / 2 - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = watched.get(el) ?? null;
      }
    }
    setActive(best);
  };
  /** Pick once the page is still: every scroll (or visibility change) starts the wait over. */
  const schedule = () => {
    settle?.();
    settle = env.delay(pickCentered, SCROLL_SETTLE);
  };

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getActive: () => active,
    isActive: (id: string) => active === id,
    canHover: () => env.matches("(hover: hover) and (pointer: fine)"),
    reducedMotion,
    saveData: () => env.saveData(),
    /** Hover / focus: play this one once it has had the pointer for HOVER_INTENT (unless motion is reduced). */
    play(id: string) {
      cancelPending();
      if (reducedMotion()) return;
      const cancel = env.delay(() => {
        pending = null;
        setActive(id);
      }, HOVER_INTENT);
      pending = { id, cancel };
    },
    /** Stop this one, if it's the one playing (or about to). */
    stop(id: string) {
      if (pending?.id === id) cancelPending();
      if (active === id) setActive(null);
    },
    /** Touch devices: let visibility decide whether `el` plays. Returns the cleanup. */
    watch(el: Element, id: string): () => void {
      const IO = env.IntersectionObserver;
      // Each card passing the middle of the screen would start a download: none with Save-Data or on 2G.
      if (!IO || env.saveData()) return () => {};
      observer ??= new IO(
        (entries) => {
          for (const e of entries) {
            const ratio = e.isIntersecting ? e.intersectionRatio : 0;
            ratios.set(e.target, ratio);
            // The playing card stops as soon as it's mostly out of view; the next one waits for the scroll to settle.
            if (ratio < MIN_VISIBLE && active !== null && watched.get(e.target) === active) setActive(null);
          }
          schedule();
        },
        { threshold: [0, MIN_VISIBLE, 0.85, 1] },
      );
      if (!watched.size) env.onScroll(schedule);
      watched.set(el, id);
      observer.observe(el);
      return () => {
        observer?.unobserve(el);
        watched.delete(el);
        ratios.delete(el);
        if (!watched.size) {
          env.offScroll(schedule);
          settle?.();
          settle = null;
        }
        if (active === id) setActive(null);
      };
    },
    /** For tests: how many cards are watched. */
    watchedCount: () => watched.size,
  };
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

type Connection = { saveData?: boolean; effectiveType?: string };

/** The real browser; every member is safe to call during server rendering. */
export const browserPlaybackEnv: PlaybackEnv = {
  matches: (q) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches,
  get IntersectionObserver() {
    return typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver;
  },
  delay: (cb, ms) => {
    const t = setTimeout(cb, ms);
    return () => clearTimeout(t);
  },
  viewportHeight: () => window.innerHeight,
  onScroll: (cb) => window.addEventListener("scroll", cb, { passive: true, capture: true }),
  offScroll: (cb) => window.removeEventListener("scroll", cb, { capture: true }),
  saveData: () => {
    const c = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connection }).connection;
    // effectiveType is "slow-2g", "2g", "3g" or "4g" (Chromium only; elsewhere this is false).
    return !!c && (c.saveData === true || !!c.effectiveType?.endsWith("2g"));
  },
};
