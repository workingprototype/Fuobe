import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { APPS, EFFECTS, MODELS, MOTIONS, modelCounts } from "@/lib/catalog";
import { getTemplate } from "@/lib/catalog/canvas";
import { FORBIDDEN_WORDS } from "@/lib/examples/catalog";
import { HUB_MODES } from "@/lib/hubs";
import { studioCount } from "@/lib/nav-model";
import { HOME_BENTO_MEDIA } from "@/lib/home-bento.generated";
import { contentVersion } from "../scripts/eval/lib/covers.mjs";
import { WIPES, lineAt } from "../scripts/gen-home-bento.mjs";
import sharp from "sharp";
import type { BentoPicture } from "@/lib/home-bento";
import { DEMO_MEDIA, DEMO_START, demoReducer } from "@/lib/av/clean-voice-demo";
import { coverWidth, pickWidth } from "@/lib/media-pick";
import { mp4Seconds, mp4Size } from "./helpers/mp4-length";

/*
 * Home's first screen (src/components/home/home-bento.tsx, src/lib/home-bento.ts): every tile's media is a published
 * file with its version, every link goes somewhere real, every number is the catalog's, the words a visitor reads are
 * plain, and none of its clips plays anywhere else on Home.
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { BENTO_BOARD, BENTO_CLIPS, BENTO_CLIP_WIDTHS, BENTO_GENJUTSU, BENTO_GENJUTSU_WIDTHS, BENTO_HREFS, BENTO_REEL, BENTO_RELEASE, BENTO_REEL_ID, BENTO_VOICE, livePhrases, openModelsOf } =
  await import("@/lib/home-bento");
const { HOME_BEFORE_AFTER, HOME_EFFECTS, HOME_MOTIONS, HOME_RELEASE, HOME_REVEALS, HOME_STUDIOS, homeShowcase, navLabel, releaseArtSrc, releaseHref } = await import("@/lib/home-showcase");
const { RELEASE_TITLES } = await import("@/lib/release-day");
const { HomeBento } = await import("@/components/home/home-bento");
const { voiceButton } = await import("@/components/home/bento-voice");

const root = process.cwd();
const file = (url: string) => path.join(root, "public", url.split("?")[0]);
const exists = (url: string) => (fs.statSync(file(url), { throwIfNoEntry: false })?.size ?? 0) > 0;
const versioned = /^\/[^?]+\?v=[0-9a-f]{8}$/;

const home = await homeShowcase();
const bento = home.bento;
const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HomeBento, { bento })));
/** Every media URL the first screen names. */
const urls = [...new Set([...JSON.stringify(bento).matchAll(/"(\/(?:previews|examples|samples)\/[^"]*)"/g)].map((m) => m[1]))];

describe("Home's first screen", () => {
  it("shows only published files, each with its content version", () => {
    expect(urls.length).toBeGreaterThan(15);
    for (const u of urls) {
      expect(u, u).toMatch(versioned);
      expect(exists(u), u).toBe(true);
    }
    // The stills made for it are the ones scripts/gen-home-bento.mjs listed, at those versions.
    for (const [f, v] of Object.entries(HOME_BENTO_MEDIA)) {
      expect(contentVersion([file(f)]), f).toBe(v);
      expect(urls).toContain(`${f}?v=${v}`);
    }
    // Nothing else is left in its folder: a copy no longer listed goes with the list.
    const folder = path.join(process.cwd(), "public", "previews", "home");
    expect(fs.readdirSync(folder).map((n) => `/previews/home/${n}`).sort()).toEqual(Object.keys(HOME_BENTO_MEDIA).sort());
    // And the page's HTML asks for them as listed (no URL without its version).
    for (const m of html.matchAll(/(?:src|srcSet)="([^"]+)"/g)) for (const part of m[1].split(", ")) expect(part.split(" ")[0], part).toMatch(versioned);
  });

  it("plays the turning gown in four widths, at the length of its published clip", () => {
    const tiles = [{ tile: bento.threeD, name: "rotation", published: "app-3d-rotation", seconds: 3.04 }];
    for (const { tile, name, published, seconds } of tiles) {
      expect(tile.id).toBe(published);
      expect(tile.clips.map((c) => c.w)).toEqual([...BENTO_CLIP_WIDTHS]);
      for (const c of tile.clips) {
        expect(c.src).toMatch(new RegExp(`^/previews/home/${name}-${c.w}\\.mp4\\?v=[0-9a-f]{8}$`));
        // Each is as wide as it says, 4:3, and as long as the published clip it stands in for (the same cut and loop).
        expect(mp4Size(file(c.src))).toEqual({ w: c.w, h: (c.w * 3) / 4 });
        expect(mp4Seconds(file(c.src))).toBeCloseTo(seconds, 1);
        expect(mp4Seconds(file(`/previews/presets/${published}.mp4`))).toBeCloseTo(seconds, 1);
      }
      // Its poster comes in the same widths (the clip's first frame); for a browser without AVIF, the 1024 px clip's
      // first frame as a JPEG.
      expect(tile.poster.avif.map((a) => a.w)).toEqual([...BENTO_CLIP_WIDTHS]);
      for (const a of tile.poster.avif) expect(a.src).toMatch(new RegExp(`^/previews/home/${name}-${a.w}\\.avif\\?v=`));
      expect(tile.poster.fallback).toMatch(new RegExp(`^/previews/home/${name}-1024\\.jpg\\?v=`));
    }
  });

  it("shows Genjutsu's swaps as they happen: a divider sweeps each swapped take in over the original, in step", () => {
    const g = bento.genjutsu;
    expect(g.id).toBe(BENTO_GENJUTSU.id);
    // Its own id in the playback store: the studio's card lower down may play the same cover.
    expect(g.id).not.toBe(BENTO_GENJUTSU.cover);
    // The couple's group swap first (the studio's own example), then the character swap by the lake.
    expect(g.reel.map((c) => c.id)).toEqual(["genjutsu-couple", "genjutsu-lakeside"]);
    expect(g.wipes).toHaveLength(g.reel.length);
    for (const [i, c] of g.reel.entries()) {
      expect(c.clips.map((x) => x.w)).toEqual([...BENTO_GENJUTSU_WIDTHS]);
      for (const x of c.clips) {
        expect(x.src).toMatch(new RegExp(`^/previews/home/${c.id}-${x.w}\\.mp4\\?v=[0-9a-f]{8}$`));
        expect(mp4Size(file(x.src))).toEqual({ w: x.w, h: (x.w * 3) / 4 });
        // The whole take (124 frames at 24 fps), then its last frame held a third of a second as it fades to dark.
        expect(mp4Seconds(file(x.src))).toBeCloseTo(132 / 24, 1);
      }
      // It rests on its dark last frame before the next one fades in: two faces are never laid over each other.
      expect(c.hold).toBeGreaterThan(0);
      // The tile's stylesheet frames it (the same framing as its still).
      expect(c.position).toBeUndefined();
      const w = g.wipes[i];
      expect(w.labels).toEqual(["Original", "Swapped"]);
      expect(w.fps).toBe(24);
      expect(w.line).toHaveLength(132);
      expect(w.fadeFrom).toBe(124);
      // The divider starts off the frame (the original whole, as the poster shows it), sweeps one way only, and ends off
      // it (the swap whole); on every frame where the script drew it.
      expect(w.line[0]).toBeLessThan(0);
      expect(w.line.at(-1)).toBeGreaterThan(1);
      for (let f = 1; f < w.line.length; f++) expect(w.line[f]).toBeGreaterThanOrEqual(w.line[f - 1]);
      const made = WIPES.find((m) => m.name === c.id)!;
      for (let f = 0; f < w.line.length; f++) expect(w.line[f]).toBeCloseTo(lineAt(made.sweep, Math.min(f, made.frames - 1)), 4);
    }
    // The couple's divider rests half way, between the two (one swapped, one not): the reduced-motion still is a frame of it.
    const still = WIPES[0].still!;
    expect(g.wipes[0].line[still]).toBe(0.5);
    for (const [pic, name] of [
      [g.poster, "genjutsu-couple"],
      [g.still, "genjutsu-couple-split"],
    ] as const) {
      expect(pic.avif.map((a) => a.w)).toEqual([...BENTO_GENJUTSU_WIDTHS]);
      for (const a of pic.avif) expect(a.src).toMatch(new RegExp(`^/previews/home/${name}-${a.w}\\.avif\\?v=`));
      expect(pic.fallback).toMatch(/^\/previews\/home\/genjutsu-couple-1024\.jpg\?v=/);
    }
    // The words either side of the divider, in the HTML from the first paint; the still under reduced motion.
    expect(html).toContain(">Original<");
    expect(html).toContain(">Swapped<");
    expect(html).toContain('<source media="(prefers-reduced-motion: reduce)" type="image/avif" srcSet="/previews/home/genjutsu-couple-split-640.avif?v=');
    // No small window beside it any more: the swap fills the tile.
    expect(html).not.toContain("hb-original");
    expect(bento.tiles.genjutsu.href).toBe("/genjutsu");
  });

  it("leaves Colorize off the first screen", () => {
    expect(html).not.toMatch(/colorize|Bring an old photo/i);
    expect(Object.keys(bento.tiles)).not.toContain("restore");
  });

  it("plays Sand Storm and One Take in turn, on the first one's first frame", () => {
    const v = bento.video;
    expect(v.id).toBe(BENTO_REEL_ID);
    expect(v.reel.map((c) => c.id)).toEqual(["effect-sand-storm", "motion-one-take"]);
    expect(v.reel.map((c) => c.id)).toEqual(BENTO_REEL);
    for (const c of v.reel) {
      // At least the 640 and 1024 px copies, each a width a still or clip comes in, narrowest first.
      expect(c.clips.map((x) => x.w).slice(0, 2)).toEqual([640, 1024]);
      for (const x of c.clips) expect(BENTO_CLIP_WIDTHS).toContain(x.w);
      expect(c.position).toMatch(/^\d+% \d+%$/);
    }
    // The poster: the first clip's first frame, in the widths that clip comes in, and a JPEG at 1024 px.
    const first = v.reel[0];
    expect(v.poster.avif.map((a) => a.w)).toEqual(first.clips.map((x) => x.w));
    for (const a of v.poster.avif) expect(a.src).toMatch(new RegExp(`^/previews/home/reel-sand-storm-${a.w}\\.avif\\?v=`));
    expect(v.poster.fallback).toMatch(/^\/previews\/home\/reel-sand-storm-1024\.jpg\?v=/);
    // It is framed as its clip is: the poster's position is the first clip's, on the page.
    expect(html).toContain(`object-position:${first.position}`);
  });

  it("lists every picture at its real width", async () => {
    const pictures: BentoPicture[] = [bento.video.poster, bento.threeD.poster, ...bento.release.slides, bento.genjutsu.poster, bento.genjutsu.still, bento.voice.room, bento.voice.quiet, ...bento.live.frames];
    for (const p of pictures)
      for (const a of p.avif) {
        const m = await sharp(file(a.src)).metadata();
        expect(m.width, a.src).toBe(a.w);
      }
  });

  it("gives each tile a copy at least as wide as it shows, up to the widest there is", () => {
    // object-fit: cover: a 4:3 clip in a square box needs its height x 4/3 of width, times the pixel ratio.
    expect(coverWidth(173, 173, 4 / 3, 3)).toBe(692);
    expect(coverWidth(569, 419, 4 / 3, 2)).toBe(1138);
    expect(coverWidth(476, 210, 4 / 3, 2)).toBe(952);
    const clips = bento.threeD.clips;
    expect(pickWidth(clips, 300).w).toBe(640);
    expect(pickWidth(clips, 640).w).toBe(640);
    expect(pickWidth(clips, 641).w).toBe(1024);
    // A 3x phone (358 px box: 1074) and a 2x laptop (567 px box: 1134) get the 1536 px copy, a 3x tablet the 2048.
    expect(pickWidth(clips, 1074).w).toBe(1536);
    expect(pickWidth(clips, 1134).w).toBe(1536);
    expect(pickWidth(clips, 1728).w).toBe(2048);
    // Past the widest copy (its 2048 px master): the widest, never stretched further.
    expect(pickWidth(clips, 2400).w).toBe(2048);
    expect(Math.max(...bento.threeD.clips.map((c) => c.w))).toBe(2048);
    // Each reel clip comes at least 1024 px wide (its render's own size), wider only from its 2048 px master: a 3x phone
    // (1068) gets the 1536 px copy where there is one, else the widest there is.
    for (const c of bento.video.reel) {
      const widest = Math.max(...c.clips.map((x) => x.w));
      expect(widest).toBeGreaterThanOrEqual(1024);
      expect(pickWidth(c.clips, 1068).w).toBe(widest >= 1536 ? 1536 : widest);
    }
    // The live tile, the next biggest, covers a 3x phone (358 px wide) and its tile on a 2x 1440 screen (405 px under cover).
    for (const f of bento.live.frames) expect(Math.max(...f.avif.map((a) => a.w))).toBeGreaterThanOrEqual(Math.max(358 * 3, 405 * 2));
    // Genjutsu's clips are never made up past their renders' own 1024 px: its tile on a 1x 1440 screen (319 x 308, so
    // 411 px under cover) gets 640, a box that needs 700 px 768, and a 2x laptop and a 3x phone 1024.
    for (const c of bento.genjutsu.reel) {
      expect(pickWidth(c.clips, coverWidth(319, 308, 4 / 3, 1)).w).toBe(640);
      expect(pickWidth(c.clips, 700).w).toBe(768);
      expect(pickWidth(c.clips, coverWidth(319, 308, 4 / 3, 2)).w).toBe(1024);
      expect(pickWidth(c.clips, 358 * 3).w).toBe(1024);
    }
  });

  it("opens a real page from every tile, named by the navigation or the catalog", () => {
    const route = (href: string) => {
      const seg = href.split(/[?#]/)[0].replace(/^\//, "");
      const [hub, mode] = seg.split("/");
      // A hub's mode on its own page (/audio/clean): the hub's [mode] page, for a mode it has.
      if (mode && hub in HUB_MODES)
        return HUB_MODES[hub as keyof typeof HUB_MODES].some((m) => m.id === mode) && fs.existsSync(path.join(root, "src", "app", "(studio)", hub, "[mode]", "page.tsx"));
      return fs.existsSync(path.join(root, "src", "app", "(studio)", seg, "page.tsx"));
    };
    for (const href of [BENTO_HREFS.video, BENTO_HREFS.release, BENTO_HREFS.audio, BENTO_HREFS.threeD, BENTO_HREFS.genjutsu, BENTO_HREFS.live, BENTO_HREFS.canvas])
      expect(route(href), href).toBe(true);
    expect(BENTO_HREFS.numbers).toBe("#home-studios");
    expect(fs.readFileSync(path.join(root, "src", "components", "home", "home-sections.tsx"), "utf8")).toContain('id="home-studios"');
    // The words each link ends on are the place's own name.
    const t = bento.tiles;
    expect(t.video.cta).toBe(`Open ${navLabel("/cinema")}`);
    // The Audio tile plays Clean up voice's demo, and opens that mode's own page.
    expect(BENTO_HREFS.audio).toBe("/audio/clean");
    expect(t.audio.cta).toBe(`Open ${HUB_MODES.audio.find((m) => m.id === "clean")!.label}`);
    expect(t.threeD.cta).toBe(`Open ${navLabel("/image-to-3d")}`);
    expect(t.live.cta).toBe(`Open ${navLabel("/live-edit")}`);
    expect(t.canvas.cta).toBe(`Open ${navLabel("/canvas")}`);
    expect(t.genjutsu.cta).toBe(`Open ${navLabel("/genjutsu")}`);
  });

  it("makes every tile one link with a name, in the grid's reading order", () => {
    const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    const tiles = links.filter((a) => a.includes("data-tile="));
    // Every tile is its link but the Audio tile, which holds the demo's buttons: its words are its link.
    expect([...html.matchAll(/<(?:a|div) [^>]*data-tile="([^"]+)"/g)].map((m) => m[1])).toEqual(["release", "live", "genjutsu", "video", "threeD", "audio", "numbers", "canvas"]);
    expect(tiles.map((a) => /data-tile="([^"]+)"/.exec(a)![1])).toEqual(["release", "live", "genjutsu", "video", "threeD", "numbers", "canvas"]);
    const audioLink = links.find((a) => a.includes(`href="${BENTO_HREFS.audio}"`));
    expect(audioLink).toBeTruthy();
    expect(links).toHaveLength(8);
    for (const a of [...tiles, audioLink!]) {
      const label = /aria-label="([^"]+)"/.exec(a)?.[1];
      expect(label, a).toBeTruthy();
      expect(label!.length).toBeGreaterThan(10);
    }
    const KINDS = { video: "Video", audio: "Audio", threeD: "3D", genjutsu: "Genjutsu", live: "Live edit", canvas: "Canvas" };
    for (const [key, kind] of Object.entries(KINDS)) {
      const t = bento.tiles[key as keyof typeof KINDS];
      expect(t.label).toBe(`${kind}: ${t.title}. ${t.cta}`);
    }
    // The numbers tile opens the studios list in place, and says so.
    expect(bento.tiles.numbers.label).toBe(`${bento.numbers[0].value} studios, ${bento.numbers[1].value} apps, ${bento.numbers[2].value} effects and camera moves. Opens all studios`);
    expect(tiles.find((a) => a.includes('data-tile="numbers"'))).toContain('aria-haspopup="dialog"');
    // No link or button inside a tile: the whole tile is the one target (the Audio tile is a group of its own).
    for (const chunk of html.split("data-tile=").slice(1).filter((c) => !c.startsWith('"audio"'))) expect(chunk.split("</a>")[0]).not.toMatch(/<(a|button)\b/);
    // The page's only h1: the headline, in its own words; "finished film," and "one place." never break apart.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1].replace(/<[^>]+>/g, "");
    expect(h1.replace(/ /g, " ")).toBe("Make anything: From an idea to a finished film, in one place.");
    expect(h1).toContain("finished film,");
    expect(h1).toContain("one place.");
    // The note under it, both sentences whole, and nothing hidden shipped with it.
    expect(html).toContain("Film, live edits, swaps, stills, sound, 3D and whole pipelines. Each tile opens the studio that makes it.");
    expect(html).not.toMatch(/data-hero|hb-eyebrow|hb-vignette/);
  });

  it("quotes the catalog's numbers, never typed in", () => {
    const f = bento.facts;
    const open = (kind: string) => MODELS.filter((m) => !m.hidden && (m.engine === "open" || m.engines?.includes("open")) && m.kind === kind).length;
    // The same studio count as the navigation's Studios badge and the launcher it opens.
    expect(f.studios).toBe(studioCount());
    expect(f.apps).toBe(APPS.length);
    expect(f.effectsAndMotions).toBe(EFFECTS.length + MOTIONS.length);
    expect(f.motions).toBe(MOTIONS.length);
    expect(f.openModels).toBe(modelCounts().open);
    expect([f.imageModels, f.videoModels, f.models3d]).toEqual([open("image"), open("video"), open("model3d")]);
    expect(openModelsOf("image")).toBe(open("image"));
    expect(f.soundTools).toBe(HUB_MODES.audio.length);
    expect(bento.numbers.map((n) => n.value)).toEqual([f.studios, f.apps, f.effectsAndMotions]);
    // No number in the components' own words: every one comes from the facts.
    for (const src of ["home-bento.tsx", "bento-islands.tsx"]) {
      const text = fs.readFileSync(path.join(root, "src", "components", "home", src), "utf8");
      const words = [...text.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).filter((w) => !/[(){}=?;|&]/.test(w));
      for (const w of words) expect(w.replace(/RTX 5090|3D/g, ""), `${src}: "${w}"`).not.toMatch(/\d/);
    }
    const lib = fs.readFileSync(path.join(root, "src", "lib", "home-bento.ts"), "utf8");
    for (const m of lib.matchAll(/tile\("[a-zA-Z]+", "([^"]*)", (?:`([^`]*)`|"([^"]*)"), "([^"]*)", (?:`([^`]*)`|"([^"]*)")\)/g))
      for (const w of m.slice(1).filter(Boolean)) expect(w.replace(/\$\{[^}]+\}/g, "").replace(/3D/g, ""), w).not.toMatch(/\d/);
  });

  it("reads plainly: no model or maker names but the release tile's own, no status or prompt words", () => {
    // The release tile names its model, by design (checked on its own below).
    const release = /<a [^>]*data-tile="release"[\s\S]*?<\/a>/.exec(html)![0];
    expect(release).toContain(`>${HOME_RELEASE.name}<`);
    const others = html.replace(release, "");
    const visible = others
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&quot;|&amp;/g, " ")
      .replace(/\s+/g, " ");
    const labels = [...others.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    // The release tile's words without its model's name and the site's (its title: "Now on Fuobe"): plain too.
    const own = release.replace(/<[^>]+>/g, " ").replaceAll(HOME_RELEASE.name, " ").replace(/\bFuobe\b/g, " ").replace(/\s+/g, " ");
    const texts = [own, bento.tiles.release.label.replace(HOME_RELEASE.name, ""), visible.replace(/Rendered locally on ComfyUI, on one RTX 5090\.|Every preview on this page was rendered locally on ComfyUI, on one RTX 5090\./g, ""), ...labels];
    const WORDS = new Set(["Relight", "Runway", "Canvas", "Image", "Audio", "Video"]);
    const names = [...new Set(MODELS.flatMap((m) => [m.name, m.vendor]).filter((n): n is string => !!n && n.trim().length >= 3 && !WORDS.has(n)))];
    const status = /\b(unverified|not checked|todo|tbd|test|placeholder|demo|preview made with|gpu|comfy|lora|checkpoint)\b/i;
    for (const t of texts) {
      for (const bad of FORBIDDEN_WORDS) expect(t, String(bad)).not.toMatch(bad);
      expect(t).not.toMatch(status);
      for (const n of names) expect(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t), `names ${n}: ${t}`).toBe(false);
    }
  });

  it("plays each clip in one place on Home (the playback store keys by id)", () => {
    // The video tile plays its reel under its own id; the 3D tile's preset plays nowhere else.
    const ids = [
      BENTO_REEL_ID,
      BENTO_GENJUTSU.id,
      ...Object.values(BENTO_CLIPS),
      ...[...HOME_EFFECTS, ...HOME_MOTIONS, ...HOME_REVEALS].map((r) => r.id),
      ...HOME_BEFORE_AFTER.map((p) => p.id),
      ...HOME_STUDIOS.flatMap((s) => (s.id ? [s.id] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOME_STUDIOS.find((s) => s.href === "/image-to-3d")?.id).toBe("app-3d-figure");
    expect(home).not.toHaveProperty("wall");
  });

  it("plays Clean up voice's demo in the Audio tile: tap to listen, Noise on / Noise off, and its words open the studio", () => {
    const tile = /<div [^>]*data-tile="audio"[\s\S]*?<\/a>/.exec(html)![0];
    // A named group: the demo's buttons, then the link to the studio, named as every tile's link is.
    expect(tile).toMatch(/^<div role="group" aria-label="Clean up voice: a woman talking in a noisy restaurant"/);
    expect(tile).toContain('data-phase="idle"');
    const buttons = [...tile.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => [m[0], m[1].replace(/<[^>]+>/g, "")] as const);
    expect(buttons.map(([, text]) => text)).toEqual(["Noise on", "Noise off", "Tap to listen"]);
    expect(buttons.every(([b]) => b.includes('type="button"'))).toBe(true);
    // Noise on is pressed before anything plays; the chip says what is heard, in a live region.
    expect(buttons[0][0]).toContain('aria-pressed="true"');
    expect(buttons[1][0]).toContain('aria-pressed="false"');
    expect(tile).toMatch(/<span [^>]*aria-live="polite"[^>]*>[\s\S]*?<span data-demo-state="true">Noisy restaurant<\/span>/);
    expect(tile).toContain(`href="${BENTO_HREFS.audio}"`);
    expect(tile).toContain(`aria-label="${bento.tiles.audio.label}"`);
    expect(bento.tiles.audio.label).toBe("Audio: Studio-clean voice. Open Clean up voice");
    // Nothing plays or downloads before a tap: no sound in the HTML, and the softened photo only once reached for.
    for (const f of [DEMO_MEDIA.noisy, DEMO_MEDIA.clean]) expect(html).not.toContain(f);
    expect(html).not.toMatch(/<audio\b/);
    expect(tile).toContain(`/previews/home/${BENTO_VOICE.room}-480.avif?v=`);
    expect(tile).not.toContain(`/previews/home/${BENTO_VOICE.quiet}-`);
    // Its photos: the demo's own, in three widths, and a JPEG for a browser without AVIF.
    for (const [pic, name] of [
      [bento.voice.room, BENTO_VOICE.room],
      [bento.voice.quiet, BENTO_VOICE.quiet],
    ] as const) {
      expect(pic.avif.map((a) => a.w)).toEqual([...BENTO_VOICE.widths]);
      for (const a of pic.avif) expect(a.src).toMatch(new RegExp(`^/previews/home/${name}-${a.w}\\.avif\\?v=`));
      expect(pic.fallback).toMatch(new RegExp(`^/previews/home/${name}-1024\\.jpg\\?v=`));
    }
    // A 3x phone's full row (358 px) gets the widest copy; a 2x laptop's tile (320 px wide) the 768.
    expect(pickWidth(bento.voice.room.avif, 358 * 3).w).toBe(1024);
    expect(pickWidth(bento.voice.room.avif, coverWidth(319, 148, 4 / 3, 2)).w).toBe(768);
  });

  it("names the Audio tile's play button for each moment of the demo", () => {
    const tap = { type: "tap" } as const;
    const loading = demoReducer(DEMO_START, tap);
    const playing = demoReducer(loading, { type: "started" });
    const paused = demoReducer(playing, tap);
    const done = demoReducer(playing, { type: "ended" });
    const failed = demoReducer(loading, { type: "failed" });
    expect([DEMO_START, loading, playing, paused, done, failed].map((st) => voiceButton(st).label)).toEqual(["Tap to listen", "Loading…", "Pause", "Resume", "Play again", "Try again"]);
    // Only loading shows the spinner.
    expect(voiceButton(loading).spin).toBe(true);
    expect([DEMO_START, playing, paused].some((st) => voiceButton(st).spin)).toBe(false);
  });

  it("types the Live edit session's own words before the pictures they made", () => {
    const demo = JSON.parse(fs.readFileSync(path.join(root, "public", "previews", "live-edit", "demo.json"), "utf8"));
    const phrases = livePhrases(demo);
    expect(bento.live.phrases).toEqual(phrases);
    expect(phrases).toEqual(["evening makeup, deep red lips", "hair down, side-swept waves", "big gold hoop earrings"]);
    const typed = demo.script.filter((s: { type: string }) => s.type === "type").map((s: { text: string }) => s.text).join("");
    for (const p of phrases) expect(typed).toContain(p);
    expect(bento.live.frames).toHaveLength(4);
    for (const [i, f] of bento.live.frames.entries()) {
      const fr = demo.frames[`s${i}`];
      expect(f.avif.map((a) => a.src)).toEqual([fr.small, fr.mid, fr.src]);
      expect(f.fallback).toBe(fr.webp);
    }
  });

  it("draws the Canvas board as the template builds it: its photo, two steps, its film", () => {
    const graph = getTemplate(BENTO_BOARD)!.build("open");
    const { photo, steps, film } = bento.canvas;
    expect([photo, ...steps, film].map((n) => n.label).sort()).toEqual(graph.nodes.map((n) => n.data.label).sort());
    expect(graph.nodes.find((n) => n.id === photo.id)?.type).toBe("image-input");
    expect(graph.nodes.find((n) => n.id === film.id)?.type).toBe("output");
    expect(photo.thumb).toMatch(/^\/previews\/home\/board-photo\.webp\?v=/);
    expect(film.thumb).toMatch(/^\/previews\/home\/board-film\.webp\?v=/);
  });

  it("leads with the latest release: new, by its name, and one link to the Image studio on its model", () => {
    const tile = /<a [^>]*data-tile="release"[\s\S]*?<\/a>/.exec(html)![0];
    const open = /^<a [^>]*>/.exec(tile)![0];
    const decode = (v: string) => v.replace(/&amp;/g, "&");
    expect(BENTO_HREFS.release).toBe(releaseHref("image"));
    expect(decode(/href="([^"]+)"/.exec(open)![1])).toBe(`/image?model=${HOME_RELEASE.modelId}`);
    expect(/aria-label="([^"]+)"/.exec(open)![1]).toBe(`${HOME_RELEASE.name}, new: try it now`);
    expect(bento.tiles.release.label).toBe(`${HOME_RELEASE.name}, new: try it now`);
    // Its words: the badge, the model's name over the title (the later one in the HTML: the page is built once), the link's.
    const words = tile.replace(/<[^>]+>/g, "|").split("|").map((w) => w.trim()).filter(Boolean);
    expect(words).toEqual([BENTO_RELEASE.badge, HOME_RELEASE.name, RELEASE_TITLES.later, bento.tiles.release.cta]);
    expect(BENTO_RELEASE.badge).toBe("New · Day 0");
    expect(bento.tiles.release.cta).toBe("Try it now");
    // The tile it took the place of is gone, files and all (the folder test above holds the rest of previews/home).
    expect(Object.keys(bento.tiles)).not.toContain("image");
    expect(html).not.toMatch(/\/previews\/home\/image-4|Portraits and campaigns/);
  });

  it("fades through the release's own pictures, the first one in the HTML and the rest once it plays", () => {
    const r = bento.release;
    expect(r.released).toBe(HOME_RELEASE.released);
    expect([r.every, r.fade]).toEqual([BENTO_RELEASE.every, BENTO_RELEASE.fade]);
    expect(r.fade).toBeLessThan(r.every);
    expect(r.slides).toHaveLength(HOME_RELEASE.tile.length);
    for (const [i, { slug, position }] of HOME_RELEASE.tile.entries()) {
      const p = r.slides[i];
      const art = HOME_RELEASE.art.find((a) => a.slug === slug)!;
      // The release folder's own files (none copied into previews/home), each at its content version.
      expect(p.avif.map((a) => a.w)).toEqual([480, 960]);
      for (const [url, src] of [
        [p.avif[0].src, releaseArtSrc(slug, 480, "avif")],
        [p.avif[1].src, releaseArtSrc(slug, 960, "avif")],
        [p.fallback, releaseArtSrc(slug, 480, "webp")],
      ] as const)
        expect(url).toBe(`${src}?v=${contentVersion([file(src)])}`);
      expect([p.width, p.height]).toEqual([art.width, art.height]);
      expect(p.position).toBe(position);
    }
    const tile = /<a [^>]*data-tile="release"[\s\S]*?<\/a>/.exec(html)![0];
    // Only the first picture is in the HTML, shown, with nothing under it; decorative (the link names the tile).
    const imgs = [...tile.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('alt=""');
    expect(imgs[0]).toContain(`src="${r.slides[0].fallback}"`);
    expect(imgs[0]).not.toContain('loading="lazy"');
    // The first screen's biggest picture: asked for first, and decoded with the first paint.
    expect(imgs[0]).toMatch(/fetchPriority="high"/i);
    expect(imgs[0]).toContain('decoding="sync"');
    // In its 480 and 960 px copies, the 960 wherever the tile shows it at more than 480 px.
    expect(tile).toContain(`srcSet="${r.slides[0].avif[0].src} 480w, ${r.slides[0].avif[1].src} 960w"`);
    expect(tile).toContain('sizes="(min-width: 1024px) 860px, (min-width: 768px) 840px, calc(100vw - 32px)"');
    expect(tile).toContain('data-on="true"');
    expect(tile).not.toContain("data-prev");
    for (const p of r.slides.slice(1)) expect(tile).not.toContain(p.avif[0].src);
  });

  it("moves the release tile only while the first screen plays, and never under reduced motion", () => {
    const css = fs.readFileSync(path.join(root, "src", "components", "home", "home-bento.css"), "utf8");
    // Its zoom and the badge's pulse run under data-play only ("1": running, "0": frozen); without it the first picture rests.
    for (const sel of [".hb-release-slide:is([data-on], [data-prev]) .hb-fill", ".hb-new-dot"]) {
      expect(css).toContain(`.hb-bento[data-play] ${sel} {`);
      expect(css).toContain(`.hb-bento[data-play="1"] ${sel} {`);
    }
    expect(css).not.toMatch(/^\.hb-release-slide[^{]*\{[^}]*animation:/m);
    // Under reduced motion nothing moves, whatever data-play says.
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.hb-bento \.hb-release-slide \.hb-fill,[\s\S]*\.hb-bento \.hb-new-dot,[\s\S]*animation: none !important/);
    // It leads the grid on every width (a phone's first row, a tablet's two columns and two rows, from lg six columns
    // and two rows), and the video reel takes the bottom row's first place it had (half a phone's row by 3D, a tablet's
    // column by Genjutsu, from lg two columns): the grid sets both boxes.
    expect(css.match(/"release release"\n\s*"live live"/g)).toHaveLength(1);
    expect(css.match(/"video three"/g)).toHaveLength(1);
    expect(css.match(/"release release live"\n\s*"release release live"\n\s*"genjutsu genjutsu video"/g)).toHaveLength(1);
    expect(css.match(/("release release release release release release live live live live genjutsu genjutsu genjutsu genjutsu"\s*){2}"video video three three /g)).toHaveLength(1);
    // The release tile's title at the lead's display size; the video tile's at the small tiles'.
    expect(css).toMatch(/@container \(min-width: 540px\) \{\s*\.hb-release \.hb-title \{\s*font-size: 44px;/);
    expect(css).not.toMatch(/\.hb-video \.hb-title/);
  });

  it("shows the video reel small: its still from the first paint, its clips once that is painted, and its link", () => {
    const tile = /<a [^>]*data-tile="video"[\s\S]*?<\/a>/.exec(html)![0];
    expect(/href="([^"]+)"/.exec(tile)![1]).toBe(BENTO_HREFS.video);
    expect(/aria-label="([^"]+)"/.exec(tile)![1]).toBe(bento.tiles.video.label);
    const imgs = [...tile.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`src="${bento.video.poster.fallback}"`);
    expect(imgs[0]).not.toContain('loading="lazy"');
    // No clip in the HTML: the reel sets its source once the still is painted.
    expect(tile).not.toMatch(/<video\b/);
    expect(tile).toContain('sizes="(min-width: 1024px) 330px, (min-width: 768px) 320px, calc((100vw - 44px) * 0.667)"');
    expect(tile).toContain(`>${bento.tiles.video.title}<`);
  });
});
