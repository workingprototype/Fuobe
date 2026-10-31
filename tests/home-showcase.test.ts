import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/nav-items";
import { APPS, EFFECTS, MODELS, MOTIONS, getPreset } from "@/lib/catalog";
import { CAMERA_MOVES } from "@/lib/catalog/cinema";
import { LLM_PROVIDERS } from "@/lib/catalog/llm-providers";
import { TEMPLATES } from "@/lib/catalog/marketing";
import { ASSIST_PROMPT_MAX, ASSIST_SUGGESTIONS, assistDraft } from "@/lib/assist";
import { HUB_MODES } from "@/lib/hubs";
import { buildLicenceList, type LicenceWorkflowInput } from "@/lib/licences";
import {
  HOME_BEFORE_AFTER,
  HOME_EFFECTS,
  HOME_MOTIONS,
  HOME_NEW_OPEN,
  HOME_OWN_SECTIONS,
  HOME_REVEALS,
  HOME_SKILLS,
  HOME_STUDIOS,
  HOME_TRY,
  HOME_WALL,
  homeShowcase,
  newOpenModels,
  presetHref,
  roundedDown,
} from "@/lib/home-showcase";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";

/*
 * Home's showcase (src/lib/home-showcase.ts) against the catalog and the files in public/: every preset it names is
 * real, has its cover (and its clip where the slot plays one), shows once, and every number it quotes is the
 * catalog's own.
 */

const root = process.cwd();
const exists = (url: string) => (fs.statSync(path.join(root, "public", url), { throwIfNoEntry: false })?.size ?? 0) > 0;

/** Covers the reviews turned down: no real cover yet, or white bars at the sides (and Text Edit's white edge). */
const NO_COVER = ["app-fuobe-angles", "app-talking-photo", "motion-dolly-zoom-out", "motion-buckle-up"];
const WHITE_BARS = ["app-dance", "app-simlife", "app-game-dump", "app-japanese-show", "app-comic-book", "app-banana-eating", "app-change-background", "effect-boiling-point", "effect-color-rain", "app-text-edit"];
/** Studio cards that rest on a still: Image to 3D's turntable shot. */
const STILLS = ["app-3d-rotation"];

const studioIds = HOME_STUDIOS.flatMap((s) => (s.id ? [s.id] : []));
const homeIds = [...HOME_WALL.map((t) => t.id), ...HOME_EFFECTS, ...HOME_MOTIONS, ...HOME_BEFORE_AFTER.map((p) => p.id), ...HOME_REVEALS, ...studioIds];

