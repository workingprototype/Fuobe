import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoveList } from "@/components/cinema/camera-moves";
import { CoverTile } from "@/components/cover-tile";
import { PresetGrid } from "@/components/studio/preset-chips";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EFFECTS, MOTIONS } from "@/lib/catalog";
import { CAMERA_MOVES } from "@/lib/catalog/cinema";
import type { Preset } from "@/lib/catalog/types";
import { createPickerPlayback, PICKED_RESUME } from "@/lib/picker-playback";
import { moveCover, presetCover } from "@/lib/preset-covers";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { HOVER_INTENT } from "@/lib/preview-playback";

/*
 * The pickers show the same real covers as the galleries (the camera motion and Mix grids, Cinema Studio's moves),
 * rendered on the server as they first paint: posters only, every clip waits for a hover, focus or pick.
 */

const grid = (list: Preset[], value?: string) => renderToStaticMarkup(createElement(PresetGrid, { list, value, noneLabel: "None", onPick: () => {} }));
/** The grid's tiles (not its category tabs), each as its markup. */
const tiles = (html: string) =>
  html
    .split("<button")
    .slice(1)
    .filter((b) => !b.includes('role="tab"'));
const covered = (list: Preset[]) => list.filter((p) => PRESET_PREVIEWS[p.id]);
const count = (html: string, s: string) => html.split(s).length - 1;
const mixable = [...MOTIONS, ...EFFECTS].filter((p) => !p.inputs.some((i) => i.key === "endImage"));

describe("the camera motion picker", () => {
  const html = grid(MOTIONS);
  const all = tiles(html);
  const tile = (p: Preset) => all.find((t) => t.includes(`>${p.name.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")}</span>`))!;

  it("shows every motion's cover where it has one, as a lazy poster; the others and None keep their drawn tile", () => {
    expect(all).toHaveLength(MOTIONS.length + 1);
    for (const p of MOTIONS) {
      const t = tile(p);
      expect(t, p.id).toBeDefined();
      const cover = PRESET_PREVIEWS[p.id];
      if (cover) {
        expect(t, p.id).toContain(`src="${cover.poster}"`);
        expect(t, p.id).toMatch(/<img[^>]*loading="lazy"[^>]*decoding="async"/);
        expect(t, p.id).not.toContain("linear-gradient");
      } else {
        expect(t, p.id).toContain("linear-gradient");
        expect(t, p.id).not.toContain("<img");
      }
    }
    const none = all[0];
    expect(none).toContain(">None</span>");
    expect(none).not.toContain("<img");
    expect(none).toContain('aria-pressed="true"');
    expect(count(html, "<img")).toBe(covered(MOTIONS).length);
    expect(covered(MOTIONS).length).toBeGreaterThan(MOTIONS.length * 0.9);
  });

  it("never borrows another move's cover: Dolly Zoom Out isn't shown with Dolly Zoom In's opposite move", () => {
    const out = MOTIONS.find((p) => p.id === "motion-dolly-zoom-out")!;
    expect(tile(out)).not.toContain("motion-dolly-zoom-in");
  });

  it("loads no clip until one is hovered, focused or picked", () => {
    expect(html).not.toContain("<video");
    expect(html).not.toContain(".mp4");
  });

  it("marks the picked motion on its picture, and only that one", () => {
    const picked = covered(MOTIONS).find((p) => PRESET_PREVIEWS[p.id].video)!;
    const html = grid(MOTIONS, picked.id);
    const marked = tiles(html).filter((t) => t.includes('aria-pressed="true"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(`src="${PRESET_PREVIEWS[picked.id].poster}"`);
    expect(marked[0]).toContain('data-picked=""');
    expect(count(html, "data-picked")).toBe(1);
  });
});

describe("the Mix picker", () => {
  it("shows the cover of every motion and effect that has one, posters only", () => {
    const html = grid(mixable);
    for (const p of covered(mixable)) expect(html, p.id).toContain(`src="${PRESET_PREVIEWS[p.id].poster}"`);
    expect(count(html, "<img")).toBe(covered(mixable).length);
    expect(count(html, "linear-gradient")).toBe(mixable.length - covered(mixable).length);
    expect(html).not.toContain("<video");
  });
});

describe("the cover tile", () => {
  const clip = { poster: "/previews/presets/motion-zoom-in.jpg", video: "/previews/presets/motion-zoom-in.mp4" };
  const tile = (props: Partial<React.ComponentProps<typeof CoverTile>>) =>
    renderToStaticMarkup(createElement(CoverTile, { cover: clip, playing: false, className: "aspect-video", ...props }));

  it("shows the poster at rest, lazily, filling its box without shifting anything", () => {
    const html = tile({});
    expect(html).toMatch(/<span class="[^"]*relative[^"]*aspect-video[^"]*"/);
    expect(html).toMatch(/<img [^>]*src="\/previews\/presets\/motion-zoom-in\.jpg"/);
    expect(html).toMatch(/loading="lazy"/);
    expect(html).toMatch(/class="absolute inset-0 size-full object-cover"/);
    expect(html).not.toContain("<video");
  });

  it("adds the clip only while it plays, and never for a cover that is a still", () => {
    expect(tile({ playing: true })).toMatch(/<video [^>]*src="\/previews\/presets\/motion-zoom-in\.mp4"/);
    expect(tile({ playing: true, cover: { poster: clip.poster } })).not.toContain("<video");
  });

  it("draws the fallback when there is no cover", () => {
    const html = tile({ cover: undefined, fallback: createElement("i", { className: "drawn" }), playing: true });
    expect(html).toContain('<i class="drawn"></i>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
  });

  it("marks a picked tile with a check, or with its place in an order", () => {
    expect(tile({})).not.toContain("data-picked");
    expect(tile({ picked: true })).toMatch(/data-picked=""[^>]*>.*<svg/);
    expect(tile({ picked: 2 })).toMatch(/data-picked=""[^>]*>2</);
  });
});

describe("Cinema Studio's camera moves", () => {
  it("show the cover of the camera motion each move runs, but Drone Orbit's ground-level orbit isn't a drone shot", () => {
    for (const m of CAMERA_MOVES) {
      if (m.slug === "drone-orbit") expect(moveCover(m), m.slug).toBeUndefined();
      else expect(moveCover(m), m.slug).toEqual(presetCover(m.motionId));
    }
    // Pedestal Up rises like Jib Up, whose clip it shows.
    expect(moveCover(CAMERA_MOVES.find((m) => m.slug === "pedestal-up")!)?.poster).toBe("/previews/presets/motion-jib-up.jpg");
    expect(CAMERA_MOVES.filter((m) => moveCover(m)).length).toBeGreaterThan(30);
  });

  it("list them with their poster, and the order number on it once picked", () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(MoveList, { engine: "open", selected: ["dolly-in"], onPick: () => {} })));
    const rows = html.split('cmdk-item=""').slice(1);
    expect(rows).toHaveLength(CAMERA_MOVES.length);
    for (const m of CAMERA_MOVES) {
      const row = rows.find((r) => r.includes(`>${m.name}<`))!;
      const cover = moveCover(m);
      if (cover) expect(row, m.slug).toContain(`src="${cover.poster}"`);
      else expect(row, m.slug).not.toContain("<img");
    }
    expect(html).not.toContain("<video");
    expect(rows.find((r) => r.includes(">Dolly In<"))).toMatch(/data-picked=""[^>]*>1</);
  });
});

