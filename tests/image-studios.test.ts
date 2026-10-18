import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { castName, randomizeCast, SOUL_CAST_FIELDS } from "@/lib/catalog/cinema";
import { applyMentions, type StudioElement } from "@/lib/catalog/elements";
import { PHOTODUMP_PACKS, SOUL_DEFAULT, SOUL_PRESETS } from "@/lib/catalog/higgsfield-presets.generated";
import {
  castFieldVisible,
  castNameFor,
  castSheetModel,
  customPack,
  CURATED_MOODBOARDS,
  FASHION,
  FASHION_START,
  fashionBaseRequest,
  fashionBlocker,
  fashionOutfitRequest,
  fashionPhotosetRequests,
  fashionReducer,
  getPack,
  inTab,
  PACKS,
  planPhotodump,
  presetFallback,
  presetPrompt,
  presetTabs,
  randomCast,
  sheetFromReference,
  shotPrompt,
  type FashionState,
  type PhotoSubject,
} from "@/lib/catalog/packs";
import {
  applySignature,
  cardStrip,
  extractPalette,
  kmeans,
  normalizeHex,
  paletteColors,
  paletteError,
  randomPalettes,
  rng,
  samplePixels,
  suggestName,
  type MoodboardPick,
  type PalettePick,
  type RGB,
  type SignatureCaps,
} from "@/lib/catalog/palettes";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest } from "@/lib/catalog/types";
import { collageGroups, colorFeature, coverCrop, imageProblem, moodboardError, moodboardStatus, representativeOrder } from "@/components/moodboards/logic";

// The caps GET /api/palettes sends (src/server/palettes.ts signatureCaps, checked against the catalog in image-studios-api.test.ts).
const CAPS: SignatureCaps = {
  native: {
    "recraft-4-1": { max: 10, background: "background_color" },
    "recraft-4-1-pro": { max: 10, background: "background_color" },
    "recraft-4-style": { max: 10, background: "background_color" },
    "recraft-4-style-pro": { max: 10, background: "background_color" },
    "recraft-4-style-saved": { max: 10, background: "background_color" },
    "ideogram-3": { max: 12 },
  },
};
const ctx = { caps: CAPS, getModel };
const plan = (r: GenerationRequest) => planGeneration(r, getModel, getPreset);

const fill = (rgb: RGB, n: number): RGB[] => Array.from({ length: n }, () => [...rgb] as RGB);
const PAL: PalettePick = { id: "p1", name: "Teal Dusk", colors: ["#102030", "#2A9D8F", "#E9C46A", "#F4A261"], background: "#264653", slug: null };
const CINEMA_PAL: PalettePick = { id: "builtin-static-noon", name: "Static Noon", colors: ["#0C0C0C", "#69483B"], background: "#69483B", slug: "static-noon" };

