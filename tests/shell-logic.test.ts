import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECTS, MOTIONS } from "@/lib/catalog";
import { copyText, copyWithToast } from "@/lib/clipboard";
import { loseContext, releaseVideo } from "@/lib/media-release";
import { GLYPHS, MOVE_GLYPH, glyphFor } from "@/lib/move-glyphs";
import {
  CAMERA_MOVES,
  effectFx,
  homeEffects,
  interleaveByCategory,
  motionMove,
  previewFlip,
  stableHash,
  type CameraMove,
} from "@/lib/preset-cards";
import { previewFor, toPresetCard } from "@/lib/preset-card-data";
import { browserPlaybackEnv, createPlaybackStore, HOVER_INTENT, MIN_VISIBLE, SCROLL_SETTLE, type PlaybackEnv } from "@/lib/preview-playback";
import { pageAfter, progressiveStart, syncProgressive } from "@/lib/progressive";
import { storyboardName } from "@/lib/storyboard-board";

const toasts = vi.hoisted(() => ({ ok: [] as string[], error: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign((m: string) => void toasts.ok.push(m), { error: (m: string) => void toasts.error.push(m) }) }));
// The procedural previews are what these tests look at: no preset has a real cover here.
vi.mock("@/lib/preset-previews.generated", () => ({ PRESET_PREVIEWS: {} }));
import { capabilityGroup, usedByIndex } from "@/lib/workflow-usage";

describe("workflow 'used by' index", () => {
  const used = usedByIndex([
    { endpoint: "flux-dev-t2i", name: "FLUX.1 dev" },
    { endpoint: "flux-dev-t2i", name: "FLUX.1 dev" },
    { endpoint: "flux-dev-t2i", name: "FLUX Krea" },
    { endpoint: "video-concat-{n}", name: "Join clips" },
    { endpoint: "wan.2-{n}x", name: "Dotted" },
  ]);

  it("matches exact endpoints and dedupes names in route order", () => {
    expect(used("flux-dev-t2i")).toEqual(["FLUX.1 dev", "FLUX Krea"]);
    expect(used("flux-dev")).toEqual([]);
  });

  it("matches {n} endpoints for any count, including two-digit ones", () => {
    expect(used("video-concat-2")).toEqual(["Join clips"]);
    expect(used("video-concat-12")).toEqual(["Join clips"]);
    expect(used("video-concat-")).toEqual([]);
    expect(used("video-concat-2b")).toEqual([]);
  });

  it("treats the rest of a pattern literally", () => {
    expect(used("wan.2-4x")).toEqual(["Dotted"]);
    expect(used("wanX2-4x")).toEqual([]);
  });

  it("groups capabilities by what they make, for the filter chips", () => {
    expect(capabilityGroup("t2i")).toBe("Image");
    expect(capabilityGroup("bg-remove-video")).toBe("Video");
    expect(capabilityGroup("separate-audio")).toBe("Audio");
    expect(capabilityGroup("transcribe")).toBe("Text & 3D");
    expect(capabilityGroup("image-to-3d")).toBe("Text & 3D");
    // Not operations, still sorted sensibly.
    expect(capabilityGroup("draw-to-video")).toBe("Video");
    expect(capabilityGroup("camera-motion")).toBe("Video");
    expect(capabilityGroup("style-reference")).toBe("Image");
    expect(capabilityGroup("character-sheet")).toBe("Image");
  });
});

describe("progressive list paging", () => {
  it("keeps its count while the filter is unchanged and starts over when it changes", () => {
    let s = progressiveStart("all", 30);
    s = { ...s, shown: pageAfter(s.shown, 40) };
    expect(s.shown).toBe(70);
    expect(syncProgressive(s, "all", 30)).toBe(s);
    expect(syncProgressive(s, "fire", 30)).toEqual({ key: "fire", shown: 30 });
  });

  it("always grows by at least one", () => {
    expect(pageAfter(5, 0)).toBe(6);
  });
});