describe("Home's showcase", () => {
  it("names real presets, each with its cover and, where the slot plays one, its clip", () => {
    for (const id of homeIds) {
      expect(getPreset(id), id).toBeDefined();
      const cover = PRESET_PREVIEWS[id];
      expect(cover, `${id} has a real cover`).toBeDefined();
      expect(exists(cover.poster), cover.poster).toBe(true);
      if (!STILLS.includes(id)) {
        expect(cover.video, `${id} has a clip`).toBeDefined();
        expect(exists(cover.video!), cover.video).toBe(true);
      }
      expect(NO_COVER, id).not.toContain(id);
      expect(WHITE_BARS, id).not.toContain(id);
    }
    expect(fs.existsSync(path.join(root, "public", "previews", "presets", "thumbs", `${HOME_BEFORE_AFTER[0].id}.jpg`))).toBe(true);
  });

  it("shows each preset once (the playback store keys by id: a repeat would play in two places)", () => {
    expect(new Set(homeIds).size).toBe(homeIds.length);
  });

  it("rests effects and apps on their peak frame, cut and listed; camera motions on their poster", async () => {
    const home = await homeShowcase();
    const cards = [...home.wall.map((t) => t.card), ...home.effects, ...home.motions, ...home.reveals, ...home.studios.flatMap((s) => (s.card ? [s.card] : []))];
    for (const c of cards) {
      const peaked = !!PRESET_PEAKS[c.id];
      expect(!!c.preview.rest, c.id).toBe(peaked);
      if (c.preview.rest) {
        expect(c.preview.rest).toEqual({ src: `/previews/presets/peak/${c.id}.jpg`, at: PRESET_PEAKS[c.id].at });
        expect(exists(c.preview.rest.src), c.preview.rest.src).toBe(true);
      }
      if (c.id.startsWith("motion-")) expect(c.preview.rest, c.id).toBeUndefined();
    }
    for (const id of [...HOME_EFFECTS, ...HOME_REVEALS, ...HOME_WALL.filter((t) => !t.id.startsWith("motion-")).map((t) => t.id)]) expect(PRESET_PEAKS[id], id).toBeDefined();
    // The before/after: the poster, then the peak.
    for (const p of home.beforeAfter) {
      expect(p.before).toBe(PRESET_PREVIEWS[p.id].poster);
      expect(p.after).toBe(`/previews/presets/peak/${p.id}.jpg`);
      expect(p.tags).toHaveLength(2);
    }
    // Every peak in the list has its file, and every file is in the list; a peak starts inside its clip's last second.
    const files = fs.readdirSync(path.join(root, "public", "previews", "presets", "peak")).map((f) => f.replace(/\.jpg$/, ""));
    expect(files.sort()).toEqual(Object.keys(PRESET_PEAKS).sort());
    for (const [id, { at }] of Object.entries(PRESET_PEAKS)) {
      expect(PRESET_PREVIEWS[id]?.video, id).toBeDefined();
      expect(at, id).toBeGreaterThan(2.5);
      expect(at, id).toBeLessThan(4);
    }
  });

  it("links effects and motions to the Video studio with the preset picked, apps to their own page", async () => {
    expect(presetHref("effect-flame-on")).toBe("/video?preset=effect-flame-on");
    expect(presetHref("motion-glam")).toBe("/video?preset=motion-glam");
    expect(presetHref("app-relight")).toBe("/apps/app-relight");
    const home = await homeShowcase();
    for (const t of home.wall) expect(t.href).toBe(presetHref(t.id));
    for (const p of home.beforeAfter) expect(p.href).toBe(`/apps/${p.id}`);
    const routes = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));
    for (const s of home.studios) expect(routes.has(s.href), s.href).toBe(true);
    for (const p of home.pills) expect(routes.has(p.href), p.href).toBe(true);
  });

  it("covers every place to create: the studio cards, the pills and the four with a section of their own", async () => {
    const home = await homeShowcase();
    const create = NAV.find((g) => g.label === "Create")!.items.filter((i) => i.href !== "/");
    const studios = NAV.find((g) => g.label === "Studios")!.items;
    expect(home.facts.destinations).toBe(create.length + studios.length);
    expect(home.studios.length + home.pills.length + HOME_OWN_SECTIONS.length).toBe(home.facts.destinations);
    const shown = [...home.studios.map((s) => s.href), ...home.pills.map((p) => p.href), ...HOME_OWN_SECTIONS];
    expect(new Set(shown).size).toBe(shown.length);
    expect(new Set(shown)).toEqual(new Set([...create, ...studios].map((i) => i.href)));
    // The pills keep the sidebar's order and labels.
    const order = [...create, ...studios].map((i) => i.href);
    expect(home.pills.map((p) => order.indexOf(p.href))).toEqual(home.pills.map((p) => order.indexOf(p.href)).sort((a, b) => a - b));
    expect(home.studios.find((s) => s.href === "/audio")?.card).toBeUndefined();
  });

  it("quotes the catalog's own numbers", async () => {
    const { facts, studios, audioTools } = await homeShowcase();
    const visible = MODELS.filter((m) => !m.hidden);
    const open = (m: (typeof MODELS)[number]) => m.engine === "open" || !!m.engines?.includes("open");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "manifest.json"), "utf8")) as { workflows: LicenceWorkflowInput[] };
    expect(facts.workflows).toBe(manifest.workflows.length);
    expect(facts.presets).toBe(APPS.length + MOTIONS.length + EFFECTS.length);
    expect([facts.apps, facts.motions, facts.effects]).toEqual([APPS.length, MOTIONS.length, EFFECTS.length]);
    expect(facts.originals).toBe(visible.filter((m) => m.vendor === "Fuobe Original").length);
    expect(facts.originals).toBeGreaterThan(0);
    expect(facts.partners).toBe(visible.filter((m) => m.engine === "cloud" && !m.engines?.includes("open")).length);
    expect(facts.cinemaMoves).toBe(CAMERA_MOVES.length);
    expect(facts.adTemplates).toBe(TEMPLATES.length);
    expect(facts.mixedLooks).toBe(EFFECTS.filter((e) => e.category === "Mixed Media").length);
    expect(facts.audioTools).toBe(HUB_MODES.audio.length);
    expect(facts.skills).toBe(fs.readdirSync(path.join(root, "skills")).filter((d) => fs.existsSync(path.join(root, "skills", d, "SKILL.md"))).length);
    // The open models are About & licences' count (src/app/(studio)/settings/about/page.tsx): one row per model or graph with weights.
    const about = buildLicenceList(
      MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, hidden: m.hidden, routes: m.routes.map((r) => ({ provider: r.provider, endpoint: r.endpoint })) })),
      manifest.workflows,
    );
    expect(facts.openModels).toBe(about.counts.all);
    expect(facts.openModels).toBeGreaterThan(visible.filter((m) => open(m)).length / 2);
    // The studio cards' lines carry them.
    expect(studios.find((s) => s.href === "/cinema")?.line).toContain(`${facts.cinemaMoves} moves`);
    expect(studios.find((s) => s.href === "/marketing")?.line).toContain(`${facts.adTemplates} ad templates`);
    expect(studios.find((s) => s.href === "/mixed-media")?.line).toContain(`${facts.mixedLooks} looks`);
    expect(audioTools.named).toEqual(["Speech", "Dialogue", "Music", "Sound effects", "Split soundtrack"]);
    expect(audioTools.named.length + audioTools.more).toBe(HUB_MODES.audio.length);
  });

  it("rounds the open models down to ten, so the subtitle never overstates", () => {
    expect(roundedDown(131)).toBe("130+");
    expect(roundedDown(140)).toBe("140+");
    expect(roundedDown(149)).toBe("140+");
  });

  it("lists Just added from the catalog's live open models, newest first", () => {
    const models = newOpenModels();
    expect(models.length).toBeGreaterThanOrEqual(6);
    expect(models.length).toBeLessThanOrEqual(8);
    // A typo would hide a model: every id on the list is in the catalog.
    for (const id of HOME_NEW_OPEN) expect(MODELS.some((m) => m.id === id), id).toBe(true);
    const listed = HOME_NEW_OPEN.filter((id) => MODELS.some((m) => m.id === id && !m.hidden));
    expect(models.map((m) => m.id)).toEqual(listed.slice(0, 8));
    for (const m of models) expect(m.href).toMatch(/^\//);
    // A model not merged yet (or hidden) doesn't show, and the catalog's other new open models fill in.
    const fewer = newOpenModels(MODELS.filter((m) => !HOME_NEW_OPEN.slice(0, 10).includes(m.id)));
    expect(fewer.length).toBeGreaterThanOrEqual(6);
    for (const m of fewer) expect(HOME_NEW_OPEN.slice(0, 10)).not.toContain(m.id);
  });

  it("says what Assist plans with, from the provider registry", async () => {
    const { runsOn, skills } = await homeShowcase();
    const hosted = LLM_PROVIDERS.filter((p) => p.group !== "local");
    expect(runsOn.named).toEqual(hosted.slice(0, 6).map((p) => p.short));
    expect(runsOn.named.length + runsOn.more).toBe(hosted.length);
    expect(runsOn.local).toEqual(LLM_PROVIDERS.filter((p) => p.group === "local" && p.id !== "custom").map((p) => p.label));
    // The starter skills exist, each with its SKILL.md title.
    expect(skills.map((s) => s.name)).toEqual(HOME_SKILLS);
    for (const s of skills) expect(fs.readFileSync(path.join(root, "skills", s.name, "SKILL.md"), "utf8")).toContain(`title: ${s.title}`);
  });

  it("fills the composer from a Try chip in one of its three modes", () => {
    for (const c of HOME_TRY) {
      expect(["image", "video", "edit"]).toContain(c.mode);
      expect(c.prompt.length).toBeGreaterThan(c.label.length);
    }
    expect(new Set(HOME_TRY.map((c) => c.mode)).size).toBe(HOME_TRY.length);
  });
});

describe("Assist's address prefill", () => {
  it("types ?prompt= into a new chat (cut to its limit), and ?skill= wins over it; nothing is sent", () => {
    expect(assistDraft(null, ASSIST_SUGGESTIONS[0])).toBe(ASSIST_SUGGESTIONS[0]);
    expect(assistDraft(null, null)).toBe("");
    expect(assistDraft(null, "x".repeat(ASSIST_PROMPT_MAX + 50))).toHaveLength(ASSIST_PROMPT_MAX);
    expect(assistDraft("ugc-video", "ignored")).toBe("/ugc-video ");
    expect(assistDraft("Not a skill!", "ignored")).toBe("");
  });
});