/** The browser as the picker's playback sees it, with a clock that only moves when told. */
function fakeEnv({ reduced = false, saveData = false, hover = true } = {}) {
  let now = 0;
  const timers = new Set<{ at: number; cb: () => void }>();
  const next = () => [...timers].sort((a, b) => a.at - b.at)[0];
  const advance = (ms: number) => {
    const end = now + ms;
    for (let due = next(); due && due.at <= end; due = next()) {
      timers.delete(due);
      now = due.at;
      due.cb();
    }
    now = end;
  };
  const env = {
    matches: (q: string) => (q.includes("reduced-motion") ? reduced : q.includes("hover") ? hover : false),
    delay: (cb: () => void, ms: number) => {
      const t = { at: now + ms, cb };
      timers.add(t);
      return () => void timers.delete(t);
    },
    saveData: () => saveData,
  };
  return { env, advance };
}

describe("which picker tile plays", () => {
  it("plays the picked tile when the picker opens, and the hovered one instead once the pointer rests on it", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(true);
    expect(p.plays("other")).toBe(false);
    p.play("other");
    advance(HOVER_INTENT - 1);
    expect([p.plays("picked", true), p.plays("other")]).toEqual([true, false]);
    advance(1);
    expect([p.plays("picked", true), p.plays("other")]).toEqual([false, true]);
  });

  it("doesn't restart the picked tile while the pointer moves from tile to tile, only once it has left them", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("a");
    advance(HOVER_INTENT);
    p.stop("a");
    expect(p.plays("picked", true)).toBe(false);
    advance(PICKED_RESUME / 2);
    p.play("b");
    advance(HOVER_INTENT);
    expect([p.plays("picked", true), p.plays("a"), p.plays("b")]).toEqual([false, false, true]);
    // Passing over a tile without resting on it doesn't play it, and doesn't hold the picked one off for good.
    p.stop("b");
    p.play("c");
    p.stop("c");
    advance(PICKED_RESUME - 1);
    expect([p.plays("picked", true), p.plays("c")]).toEqual([false, false]);
    advance(1);
    expect(p.plays("picked", true)).toBe(true);
  });

  it("keeps the picked tile playing while the pointer rests on it", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("picked");
    advance(HOVER_INTENT);
    expect(p.plays("picked", true)).toBe(true);
    p.stop("picked");
    advance(PICKED_RESUME);
    expect(p.plays("picked", true)).toBe(true);
  });

  it("plays one tile at a time, the last one asked for", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("a");
    advance(HOVER_INTENT);
    p.play("b");
    advance(HOVER_INTENT);
    expect([p.plays("a"), p.plays("b")]).toEqual([false, true]);
    p.stop("a");
    expect(p.plays("b")).toBe(true);
  });

  it("keeps the picked tile on its poster with Save-Data or on 2G (it plays unasked), but plays a hovered one", () => {
    const { env, advance } = fakeEnv({ saveData: true });
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(false);
    p.play("other");
    advance(HOVER_INTENT);
    expect(p.plays("other")).toBe(true);
  });

  it("plays nothing when the user prefers reduced motion", () => {
    const { env, advance } = fakeEnv({ reduced: true });
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(false);
    p.play("other");
    advance(HOVER_INTENT);
    expect(p.plays("other")).toBe(false);
  });

  it("tells a device that can hover from a phone (a list's highlighted row plays only where it can)", () => {
    expect(createPickerPlayback(fakeEnv().env).canHover()).toBe(true);
    expect(createPickerPlayback(fakeEnv({ hover: false }).env).canHover()).toBe(false);
  });
});
