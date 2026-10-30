import { describe, expect, it } from "vitest";
import { enginesOf } from "@/lib/catalog/engines";
import { getModel, supportsOp } from "@/lib/catalog";
import {
  AD_STYLES,
  CATEGORIES,
  cueLines,
  estimateCues,
  fitScript,
  FORMATS,
  formatModels,
  interleaved,
  mentionedImages,
  mentionsFor,
  MULTIPLIER_MODELS,
  multiplierText,
  researchLabel,
  RESEARCH_LABELS,
  runStatus,
  shotPlan,
  snapDuration,
  TEMPLATES,
  templatesFor,
  UGC_HOOKS,
  UGC_MODELS,
  UGC_SETTINGS,
  wordBudget,
  type FormatId,
} from "@/lib/catalog/marketing";
import type { Generation } from "@/lib/catalog/types";
import { AD_LAYOUTS, contrast, coverCrop, exportName, fitText, planAd, planRects, readableOn, sizeFor, themeFrom, wrapText, type Measure } from "@/components/ads/layout";

describe("marketing catalog", () => {
  it("ships Fuobe's own templates for every category, with unique ids and valid formats", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(80);
    for (const c of CATEGORIES.filter((c) => c.id !== "all")) expect(templatesFor(c.id as never, "all").length, c.label).toBeGreaterThanOrEqual(5);
    for (const t of TEMPLATES) {
      expect(FORMATS[t.format], t.id).toBeDefined();
      expect(t.prompt.length, t.id).toBeGreaterThan(40);
      if (t.hook) expect(UGC_HOOKS.some((h) => h.id === t.hook)).toBe(true);
      if (t.setting) expect(UGC_SETTINGS.some((s) => s.id === t.setting)).toBe(true);
    }
    expect(templatesFor("all", "video").every((t) => FORMATS[t.format].kind === "video")).toBe(true);
  });

  it("interleaves categories so the first row of All shows the range", () => {
    const first = interleaved(templatesFor("all", "all")).slice(0, 7);
    expect(new Set(first.map((t) => FORMATS[t.format].category)).size).toBe(7);
  });

  it("has the 9 hooks, 14 settings, 10 Click-to-Ad styles and 14 research labels", () => {
    expect(UGC_HOOKS).toHaveLength(9);
    expect(UGC_SETTINGS).toHaveLength(14);
    expect(AD_STYLES).toHaveLength(10);
    expect(RESEARCH_LABELS).toHaveLength(14);
    expect(new Set(UGC_SETTINGS.map((s) => s.id)).size).toBe(14);
  });

  it("routes every format to models that exist and do the job, on both engines", () => {
    for (const id of Object.keys(FORMATS) as FormatId[]) {
      for (const engine of ["cloud", "open"] as const) {
        for (const has of [{ product: true, avatar: false }, { product: false, avatar: true }]) {
          const list = formatModels(FORMATS[id], engine, has);
          expect(list.length, `${id}/${engine}`).toBeGreaterThan(0);
          for (const c of list) {
            const m = getModel(c.id);
            expect(m, c.id).toBeDefined();
            // A Fuobe Original runs on both engines.
            expect(enginesOf(m!), c.id).toContain(engine);
          }
        }
      }
    }
    for (const engine of ["cloud", "open"] as const) {
      const M = UGC_MODELS[engine];
      expect(supportsOp(getModel(M.voice)!, "tts")).toBe(true);
      expect(supportsOp(getModel(M.talk)!, "avatar")).toBe(true);
      expect(supportsOp(getModel(M.clip)!, "i2v")).toBe(true);
      expect(supportsOp(getModel(M.captions)!, "captions")).toBe(true);
      expect(supportsOp(getModel(M.join)!, "concat")).toBe(true);
      expect(supportsOp(getModel(M.mux)!, "mux")).toBe(true);
      expect(supportsOp(getModel(M.trim)!, "trim")).toBe(true);
      for (const c of MULTIPLIER_MODELS[engine]) expect(getModel(c.id)!.routes.some((r) => r.op === (engine === "open" ? "motion-transfer" : "v2v")), c.id).toBe(true);
    }
  });

  it("rotates the research labels through the writing stage while the LLM works", () => {
    const at = { index: 3, startedAt: 0 };
    expect(researchLabel(at, 0).label).toBe("Tuning in to your tone of voice");
    expect(researchLabel(at, 2200).label).toBe("Decoding your aesthetics");
    expect(researchLabel(at, 2200 * 8).label).toBe("Tuning in to your tone of voice");
    expect(researchLabel({ index: 12, startedAt: 0 }, 99999).label).toBe("Building your brand kit");
    expect(researchLabel(null, 0).index).toBe(0);
  });
});