/** A fake browser for the playback store, with a clock that only moves when `advance` says so. */
function fakeEnv({ hover = false, reduced = false, height = 800, saveData = false } = {}) {
  let ioCallback: IntersectionObserverCallback | null = null;
  const observed = new Set<Element>();
  const scroll = new Set<() => void>();
  let now = 0;
  const timers = new Set<{ at: number; cb: () => void }>();
  const next = () => [...timers].sort((a, b) => a.at - b.at)[0];
  /** Move the clock on by `ms`, running the timers that come due, in order. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (let due = next(); due && due.at <= end; due = next()) {
      timers.delete(due);
      now = due.at;
      due.cb();
    }
    now = end;
  };
  const env: PlaybackEnv = {
    matches: (q) => (q.includes("reduced-motion") ? reduced : q.includes("hover") ? hover : false),
    IntersectionObserver: class {
      constructor(cb: IntersectionObserverCallback) {
        ioCallback = cb;
      }
      observe(el: Element) {
        observed.add(el);
      }
      unobserve(el: Element) {
        observed.delete(el);
      }
    },
    delay: (cb, ms) => {
      const t = { at: now + ms, cb };
      timers.add(t);
      return () => void timers.delete(t);
    },
    viewportHeight: () => height,
    onScroll: (cb) => scroll.add(cb),
    offScroll: (cb) => scroll.delete(cb),
    saveData: () => saveData,
  };
  const card = (top: number, h = 200) => ({ getBoundingClientRect: () => ({ top, height: h }) }) as unknown as Element;
  const intersect = (entries: [Element, number][]) =>
    ioCallback!(entries.map(([target, ratio]) => ({ target, intersectionRatio: ratio, isIntersecting: ratio > 0 }) as IntersectionObserverEntry), null as never);
  const scrolled = () => scroll.forEach((f) => f());
  return { env, card, intersect, scrolled, advance, observed, scroll, timers };
}

describe("preview playback store", () => {
  it("plays one preview at a time and stops only the one playing", () => {
    const { env, advance } = fakeEnv({ hover: true });
    const store = createPlaybackStore(env);
    const seen: (string | null)[] = [];
    store.subscribe(() => seen.push(store.getActive()));
    store.play("a");
    advance(HOVER_INTENT);
    store.play("b");
    advance(HOVER_INTENT);
    expect(store.isActive("a")).toBe(false);
    expect(store.isActive("b")).toBe(true);
    store.stop("a");
    expect(store.getActive()).toBe("b");
    store.stop("b");
    expect(seen).toEqual(["a", "b", null]);
  });

  it("waits for the pointer to rest on a card before playing it", () => {
    const { env, advance, timers } = fakeEnv({ hover: true });
    const store = createPlaybackStore(env);
    const seen: (string | null)[] = [];
    store.subscribe(() => seen.push(store.getActive()));
    // Crossing one card on the way to another starts neither until the pointer stops.
    store.play("a");
    advance(HOVER_INTENT - 20);
    store.stop("a");
    store.play("b");
    advance(HOVER_INTENT - 1);
    expect(store.getActive()).toBeNull();
    advance(1);
    expect(store.getActive()).toBe("b");
    // Leaving before the intent is up calls it off.
    store.play("c");
    store.stop("c");
    expect(timers.size).toBe(0);
    advance(1000);
    expect(seen).toEqual(["b"]);
  });

  it("plays nothing when the user prefers reduced motion", () => {
    const { env, advance } = fakeEnv({ reduced: true });
    const store = createPlaybackStore(env);
    store.play("a");
    advance(HOVER_INTENT);
    expect(store.getActive()).toBeNull();
    expect(store.reducedMotion()).toBe(true);
  });

  it("on phones plays the mostly visible card nearest the middle of the screen, once scrolling stops", () => {
    const { env, card, intersect, scrolled, advance } = fakeEnv({ height: 800 });
    const store = createPlaybackStore(env);
    const top = card(0); // centre at 100
    const mid = card(320); // centre at 420, nearest 400
    const low = card(560); // centre at 660
    store.watch(top, "top");
    store.watch(mid, "mid");
    store.watch(low, "low");
    intersect([
      [top, 1],
      [mid, MIN_VISIBLE - 0.1],
      [low, 1],
    ]);
    // Still scrolling: nothing starts (or downloads) yet.
    advance(SCROLL_SETTLE - 100);
    scrolled();
    advance(SCROLL_SETTLE - 1);
    expect(store.getActive()).toBeNull();
    advance(1);
    // The middle card isn't visible enough yet.
    expect(store.getActive()).toBe("low");
    intersect([[mid, 0.9]]);
    expect(store.getActive()).toBe("low");
    advance(SCROLL_SETTLE);
    expect(store.getActive()).toBe("mid");
  });

  it("stops the playing card as soon as it scrolls mostly out of view", () => {
    const { env, card, intersect, advance } = fakeEnv();
    const store = createPlaybackStore(env);
    const a = card(300);
    store.watch(a, "a");
    intersect([[a, 1]]);
    advance(SCROLL_SETTLE);
    expect(store.getActive()).toBe("a");
    intersect([[a, MIN_VISIBLE - 0.1]]);
    expect(store.getActive()).toBeNull();
  });

  it("doesn't autoplay on phones with Save-Data or on a 2G connection (hover still plays)", () => {
    const { env, card, advance, observed, scroll } = fakeEnv({ saveData: true });
    const store = createPlaybackStore(env);
    store.watch(card(300), "a")();
    expect(store.watchedCount()).toBe(0);
    expect(observed.size).toBe(0);
    expect(scroll.size).toBe(0);
    store.play("a");
    advance(HOVER_INTENT);
    expect(store.getActive()).toBe("a");
  });

  it("reads Save-Data and the connection type from the browser", () => {
    const saveData = (connection?: object) => {
      vi.stubGlobal("navigator", { connection });
      return browserPlaybackEnv.saveData();
    };
    try {
      expect(saveData()).toBe(false);
      expect(saveData({ saveData: true, effectiveType: "4g" })).toBe(true);
      expect(saveData({ saveData: false, effectiveType: "2g" })).toBe(true);
      expect(saveData({ effectiveType: "slow-2g" })).toBe(true);
      expect(saveData({ saveData: false, effectiveType: "3g" })).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cleans up: unwatching stops the card and the last one removes the scroll listener", () => {
    const { env, card, intersect, advance, observed, scroll, timers } = fakeEnv();
    const store = createPlaybackStore(env);
    const a = card(300);
    const b = card(900);
    const offA = store.watch(a, "a");
    const offB = store.watch(b, "b");
    expect(scroll.size).toBe(1);
    intersect([[a, 1]]);
    advance(SCROLL_SETTLE);
    expect(store.getActive()).toBe("a");
    offA();
    expect(store.getActive()).toBeNull();
    expect(observed.has(a)).toBe(false);
    expect(scroll.size).toBe(1);
    intersect([[b, 1]]);
    offB();
    expect(store.watchedCount()).toBe(0);
    expect(scroll.size).toBe(0);
    // A pick still waiting for the scroll to settle goes with the last card.
    expect(timers.size).toBe(0);
  });

  it("does nothing without IntersectionObserver", () => {
    const { env, card } = fakeEnv();
    const store = createPlaybackStore({ ...env, IntersectionObserver: undefined });
    store.watch(card(0), "a")();
    expect(store.watchedCount()).toBe(0);
  });
});

describe("camera move diagrams", () => {
  it("draws every camera move", () => {
    for (const move of Object.keys(CAMERA_MOVES) as CameraMove[]) {
      const parts = glyphFor(move);
      expect(parts.length, move).toBeGreaterThan(0);
      for (const p of parts) expect(p.d, move).toMatch(/^[MLHVQCSAZmlhvaz\d\s.,-]+$/);
    }
  });

  it("keeps every glyph inside its 48 × 36 box", () => {
    for (const [name, parts] of Object.entries(GLYPHS)) {
      for (const p of parts) {
        // Absolute M/L coordinates only (arcs and relative commands are checked by eye).
        for (const m of p.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          const [x, y] = [Number(m[1]), Number(m[2])];
          expect(x, name).toBeGreaterThanOrEqual(0);
          expect(x, name).toBeLessThanOrEqual(48);
          expect(y, name).toBeGreaterThanOrEqual(0);
          expect(y, name).toBeLessThanOrEqual(36);
        }
      }
    }
  });

  it("tells the common moves apart", () => {
    const glyph = (name: string) => MOVE_GLYPH[motionMove(MOTIONS.find((m) => m.name === name)!)];
    const names = ["Zoom In", "Zoom Out", "Dolly In", "Dolly Out", "Crash Zoom In", "Dolly Zoom In", "360 Orbit", "Arc Left", "Arc Right", "Crane Up", "Crane Down", "Truck Right", "Dutch Angle"];
    const glyphs = names.filter((n) => MOTIONS.some((m) => m.name === n)).map(glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    // Across the whole gallery the diagrams vary a lot.
    expect(new Set(MOTIONS.map((m) => MOVE_GLYPH[motionMove(m)])).size).toBeGreaterThanOrEqual(25);
  });
});

describe("gallery variety at rest", () => {
  it("hashes ids stably", () => {
    expect(stableHash("motion-zoom-in")).toBe(stableHash("motion-zoom-in"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("spreads the first page of motions over the stills", () => {
    const scenes = new Set(MOTIONS.slice(0, 15).map((m) => previewFor(m).scene));
    expect(scenes.size).toBeGreaterThanOrEqual(3);
  });

  it("doesn't put every destruction effect on the same still the same way round", () => {
    const destruction = EFFECTS.filter((e) => e.category === "Destruction").map(toPresetCard);
    expect(destruction.length).toBeGreaterThan(3);
    const looks = new Set(destruction.map((c) => `${c.preview.scene}|${previewFlip(c) ? 1 : 0}`));
    expect(looks.size).toBeGreaterThanOrEqual(3);
    // Neighbouring cards get different hues.
    expect(new Set(destruction.map((c) => c.hue)).size).toBe(destruction.length);
  });

  it("lets the categories take turns in a gallery's All view", () => {
    const items = [
      { id: "a1", category: "A" },
      { id: "a2", category: "A" },
      { id: "a3", category: "A" },
      { id: "b1", category: "B" },
      { id: "c1", category: "C" },
      { id: "c2", category: "C" },
    ];
    expect(interleaveByCategory(items).map((i) => i.id)).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
    // The first row of /effects no longer shows one category's near-identical cards.
    const firstRow = interleaveByCategory(EFFECTS.map(toPresetCard)).slice(0, 5);
    expect(new Set(firstRow.map((c) => c.category)).size).toBe(5);
    expect(new Set(firstRow.map((c) => c.preview.fx)).size).toBeGreaterThanOrEqual(4);
  });

  it("gives cracks, dust and floating heads their own treatment instead of another explosion", () => {
    const fx = (name: string) => effectFx(EFFECTS.find((e) => e.name === name)!);
    expect(fx("Lens Crack")).toBe("crack");
    expect(fx("Disintegration")).toBe("wind");
    expect(fx("Head Off")).toBe("glow");
    expect(fx("Building Explosion")).toBe("explode");
  });

  it("shows one effect per category on Home, the popular one when there is one", () => {
    const row = homeEffects(EFFECTS, 6);
    expect(row).toHaveLength(6);
    expect(new Set(row.map((e) => e.category)).size).toBe(6);
    for (const e of row) {
      const top = EFFECTS.find((x) => x.category === e.category && x.badges?.includes("top"));
      if (top) expect(e.id).toBe(top.id);
    }
    expect(new Set(row.map((e) => previewFor(e).fx)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("storyboard name", () => {
  it("is the idea, or the first scene written by hand", () => {
    expect(storyboardName("  a fox\n in the snow ", ["wide: a fox — beat 1 of 3"])).toBe("a fox in the snow");
    expect(storyboardName(undefined, ["", "The keeper climbs"])).toBe("The keeper climbs");
    expect(storyboardName("", [])).toBe("Storyboard");
    expect(storyboardName("x".repeat(500), [])).toHaveLength(200);
  });
});

describe("releasing color grading's media", () => {
  it("pauses a detached video, drops its source and resets it (in that order)", () => {
    const calls: string[] = [];
    releaseVideo({ pause: () => calls.push("pause"), removeAttribute: (n) => calls.push(`remove ${n}`), load: () => calls.push("load") });
    expect(calls).toEqual(["pause", "remove src", "load"]);
    expect(() => releaseVideo(null)).not.toThrow();
  });

  it("loses a WebGL context explicitly, and tolerates none", () => {
    const lose = vi.fn();
    loseContext({ getExtension: ((name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null)) as WebGLRenderingContext["getExtension"] });
    expect(lose).toHaveBeenCalledOnce();
    expect(() => loseContext(null)).not.toThrow();
    expect(() => loseContext({ getExtension: (() => null) as WebGLRenderingContext["getExtension"] })).not.toThrow();
  });
});

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Just enough DOM for the execCommand fallback: `copy` dispatches the copy event (with
   * clipboardData unless `noClipboardData`); `active` is what holds the focus.
   */
  function fakeDom({ result = true, fires = true, noClipboardData = false, active = null as unknown }: { result?: boolean; fires?: boolean; noClipboardData?: boolean; active?: unknown } = {}) {
    const ta = { value: "", style: { cssText: "" }, tabIndex: 0, selectionStart: 0, selectionEnd: 0, setAttribute() {}, focus: vi.fn(), select() {}, setSelectionRange: vi.fn(), remove: vi.fn() };
    const listeners = new Set<(e: unknown) => void>();
    const setData = vi.fn();
    const preventDefault = vi.fn();
    const body = { appendChild: vi.fn() };
    const doc = {
      createElement: () => ta,
      body,
      documentElement: {},
      activeElement: active,
      addEventListener: (type: string, fn: (e: unknown) => void) => type === "copy" && listeners.add(fn),
      removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.delete(fn),
      execCommand: vi.fn(() => {
        if (fires) listeners.forEach((fn) => fn({ clipboardData: noClipboardData ? null : { setData }, preventDefault }));
        return result;
      }),
    };
    vi.stubGlobal("document", doc);
    return { ta, doc, body, setData, preventDefault, listeners };
  }

  it("uses the Clipboard API when there is one", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hi")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it("falls back to execCommand on plain-http origins (no navigator.clipboard): the copy event carries the text", async () => {
    vi.stubGlobal("navigator", {});
    const dom = fakeDom();
    expect(await copyText("fuobe_secret")).toBe(true);
    expect(dom.doc.execCommand).toHaveBeenCalledWith("copy");
    // Set on the event itself, so a focus trap that takes the selection away doesn't matter.
    expect(dom.setData).toHaveBeenCalledWith("text/plain", "fuobe_secret");
    expect(dom.preventDefault).toHaveBeenCalled();
    expect(dom.ta.value).toBe("fuobe_secret");
    expect(dom.ta.remove).toHaveBeenCalled();
    expect(dom.listeners.size).toBe(0);
  });

  it("puts the textarea inside the dialog or menu holding the focus, and gives the focus back", async () => {
    // A Radix dialog or menu traps the focus: a textarea on <body> loses it (and its selection) at once.
    vi.stubGlobal("navigator", {});
    const menu = { appendChild: vi.fn() };
    const item = { closest: vi.fn((sel: string) => (sel.includes('[role="menu"]') ? menu : null)), parentElement: { appendChild: vi.fn() }, focus: vi.fn() };
    const dom = fakeDom({ active: item });
    expect(await copyText("a prompt")).toBe(true);
    expect(menu.appendChild).toHaveBeenCalledWith(dom.ta);
    expect(dom.body.appendChild).not.toHaveBeenCalled();
    expect(item.focus).toHaveBeenCalled();
    // Nothing focused: <body>.
    const plain = fakeDom();
    expect(await copyText("x")).toBe(true);
    expect(plain.body.appendChild).toHaveBeenCalledWith(plain.ta);
  });

  it("doesn't claim a copy that didn't happen (execCommand says true but nothing held)", async () => {
    vi.stubGlobal("navigator", {});
    // No copy event, and the selection is gone (the focus went elsewhere).
    fakeDom({ fires: false });
    expect(await copyText("x")).toBe(false);
    // A browser without clipboardData copies the selection: fine while the textarea still holds it.
    const dom = fakeDom({ noClipboardData: true });
    dom.doc.activeElement = dom.ta;
    dom.ta.selectionEnd = 1;
    expect(await copyText("x")).toBe(true);
  });

  it("says when nothing could be copied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
    fakeDom({ result: false, fires: false });
    expect(await copyText("x")).toBe(false);
  });

  it("gives every Copy button the same feedback (copyWithToast)", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    expect(await copyWithToast("a prompt", "Prompt copied")).toBe(true);
    expect(toasts.ok.at(-1)).toBe("Prompt copied");
    // Plain-http LAN origin and a browser that refuses execCommand too: say how to copy by hand.
    vi.stubGlobal("navigator", {});
    fakeDom({ result: false, fires: false });
    expect(await copyWithToast("a link")).toBe(false);
    expect(toasts.error.at(-1)).toMatch(/select the text/);
  });
});

describe("landmarks", () => {
  it("leaves one <main> per page: the app frame's inset sheet", () => {
    // Pages render inside StudioChrome, whose SidebarInset is the <main>; a second one inside it
    // would give screen readers two main landmarks.
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : []));
    const root = path.resolve(__dirname, "../src");
    const mains = [...files(path.join(root, "components")), ...files(path.join(root, "app/(studio)"))]
      .filter((f) => /<main[\s>]/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(mains).toEqual(["components/ui/sidebar.tsx"]);
  });
});
