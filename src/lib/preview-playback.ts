/**
 * Which gallery preview plays (preset-preview.tsx). One at a time everywhere: the hovered or
 * focused card on devices that can hover, otherwise the card nearest the middle of the screen
 * while it's mostly in view (phones). Nothing plays when the user prefers reduced motion.
 *
 * Pure apart from the environment it's given, so the rules are testable without a browser.
 */

/** What the store needs from the browser. */
export interface PlaybackEnv {
  matches(query: string): boolean;
  /** Undefined where IntersectionObserver doesn't exist (then nothing auto-plays). */
  IntersectionObserver?: new (cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => Pick<IntersectionObserver, "observe" | "unobserve">;
  requestFrame(cb: () => void): number;
  viewportHeight(): number;
  onScroll(cb: () => void): void;
  offScroll(cb: () => void): void;
}

/** A card must be at least this much in view to play on a phone. */
export const MIN_VISIBLE = 0.6;

export function createPlaybackStore(env: PlaybackEnv) {
  const listeners = new Set<() => void>();
  let active: string | null = null;
  const watched = new Map<Element, string>();
  const ratios = new Map<Element, number>();
  let observer: Pick<IntersectionObserver, "observe" | "unobserve"> | null = null;
  let frame = 0;

  const setActive = (id: string | null) => {
    if (active === id) return;
    active = id;
    listeners.forEach((l) => l());
  };

  /** Phones: the most visible card closest to the viewport's middle plays. */
  const pickCentered = () => {
    frame = 0;
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
  const schedule = () => {
    frame ||= env.requestFrame(pickCentered);
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
    reducedMotion: () => env.matches("(prefers-reduced-motion: reduce)"),
    /** Hover / focus: play this one (unless motion is reduced). */
    play(id: string) {
      if (!env.matches("(prefers-reduced-motion: reduce)")) setActive(id);
    },
    /** Stop this one, if it's the one playing. */
    stop(id: string) {
      if (active === id) setActive(null);
    },
    /** Touch devices: let visibility decide whether `el` plays. Returns the cleanup. */
    watch(el: Element, id: string): () => void {
      const IO = env.IntersectionObserver;
      if (!IO) return () => {};
      observer ??= new IO(
        (entries) => {
          for (const e of entries) ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
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
        if (!watched.size) env.offScroll(schedule);
        if (active === id) setActive(null);
      };
    },
    /** For tests: how many cards are watched. */
    watchedCount: () => watched.size,
  };
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

/** The real browser; every member is safe to call during server rendering. */
export const browserPlaybackEnv: PlaybackEnv = {
  matches: (q) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches,
  get IntersectionObserver() {
    return typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver;
  },
  requestFrame: (cb) => requestAnimationFrame(cb),
  viewportHeight: () => window.innerHeight,
  onScroll: (cb) => window.addEventListener("scroll", cb, { passive: true, capture: true }),
  offScroll: (cb) => window.removeEventListener("scroll", cb, { capture: true }),
};