describe("palettes: k-means extraction", () => {
  it("finds each image's colours, gives every image a say, and orders them dark → light", () => {
    const a = [...fill([200, 30, 30], 900), ...fill([20, 20, 20], 100)];
    const b = fill([30, 60, 220], 50);
    const r = extractPalette([a, b], { count: 4, seed: 1 });
    expect(r.colors).toContain("#C81E1E");
    expect(r.colors).toContain("#1E3CDC");
    expect(r.colors).toContain("#141414");
    // Dark → light by luminance.
    expect(r.colors[0]).toBe("#141414");
    // The dominant colour is the background.
    expect(["#C81E1E", "#1E3CDC"]).toContain(r.background);
    expect(r.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 1);
  });

  it("merges near-identical clusters and is deterministic", () => {
    const px = [...fill([100, 100, 100], 500), ...fill([104, 102, 101], 500), ...fill([250, 250, 250], 200)];
    const one = extractPalette([px], { count: 6, seed: 3 });
    expect(one).toEqual(extractPalette([px], { count: 6, seed: 3 }));
    expect(one.colors.length).toBeLessThanOrEqual(2);
  });

  it("k-means sorts clusters by share; samplePixels skips transparent pixels", () => {
    const cl = kmeans([...fill([0, 0, 0], 30), ...fill([255, 255, 255], 70)], 2);
    expect(cl.map((c) => c.color)).toEqual(["#FFFFFF", "#000000"]);
    expect(cl[0].share).toBeCloseTo(0.7);
    const rgba = [10, 20, 30, 255, 1, 2, 3, 0];
    expect(samplePixels(rgba)).toEqual([[10, 20, 30]]);
    expect(extractPalette([[]])).toEqual({ colors: [], background: null, weights: [] });
  });

  it("validates, normalises and names palettes; random palettes have 2–12 colours", () => {
    expect(normalizeHex(" #abc ")).toBe("#AABBCC");
    expect(normalizeHex("12345g")).toBeNull();
    expect(paletteError({ name: "x", colors: [] })).toMatch(/at least one/);
    expect(paletteError({ name: "x", colors: Array(13).fill("#FFFFFF") })).toMatch(/up to 12/);
    expect(paletteError({ name: "x", colors: ["#GG0000"] })).toMatch(/isn't a colour/);
    expect(paletteError({ name: "ok", colors: ["#FFFFFF"], background: "#000000" })).toBeNull();
    expect(cardStrip({ colors: ["#111111", "#222222", "#111111"], background: "#222222" })).toEqual(["#222222", "#111111"]);
    expect(paletteColors({ colors: ["#111111"], background: "#333333" })).toEqual(["#111111", "#333333"]);
    expect(suggestName(["#0A0A0A", "#123456"])).toMatch(/\w+ \w+/);
    for (const row of randomPalettes(rng(5))) {
      expect(row.length).toBeGreaterThanOrEqual(2);
      expect(row.length).toBeLessThanOrEqual(12);
      expect(row.every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true);
    }
  });
});

describe("palettes: routing per model", () => {
  const req = (modelId: string, extra: Partial<GenerationRequest> = {}): GenerationRequest => ({ feature: "image", modelId, prompt: "a lighthouse at dusk", params: { numOutputs: 1 }, ...extra });

  it("sends the palette field to Recraft (≤10 colours, background in its own field) and Ideogram", () => {
    const r = applySignature(req("recraft-4-1"), { palette: PAL }, ctx);
    expect(r.request.params?.palette).toEqual(PAL.colors);
    expect(r.request.params?.extra?.background_color).toBe("#264653");
    expect(r.request.prompt).toBe("a lighthouse at dusk");
    const payload = buildPayload(getModel("recraft-4-1")!.routes[0].map!, { prompt: "x", palette: r.request.params!.palette, extra: r.request.params!.extra });
    expect(payload.colors).toEqual([{ r: 16, g: 32, b: 48 }, { r: 42, g: 157, b: 143 }, { r: 233, g: 196, b: 106 }, { r: 244, g: 162, b: 97 }]);
    expect(payload.background_color).toEqual({ r: 38, g: 70, b: 83 });

    const twelve = { ...PAL, colors: Array.from({ length: 12 }, (_, i) => `#0000${(i * 16).toString(16).padStart(2, "0").toUpperCase()}`) };
    const trimmed = applySignature(req("recraft-4-1"), { palette: twelve }, ctx);
    expect(trimmed.request.params?.palette).toHaveLength(10);
    expect(trimmed.notes.join()).toMatch(/takes 10 colours/);

    const ideo = applySignature(req("ideogram-3"), { palette: PAL }, ctx);
    expect(ideo.request.params?.palette).toEqual(PAL.colors);
    expect(ideo.request.params?.extra).toBeUndefined();
  });

  it("writes the hex list into the prompt for other cloud models (Soul 2.0, Nano Banana Pro)", () => {
    for (const id of ["nano-banana-pro", "soul-2", "gpt-image-2-5"]) {
      const r = applySignature(req(id), { palette: PAL }, ctx);
      expect(r.modelId).toBe(id);
      expect(r.request.prompt).toMatch(/^a lighthouse at dusk\. Color palette: use only these colors.*#102030.*background color #264653\.$/);
      expect(r.lock).toBeUndefined();
      expect(() => plan(r.request)).not.toThrow();
    }
  });

  it("passes a built-in palette's slug to Cinema Studio 4.0", () => {
    const r = applySignature({ feature: "video", modelId: "cinema-studio-4", prompt: "a chase" }, { palette: CINEMA_PAL }, ctx);
    expect(r.request.params?.extra?.color_palette).toBe("static-noon");
    expect(r.request.prompt).toBe("a chase");
  });

  it("moves open Z-Image Turbo to Z-Image Turbo · Palette, and locks other open models with a post-step", () => {
    const r = applySignature(req("oss-z-image-turbo", { params: { aspectRatio: "16:9", resolution: "1K" } }), { palette: PAL }, ctx);
    expect(r.modelId).toBe("oss-zimage-palette");
    expect(r.request.params?.palette).toEqual([...PAL.colors, "#264653"]);
    expect(r.request.params?.aspectRatio).toBe("16:9");
    expect(r.notes[0]).toMatch(/Z-Image Turbo · Palette/);
    expect(plan(r.request).model.id).toBe("oss-zimage-palette");

    const free = applySignature(req("oss-qwen-image"), { palette: PAL }, ctx);
    expect(free.lock).toBeUndefined();
    expect(free.request.prompt).toMatch(/Color palette/);
    const locked = applySignature(req("oss-qwen-image"), { palette: { ...PAL, lock: true } }, ctx);
    expect(locked.lock?.colors).toEqual([...PAL.colors, "#264653"]);
  });

  it("leaves requests alone without a signature or an unknown model", () => {
    const r = req("nano-banana-pro");
    expect(applySignature(r, undefined, ctx).request).toBe(r);
    expect(applySignature({ ...r, modelId: "nope" }, { palette: PAL }, ctx).request.modelId).toBe("nope");
  });
});

describe("moodboards: routing per model", () => {
  const refs = Array.from({ length: 12 }, (_, i) => `/api/files/uploads/r${i}.png`);
  const board: MoodboardPick = { id: "mb1", kind: "personal", name: "Neon Haze", status: "complete", refs: refs.slice(0, 10), collages: ["/api/files/uploads/c1.jpg", "/api/files/uploads/c2.jpg"] };
  const curated: MoodboardPick = { id: CURATED_MOODBOARDS[0].id, kind: "curated", name: CURATED_MOODBOARDS[0].name, description: "Soul 2.0's neutral default look", status: "complete" };
  const req = (modelId: string, images?: string[]): GenerationRequest => ({ feature: "image", modelId, prompt: "a rooftop party", inputs: images ? { images } : undefined, params: { numOutputs: 1 } });

  it("curated looks are Soul 2.0's style_id on soul-2, words elsewhere (the open route's prompt template)", () => {
    const soul = applySignature(req("soul-2"), { moodboard: curated }, ctx);
    expect(soul.request.params?.extra?.style_id).toBe(curated.id);
    expect(soul.request.prompt).toBe("a rooftop party");
    const open = applySignature(req("oss-z-image-turbo"), { moodboard: curated }, ctx);
    expect(open.modelId).toBe("oss-z-image-turbo");
    expect(open.request.prompt).toBe(presetPrompt({ name: curated.name, description: curated.description! }, "a rooftop party"));
  });

  it("personal boards: style references on multi-reference cloud models, Nano Banana Pro for the rest", () => {
    const nano = applySignature(req("nano-banana-pro", ["/api/files/uploads/own.png"]), { moodboard: board }, ctx);
    expect(nano.request.op).toBe("edit");
    expect(nano.request.inputs?.images).toEqual(["/api/files/uploads/own.png", ...refs.slice(0, 6)]);
    expect(nano.request.prompt).toMatch(/Use images 2–7 only as a style reference/);
    expect(plan(nano.request).op).toBe("edit");

    const soul = applySignature(req("soul-2"), { moodboard: board }, ctx);
    expect(soul.modelId).toBe("nano-banana-pro");
    expect(soul.notes[0]).toMatch(/can't take style references/);
    expect(soul.request.inputs?.images).toHaveLength(6);
  });

  it("Recraft models use the board's saved style id, or its 10 images on Recraft V4 Styles", () => {
    const saved = applySignature(req("recraft-4-1"), { moodboard: { ...board, styleId: "3f6c1a2b-0000-4000-8000-000000000000" } }, ctx);
    expect(saved.modelId).toBe("recraft-4-style-saved");
    expect(saved.request.params?.styleId).toBe("3f6c1a2b-0000-4000-8000-000000000000");
    const p = plan(saved.request);
    expect(p.op).toBe("t2i");
    expect(buildPayload(p.model.routes[0].map!, { prompt: p.prompt, styleId: p.params.styleId })).toMatchObject({ prompt: "a rooftop party", style_id: "3f6c1a2b-0000-4000-8000-000000000000" });

    const fresh = applySignature(req("recraft-4-1"), { moodboard: board }, ctx);
    expect(fresh.modelId).toBe("recraft-4-style");
    expect(fresh.request.inputs?.images).toEqual(refs.slice(0, 10));
    expect(plan(fresh.request).op).toBe("edit");
  });

  it("open engine: collages on Qwen-Image-Edit Style Reference, single refs on FLUX.2 klein, the trained LoRA on Z-Image Turbo", () => {
    const def = applySignature(req("oss-z-image-turbo"), { moodboard: board }, ctx);
    expect(def.modelId).toBe("oss-style-qwen-edit");
    expect(def.request.inputs?.images).toEqual(board.collages);
    expect(() => plan(def.request)).not.toThrow();

    const klein = applySignature(req("oss-style-flux2-klein"), { moodboard: board }, ctx);
    expect(klein.modelId).toBe("oss-style-flux2-klein");
    expect(klein.request.inputs?.images).toEqual(refs.slice(0, 4));

    const lora = applySignature(req("oss-z-image-turbo"), { moodboard: { ...board, loraHandle: "Neon_Haze" } }, ctx);
    expect(lora.modelId).toBe("oss-z-image-turbo");
    expect(lora.request.prompt).toBe("a rooftop party. In the style of @Neon_Haze.");
  });

  it("a board that isn't ready blocks with Higgsfield's copy; palette + moodboard combine", () => {
    expect(applySignature(req("nano-banana-pro"), { moodboard: { ...board, status: "running" } }, ctx).blocker).toBe("This moodboard is still training. Try again once it is ready.");
    const both = applySignature(req("oss-z-image-turbo"), { moodboard: board, palette: PAL }, ctx);
    // The moodboard moves it to the style model, which then gets the palette in words (not the palette model).
    expect(both.modelId).toBe("oss-style-qwen-edit");
    expect(both.request.prompt).toMatch(/Color palette/);
  });
});

describe("Soul presets fallback", () => {
  it("maps the researched list per source with Higgsfield's categories", () => {
    const v1 = presetFallback("soul-v1")!;
    expect(v1.items).toHaveLength(106);
    expect(v1.categories).toEqual(["New", "TikTok Core", "Instagram Aesthetics", "Camera Presets", "Beauty", "Mood", "Surreal", "Graphic Art"]);
    const tabs = presetTabs(v1.items, v1.categories);
    expect(tabs[0]).toBe("All");
    expect(v1.items.filter((p) => inTab(p, "Graphic Art")).map((p) => p.name)).toContain("Glitch");
    expect(v1.items.filter((p) => inTab(p, "New"))).toHaveLength(10);
    expect(v1.items.find((p) => p.id === SOUL_DEFAULT["soul-v1"])?.name).toBe("General");
    const v2 = presetFallback("soul-v2")!;
    expect(v2.items).toHaveLength(33);
    expect(v2.categories).toEqual(["Mood", "Styles", "Camera"]);
    expect(v2.items.every((p) => p.hue >= 0 && p.hue < 360)).toBe(true);
    expect(presetFallback("genjutsu-restyle")).toBeNull();
    expect(new Set(SOUL_PRESETS.map((p) => p.id)).size).toBe(SOUL_PRESETS.length);
  });

  it("turns a preset into a prompt template for the open route", () => {
    expect(presetPrompt({ name: "Retro BW", description: "Grainy black-and-white film portrait" }, "a dancer ")).toBe("a dancer. In the style of “Retro BW”: grainy black-and-white film portrait.");
    expect(presetPrompt({ name: "Retro BW", description: "" }, "")).toBe("A photo. In the style of “Retro BW”.");
  });
});

describe("Photodump packs and planning", () => {
  const maya: PhotoSubject = { kind: "element", handle: "Maya", name: "Maya", references: ["/api/files/uploads/m1.png", "/api/files/uploads/m2.png"], loras: [] };
  const selfie: PhotoSubject = { kind: "selfie", url: "/api/files/uploads/me.jpg" };

  it("has exactly as many photo prompts as Higgsfield's packs have photos", () => {
    expect(PACKS).toHaveLength(14);
    for (const p of PACKS) {
      expect(p.shots, p.name).toHaveLength(p.count);
      expect(new Set(p.shots).size, p.name).toBe(p.count);
    }
    expect(PHOTODUMP_PACKS.filter((p) => p.product === "instadump").map((p) => [p.name, p.count])).toEqual([
      ["Winter special", 9],
      ["Aura farming", 14],
      ["Looksmaxing", 15],
      ["2000s nostalgia", 15],
      ["Editorial shots", 15],
    ]);
  });

  it("builds per-photo prompts: @mention for a character, image 1 for a selfie, the reference photo in user packs", () => {
    const pack = getPack("zen")!;
    expect(shotPrompt(pack, pack.shots[0], maya)).toMatch(/^A photo of @Maya, seated cross-legged/);
    expect(shotPrompt(pack, pack.shots[0], selfie)).toMatch(/^A photo of the person in image 1, .*Keep their exact face/);
    const mine = customPack({ id: "user-1", name: "Mine", refs: ["/api/files/uploads/a.png", "/api/files/uploads/b.png"] });
    expect(mine.count).toBe(2);
    expect(shotPrompt(mine, mine.shots[0], selfie, 2)).toMatch(/^The person in image 1 recreated in image 2: .*Replace the person in image 2/);
  });

  it("plans one single-image request per photo, on the identity's own model when it has one", () => {
    const pack = getPack("winter-special")!;
    const cloud = planPhotodump({ pack, subject: maya, engine: "cloud", aspectRatio: "3:4" }, { higgsfield: false });
    expect(cloud.modelId).toBe("nano-banana-pro");
    expect(cloud.requests).toHaveLength(9);
    expect(cloud.requests[2].step).toEqual({ label: "Photo 3 of 9", index: 2, of: 9 });
    expect(cloud.requests.every((r) => r.params?.numOutputs === 1 && r.params.aspectRatio === "3:4" && r.feature === "photodump")).toBe(true);

    const soulMaya: PhotoSubject = { ...maya, loras: [{ engine: "cloud", modelId: "soul-2", file: "", trigger: "", referenceId: "ref-123" }] };
    expect(planPhotodump({ pack, subject: soulMaya, engine: "cloud" }, { higgsfield: true }).modelId).toBe("soul-2");
    const noKey = planPhotodump({ pack, subject: soulMaya, engine: "cloud", modelId: "soul-2" }, { higgsfield: false });
    expect(noKey.modelId).toBe("nano-banana-pro");
    expect(noKey.notes[0]).toMatch(/Higgsfield key/);
    expect(planPhotodump({ pack, subject: maya, engine: "cloud", modelId: "seedream-5-pro" }, { higgsfield: false }).modelId).toBe("seedream-5-pro");

    const loraMaya: PhotoSubject = { ...maya, loras: [{ engine: "open", modelId: "oss-z-image-turbo", file: "maya.safetensors", trigger: "mayfz" }] };
    expect(planPhotodump({ pack, subject: loraMaya, engine: "open" }, { higgsfield: false }).modelId).toBe("oss-z-image-turbo");
    const qwen = planPhotodump({ pack, subject: selfie, engine: "open", aspectRatio: "auto" }, { higgsfield: false });
    expect(qwen.modelId).toBe("oss-qwen-edit");
    expect(qwen.requests[0].inputs?.images).toEqual([selfie.url]);
    expect(qwen.requests[0].params?.aspectRatio).toBeUndefined();

    const mine = customPack({ id: "user-1", name: "Mine", refs: ["/api/files/uploads/a.png", "/api/files/uploads/b.png"] });
    const custom = planPhotodump({ pack: mine, subject: selfie, engine: "cloud" }, { higgsfield: true });
    expect(custom.requests.map((r) => r.inputs?.images)).toEqual([
      [selfie.url, "/api/files/uploads/a.png"],
      [selfie.url, "/api/files/uploads/b.png"],
    ]);
    expect(() => planPhotodump({ pack, subject: { ...maya, references: [] }, engine: "cloud" }, { higgsfield: false })).toThrow(/Add a photo of Maya/);
  });

  it("each planned photo resolves and plans (mentions become references, LoRAs or a Soul ID)", () => {
    const el = (loras: StudioElement["loras"]): StudioElement => ({ id: "e1", name: "Maya", handle: "Maya", kind: "character", description: null, references: ["/api/files/uploads/m1.png"], loras, status: "ready", createdAt: 0 });
    const check = (subject: PhotoSubject, engine: "cloud" | "open", element: StudioElement) => {
      const p = planPhotodump({ pack: getPack("zen")!, subject, engine, aspectRatio: "3:4" }, { higgsfield: true });
      const r = p.requests[0];
      const resolved = applyMentions(r, getModel(r.modelId)!, [element]).request;
      return { resolved, plan: plan(resolved) };
    };
    const refs = check(maya, "cloud", el([]));
    expect(refs.plan.op).toBe("edit");
    expect(refs.resolved.inputs?.images).toEqual(["/api/files/uploads/m1.png"]);
    const soulLoras = [{ engine: "cloud" as const, modelId: "soul-2", file: "", trigger: "", referenceId: "ref-1" }];
    const soul = check({ ...maya, loras: soulLoras }, "cloud", el(soulLoras));
    expect(soul.resolved.params?.extra?.custom_reference_id).toBe("ref-1");
    expect(soul.plan.model.id).toBe("soul-2");
    const turbo = [{ engine: "open" as const, modelId: "oss-z-image-turbo", file: "maya.safetensors", trigger: "mayfz" }];
    const lora = check({ ...maya, loras: turbo }, "open", el(turbo));
    expect(lora.plan.loras[0].file).toBe("maya.safetensors");
    expect(lora.plan.prompt).toMatch(/mayfz Maya/);
  });
});

describe("Fashion Factory", () => {
  const maya = { kind: "element" as const, handle: "Maya", name: "Maya", references: ["/api/files/uploads/m1.png"], loras: [] };

  it("has the six templates with one photoset prompt per preview shot", () => {
    expect(FASHION.map((t) => t.name)).toEqual(["Ultra bold", "Blue-Green Gradient", "Street style Paparazzi", "View from the top", "Light blue studio", "Red room"]);
    for (const t of FASHION) expect(t.photoset, t.name).toHaveLength(t.shots);
  });

  it("plans the three generating steps on both engines", () => {
    const t = FASHION[0];
    const base = fashionBaseRequest(t, maya, "cloud", { higgsfield: false });
    expect(base).toMatchObject({ modelId: "nano-banana-pro", params: { aspectRatio: "3:4", numOutputs: 4 } });
    expect(base.prompt).toMatch(/@Maya in a bold, saturated colour-blocked studio set/);
    expect(fashionBaseRequest(t, maya, "open", { higgsfield: false }).modelId).toBe("oss-qwen-edit");

    const outfit = fashionOutfitRequest(t, "/api/files/base.png", "/api/files/shirt.png", "cloud");
    expect(outfit).toMatchObject({ modelId: "fashn-tryon", op: "edit", inputs: { images: ["/api/files/base.png", "/api/files/shirt.png"] } });
    expect(plan(outfit).op).toBe("edit");
    expect(fashionOutfitRequest(t, "b", "g", "cloud", "nano-banana-pro").prompt).toMatch(/Dress the person in image 1/);
    const openOutfit = fashionOutfitRequest(t, "/api/files/base.png", "/api/files/shirt.png", "open");
    expect(openOutfit.modelId).toBe("oss-tryon-klein");
    expect(() => plan(openOutfit)).not.toThrow();

    const set = fashionPhotosetRequests(t, "/api/files/dressed.png", "cloud");
    expect(set).toHaveLength(t.shots);
    expect(set[0]).toMatchObject({ modelId: "nano-banana-pro", inputs: { images: ["/api/files/dressed.png"] }, step: { label: `Photoset 1 of ${t.shots}` } });
    expect(fashionPhotosetRequests(t, "/api/files/dressed.png", "open")[0].modelId).toBe("oss-qwen-edit");
  });

  it("walks the wizard with Higgsfield's validation messages", () => {
    let s: FashionState = FASHION_START;
    expect(fashionBlocker(s)).toBe("Template required");
    expect(fashionReducer(s, { type: "next" })).toBe(s);
    s = fashionReducer(s, { type: "template", id: "red-room" });
    s = fashionReducer(s, { type: "next" });
    expect(s.step).toBe("character");
    expect(fashionBlocker(s)).toMatch(/character/);
    s = fashionReducer(s, { type: "element", id: "el1" });
    s = fashionReducer(s, { type: "baseStarted", ids: ["g1", "g2"] });
    expect(s.step).toBe("generation");
    expect(fashionBlocker(s)).toBe("Select an image at the generation step");
    s = fashionReducer(s, { type: "pickBase", url: "/api/files/b.png" });
    s = fashionReducer(s, { type: "next" });
    expect(s.step).toBe("clothing");
    expect(fashionBlocker(s, "outfit")).toBe("No product to generate");
    s = fashionReducer(s, { type: "garment", garment: { url: "", uploading: true } });
    expect(fashionBlocker(s, "outfit")).toBe("Please wait for the image to finish processing before generating");
    s = fashionReducer(s, { type: "garment", garment: { url: "/api/files/g.png", uploading: false } });
    expect(fashionBlocker(s, "outfit")).toBeNull();
    expect(fashionBlocker(s)).toBe("Select an image at the clothing step");
    s = fashionReducer(s, { type: "outfitStarted", ids: ["o1"] });
    s = fashionReducer(s, { type: "pickOutfit", url: "/api/files/o.png" });
    s = fashionReducer(s, { type: "photosetStarted", batchId: "b1" });
    expect(s.step).toBe("photoset");
    // Back to an earlier step keeps the picks; a new template starts over (but keeps the character).
    expect(fashionReducer(s, { type: "goto", step: "template" }).outfit).toBe("/api/files/o.png");
    const fresh = fashionReducer(s, { type: "template", id: "ultra-bold" });
    expect(fresh).toMatchObject({ step: "template", templateId: "ultra-bold", elementId: "el1", baseIds: [] });
    expect(fresh.outfit).toBeUndefined();
    // Jumping ahead stops at the first step that isn't done.
    expect(fashionReducer({ ...FASHION_START, templateId: "red-room" }, { type: "goto", step: "photoset" }).step).toBe("character");
    expect(fashionReducer(s, { type: "reset" })).toBe(FASHION_START);
  });
});

describe("Character Sheet", () => {
  it("From Reference takes 1–5 photos (3 on the open route)", () => {
    const imgs = Array.from({ length: 5 }, (_, i) => `/api/files/uploads/p${i}.png`);
    expect(() => sheetFromReference([], "cloud")).toThrow("Upload at least 1 image");
    expect(() => sheetFromReference([...imgs, "x"], "cloud")).toThrow("Maximum 5 images");
    const cloud = sheetFromReference(imgs, "cloud", "freckles");
    expect(cloud.request).toMatchObject({ modelId: "nano-banana-pro", op: "edit", inputs: { images: imgs } });
    expect(cloud.request.prompt).toMatch(/turnaround sheet.*freckles\.$/);
    const open = sheetFromReference(imgs, "open");
    expect(open.request.inputs?.images).toHaveLength(3);
    expect(open.notes[0]).toMatch(/first 3/);
    expect(() => plan(open.request)).not.toThrow();
  });

  it("Build from scratch runs on Soul 2.0 / Nano Banana Pro or the Soul Cast sheet workflow", () => {
    expect(castSheetModel("cloud", { higgsfield: true })).toBe("soul-2");
    expect(castSheetModel("cloud", { higgsfield: false })).toBe("nano-banana-pro");
    expect(castSheetModel("open", { higgsfield: false, has: () => true })).toBe("oss-zimage-soul-cast");
    expect(castSheetModel("open", { higgsfield: false, has: () => false })).toBe("oss-z-image-turbo");
  });

  it("randomizes and names a cast like Cinema Studio", () => {
    const fields = SOUL_CAST_FIELDS.map((f) => ({ key: f.key, label: f.label, tab: f.tab, kind: f.kind, options: f.options }));
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(randomCast(fields, { budget: 250 }, rng(seed))).toEqual(randomizeCast({ budget: 250 }, rng(seed)));
    }
    for (const v of [{ archetype: "Rebel", age: 30 }, { archetype: "Sage" }, { genre: "Western" }, {}]) expect(castNameFor(v)).toBe(castName(v));
  });

  it("hides the same Soul Cast fields as Cinema Studio", () => {
    const cases = [{ gender: "Female" }, { gender: "Male" }, { gender: "Male", facial_hair: "Beard" }, { gender: "Male", facial_hair: "Clean-shaven" }, {}];
    for (const v of cases) for (const f of SOUL_CAST_FIELDS) expect(castFieldVisible(f.key, v), `${f.key} ${JSON.stringify(v)}`).toBe(f.when ? f.when(v) : true);
  });
});

describe("moodboard logic", () => {
  it("uses Higgsfield's limits and copy", () => {
    const five = Array.from({ length: 5 }, (_, i) => `i${i}`);
    expect(moodboardError({ name: "x", images: five.slice(0, 4) })).toBe("Upload at least 5 photos to continue.");
    expect(moodboardError({ name: "x", images: Array(81).fill("i") })).toBe("Maximum images per moodboard is 80");
    expect(moodboardError({ name: " ", images: five })).toBe("Please enter a moodboard name");
    expect(moodboardError({ name: "x".repeat(101), images: five })).toBe("Name is too long, maximum 100 characters allowed");
    expect(moodboardError({ name: "Ok", images: five })).toBeNull();
    expect(imageProblem({ width: 255, height: 900, key: "a" }, [])).toBe("Image dimensions too small: minimum size is 256x256px.");
    expect(imageProblem({ width: 300, height: 300, key: "a" }, ["a"])).toBe("This image is already added");
    expect(imageProblem({ width: 256, height: 256, key: "b" }, ["a"])).toBeNull();
  });

  it("follows the cover job: In queue → In progress → Preparing cover → Complete / Failed", () => {
    expect(moodboardStatus({ status: "queued", progress: null, error: null }).status).toBe("queued");
    expect(moodboardStatus({ status: "running", progress: 0.2, error: null }).status).toBe("running");
    expect(moodboardStatus({ status: "running", progress: 0.7, error: null }).status).toBe("cover");
    expect(moodboardStatus({ status: "succeeded", progress: 1, error: null }).status).toBe("complete");
    expect(moodboardStatus({ status: "failed", progress: null, error: "boom" })).toEqual({ status: "failed", error: "boom" });
    expect(moodboardStatus(null).status).toBe("failed");
  });

  it("orders images so the first ones cover the board's range, and groups collages of 4", () => {
    const red = colorFeature(fill([220, 20, 20], 50));
    const blue = colorFeature(fill([20, 20, 220], 50));
    const order = representativeOrder([red, red, red, blue, red]);
    // The typical (red) one first, then the outlier that represents the rest, not another red.
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(3);
    expect(order).toHaveLength(5);
    expect(collageGroups([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(collageGroups([1, 2, 3, 4, 5, 6])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 3, 4],
    ]);
    expect(coverCrop(200, 100, 50, 50)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 });
  });
});