describe("Ad Multiplier text and @image mentions", () => {
  it("sends the prompt, or HOOK/CTA sections (both when both are on)", () => {
    expect(multiplierText({ mode: "prompt", prompt: "" })).toBe("Recreate this ad.");
    expect(multiplierText({ mode: "sections", hook: "What if?", cta: null })).toBe("HOOK: What if?");
    expect(multiplierText({ mode: "sections", hook: "What if?", cta: "Try free" })).toBe("HOOK: What if?\n\nCTA: Try free");
    expect(multiplierText({ mode: "sections", hook: "", cta: "" })).toBe("HOOK: Write a new opening hook.\n\nCTA: Write a new call to action.");
  });

  it("puts mentioned images first, renumbers them for the model and caps at its limit", () => {
    const imgs = ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"];
    expect(mentionedImages("swap @image_3 for @image_1, keep @image_3")).toEqual([3, 1]);
    const k = mentionsFor("Put @image_5 in her hand and dress her like @image_2", imgs, "kling-o3", 4);
    expect(k.images).toEqual(["e.png", "b.png", "a.png", "c.png"]);
    expect(k.prompt).toBe("Put @Image1 in her hand and dress her like @Image2");
    expect(k.dropped).toBe(2);
    const s = mentionsFor("Use @image_2", imgs.slice(0, 2), "seedance-2-5", 4);
    expect(s).toEqual({ prompt: "Use image 1", images: ["b.png", "a.png"], dropped: 0 });
    // Past the limit, or a model with no image input: the mention becomes plain words.
    expect(mentionsFor("Use @image_2", ["a.png", "b.png"], "gemini-omni-flash", 0)).toEqual({ prompt: "Use the reference", images: [], dropped: 2 });
  });
});

describe("scripts, captions and durations", () => {
  it("sizes scripts at a natural speaking pace and trims at a sentence end", () => {
    expect(wordBudget(12)).toBe(30);
    const long = "This is the first sentence of the script. ".repeat(10);
    const cut = fitScript(long, 6);
    expect(cut.split(" ").length).toBeLessThanOrEqual(15);
    expect(cut.endsWith(".")).toBe(true);
    expect(fitScript("Short and sweet.", 10)).toBe("Short and sweet.");
  });

  it("times captions from the script in short chunks that follow punctuation", () => {
    const cues = estimateCues("Okay, I need to tell you about this. It changed my mornings!", 4);
    expect(cues[0]).toEqual({ start: 0, end: 0.4, text: "Okay," });
    expect(cues.map((c) => c.text)).toEqual(["Okay,", "I need to tell", "you about this.", "It changed my mornings!"]);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 5);
    expect(cueLines(cues).split("\n")[1]).toBe("0.40-2.00: I need to tell");
  });

  it("snaps durations to what a model makes and splits long open clips into shots", () => {
    expect(snapDuration(15, [4, 5, 6, 8, 10, 12, 30])).toBe(12);
    expect(snapDuration(9, [8, 10])).toBe(8);
    expect(snapDuration(7, undefined)).toBe(7);
    expect(shotPlan(15, [3, 5])).toEqual([5, 5, 5]);
    expect(shotPlan(10, [3, 5])).toEqual([5, 5]);
    expect(shotPlan(5, [3, 5])).toEqual([5]);
    expect(shotPlan(9, [3, 5])).toEqual([5, 5]);
  });

  it("sums a run up from its steps", () => {
    const g = (id: string, status: Generation["status"], error?: string, label?: string) => ({ id, status, error, request: { step: label ? { label, index: 0, of: 1 } : undefined } }) as unknown as Generation;
    expect(runStatus({ finalIds: ["f"], generations: [g("a", "succeeded"), g("f", "succeeded")] }).state).toBe("done");
    expect(runStatus({ finalIds: ["f"], generations: [g("a", "running"), g("f", "queued")] }).state).toBe("running");
    const failed = runStatus({ finalIds: ["f"], generations: [g("a", "failed", "No credits", "Voiceover"), g("f", "failed", "An earlier step didn't finish")] });
    expect(failed).toEqual({ state: "failed", step: "Voiceover", error: "No credits" });
  });
});

