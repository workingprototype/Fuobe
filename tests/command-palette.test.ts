import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/nav-items";
import { APPS, EFFECTS, getModel, MODELS, MOTIONS } from "@/lib/catalog";
import { entryScore, indexEntries, normalize, rankPalette, wordScore, type PaletteEntry } from "@/lib/command-search";
import { modelHref, paletteIndex } from "@/lib/palette-index";
import { hubModePaths, studioRoutes } from "./e2e/_routes.mjs";

const page = (label: string, href: string, keywords?: string): PaletteEntry => ({ key: `page:${href}`, kind: "page", label, href, keywords });
const PAGES = NAV.flatMap((g) => g.items.map((i) => page(i.label, i.href, i.keywords)));
const index = paletteIndex();
const ALL = [...PAGES, ...indexEntries(index, "both")];
const top = (q: string, entries = ALL) => rankPalette(entries, q).flatMap((g) => g.entries.map((e) => e.label));

describe("palette word match", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(normalize("  Lipsync & Avatars ")).toBe("lipsync avatars");
    expect(normalize("Café — Crème")).toBe("cafe creme");
    expect(normalize("FLUX.2 [klein]")).toBe("flux.2 klein");
  });

  it("ranks whole > start > word start > inside > letters in order", () => {
    const scores = [wordScore("video", "video"), wordScore("vid", "video tools"), wordScore("tools", "video tools"), wordScore("deo", "video"), wordScore("vdo", "video")];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
    expect(scores.at(-1)).toBeGreaterThan(0);
  });

  it("forgives a missing space and a typo, but not noise", () => {
    expect(wordScore("faceswap", "face swap")).toBeGreaterThan(0);
    expect(wordScore("cinma", "cinema studio")).toBeGreaterThan(0);
    expect(wordScore("zq", "cinema studio")).toBe(0);
    // Letters strewn across a long label are no match.
    expect(wordScore("cso", "cinema studio of something")).toBe(0);
    // One letter only matches the start of a word.
    expect(wordScore("s", "cinema studio")).toBeGreaterThan(0);
    expect(wordScore("t", "cinema studio")).toBe(0);
  });

  it("needs every word, from the label or (worth less) the keywords", () => {
    const audio = page("Audio", "/audio", "voice tts music");
    expect(entryScore("tts", audio)).toBeGreaterThan(0);
    expect(entryScore("audio", audio)).toBeGreaterThan(entryScore("tts", audio));
    expect(entryScore("audio guitar", audio)).toBe(0);
    expect(entryScore("", audio)).toBe(0);
  });
});

describe("palette ranking", () => {
  it("puts the page first when a page and presets share a word", () => {
    expect(top("video")[0]).toBe("Video");
    expect(top("cinema")[0]).toBe("Cinema Studio");
    expect(top("settings")[0]).toBe("Settings");
    expect(top("upscale")[0]).toBe("Upscale");
  });

  it("finds a page by a keyword and with a typo", () => {
    expect(top("tts")).toContain("Audio");
    expect(top("cinma")[0]).toBe("Cinema Studio");
    expect(top("libary")).toContain("All creations");
  });

  it("finds apps, motions, effects and models by name", () => {
    const app = APPS.find((a) => a.id === "app-packshot")!;
    expect(top(app.name)).toContain(app.name);
    const motion = MOTIONS[0];
    const groups = rankPalette(ALL, motion.name);
    expect(groups.find((g) => g.kind === "motion")?.entries.map((e) => e.label)).toContain(motion.name);
    const model = MODELS.find((m) => !m.hidden && m.engine === "cloud")!;
    expect(rankPalette(ALL, model.name).find((g) => g.kind === "model")?.entries.map((e) => e.label)).toContain(model.name);
  });

  it("orders groups by their best match and caps each group", () => {
    const groups = rankPalette(ALL, "zoom");
    for (const g of groups) expect(g.entries.length).toBeLessThanOrEqual({ page: 6, setting: 4, app: 5, motion: 4, effect: 4, model: 5, recent: 5 }[g.kind]);
    const best = groups.map((g) => entryScore("zoom", g.entries[0]));
    expect(best).toEqual([...best].sort((a, b) => b - a));
  });

  it("matches nothing on an empty query (the palette shows its own start list)", () => {
    expect(rankPalette(ALL, "")).toEqual([]);
    expect(rankPalette(ALL, "   ")).toEqual([]);
  });
});

describe("palette index", () => {
  const routes = (() => {
    const root = path.resolve(__dirname, "..");
    const { routes, patterns } = studioRoutes(root);
    return { paths: new Set([...routes, ...hubModePaths(root)]), patterns };
  })();
  const pathOf = (href: string) => href.split("?")[0];

  it("lists every app, motion, effect and offered model, slim", () => {
    expect(index.apps).toHaveLength(APPS.length);
    expect(index.motions).toHaveLength(MOTIONS.length);
    expect(index.effects).toHaveLength(EFFECTS.length);
    expect(index.models).toHaveLength(MODELS.filter((m) => !m.hidden).length);
    // No prompt templates, routes or LoRA URLs: the whole thing stays small.
    expect(JSON.stringify(index).length).toBeLessThan(160_000);
    expect(Object.keys(index.apps[0]).sort()).toEqual(["category", "cloud", "id", "name", "open"]);
  });

  it("opens every model somewhere that exists, in a studio of its kind when there is one", () => {
    for (const m of index.models) {
      const p = pathOf(m.href);
      expect(routes.paths.has(p) || p === "/models", `${m.id} → ${m.href}`).toBe(true);
    }
    expect(modelHref(getModel("nano-banana-pro")!)).toBe("/image?model=nano-banana-pro");
    expect(modelHref(getModel("seedance-2-5")!)).toBe("/video?model=seedance-2-5");
    expect(modelHref(getModel("oss-qwen-edit")!)).toMatch(/^\/(edit|image)\?model=oss-qwen-edit$/);
  });

  it("opens every page and settings section the palette lists", () => {
    for (const p of PAGES) expect(routes.paths.has(pathOf(p.href)), p.href).toBe(true);
    const form = fs.readFileSync(path.resolve(__dirname, "../src/components/settings-form.tsx"), "utf8");
    const palette = fs.readFileSync(path.resolve(__dirname, "../src/components/command-palette.tsx"), "utf8");
    const ids = [...palette.matchAll(/\{ id: "([a-z-]+)", label:/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    for (const id of ids) expect(form, `settings section #${id}`).toContain(`id="${id}"`);
  });

  it("leaves out what a locked engine can't run", () => {
    const open = indexEntries(index, "open");
    const cloud = indexEntries(index, "cloud");
    expect(open.filter((e) => e.kind === "model").every((e) => e.keywords?.includes("open source"))).toBe(true);
    expect(cloud.filter((e) => e.kind === "model").every((e) => e.keywords?.includes("cloud"))).toBe(true);
    const openApps = new Set(open.filter((e) => e.kind === "app").map((e) => e.key));
    for (const a of index.apps) expect(openApps.has(`app:${a.id}`)).toBe(a.open);
    expect(indexEntries(index, "both").length).toBeGreaterThan(open.length);
  });

  it("links presets the way their galleries do", () => {
    const entries = indexEntries(index, "both");
    expect(entries.find((e) => e.kind === "app")?.href).toMatch(/^\/apps\/app-/);
    expect(entries.find((e) => e.kind === "motion")?.href).toMatch(/^\/video\?preset=/);
    expect(entries.find((e) => e.kind === "effect")?.href).toMatch(/^\/video\?preset=/);
  });
});