// A predictable measure: every character is 0.55 em wide.
const measure: Measure = (text, font) => text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.55;

describe("ad compositing layout", () => {
  const theme = themeFrom({ colors: ["#fdf6ec", "#1c1917", "#c2410c"], fonts: { heading: "Fraunces", body: "Inter" } });

  it("takes the most colourful brand colour as the accent with readable text on it", () => {
    expect(theme.accent).toBe("#c2410c");
    expect(theme.onAccent).toBe("#ffffff");
    expect(theme.ink).toBe("#1c1917");
    expect(theme.paper).toBe("#fdf6ec");
    expect(themeFrom(null).accent).toBe("#5d4bdb");
    expect(readableOn("#ffe14d")).toBe("#141414");
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });

  it("crops the visual to cover its box without distortion", () => {
    expect(coverCrop(1000, 1000, 1080, 1920)).toEqual({ sx: 218.75, sy: 0, sw: 562.5, sh: 1000 });
    const c = coverCrop(1600, 900, 1080, 1350, { x: 0.5, y: 0.5 });
    expect(c.sw / c.sh).toBeCloseTo(1080 / 1350, 5);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sx + c.sw).toBeLessThanOrEqual(1600);
  });

  it("wraps text and breaks over-long words", () => {
    const font = "800 40px Inter";
    expect(wrapText("Meet the new granola everyone talks about", 450, font, measure)).toEqual(["Meet the new granola", "everyone talks about"]);
    expect(wrapText("Supercalifragilistic", 200, font, measure)).toEqual(["Supercali", "fragilist", "ic"]);
  });

  it("shrinks a long headline before it overflows, and ends with … at the smallest size", () => {
    const short = fitText("Hello", 900, 2, "Inter", 800, 100, 40, measure);
    expect(short.size).toBe(100);
    const long = fitText("A very long headline that keeps going and going well past two lines of type", 900, 2, "Inter", 800, 100, 40, measure);
    expect(long.size).toBeLessThan(100);
    expect(long.lines.length).toBeLessThanOrEqual(2);
    const huge = fitText("word ".repeat(80), 900, 2, "Inter", 800, 100, 40, measure);
    expect(huge.size).toBe(40);
    expect(huge.lines[1].endsWith("…")).toBe(true);
  });

  it("keeps every box inside the canvas for each format and layout (and a generated poster's own ratio)", () => {
    const content = { headline: "Granola that tastes like a slow Sunday morning", body: "Organic oats, maple and sea salt, roasted in small batches in Portland.", cta: "Shop now", brand: "Ember & Oat" };
    expect(sizeFor("3:4")).toEqual({ w: 1080, h: 1440 });
    expect(sizeFor("nonsense")).toEqual(sizeFor("1:1"));
    for (const ratio of ["1:1", "4:5", "9:16", "3:4", "2:3", "4:3", "3:2", "16:9"]) {
      for (const layout of AD_LAYOUTS.map((l) => l.id)) {
        for (const logo of [null, { w: 400, h: 120 }]) {
          const plan = planAd({ ratio, layout, content, theme, image: { w: 1024, h: 1280 }, logo, measure });
          const { w, h } = sizeFor(ratio);
          expect(plan.w).toBe(w);
          for (const r of planRects(plan)) {
            expect(r.x, `${ratio} ${layout}`).toBeGreaterThanOrEqual(-0.5);
            expect(r.y, `${ratio} ${layout}`).toBeGreaterThanOrEqual(-0.5);
            expect(r.x + r.w, `${ratio} ${layout}`).toBeLessThanOrEqual(w + 0.5);
            expect(r.y + r.h, `${ratio} ${layout}`).toBeLessThanOrEqual(h + 0.5);
          }
          // The headline never runs into the CTA.
          if (plan.cta && layout !== "band") expect(plan.headline.y + plan.headline.lines.length * plan.headline.lineHeight).toBeLessThanOrEqual(plan.cta.y + 0.5);
          expect(plan.headline.lines.join(" "), `${ratio} ${layout}`).toBe(content.headline);
          if (logo) expect(plan.brand).toBeUndefined();
        }
      }
    }
  });

  it("names exported files after the brand, product, format and number", () => {
    expect(exportName("Ember & Oat", "Maple Pecan Granola", "4:5", 3)).toBe("ember-oat-maple-pecan-granola-4x5-3.png");
    expect(exportName("", undefined, "9:16", 1)).toBe("ad-9x16-1.png");
  });
});
