import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  APERTURES,
  CAMERA_BODIES,
  CAMERA_MOVES,
  EMOTION_FAMILIES,
  ERAS,
  GENRES,
  LENSES,
  LIGHTING_PRESETS,
  LIGHT_DIRECTIONS,
  PALETTES,
  SOUL_CAST_FIELDS,
  TEMPOS,
  applyEmotions,
  castPrompt,
  checkReferences,
  compileDirector,
  gridPrompt,
  openCameraRoute,
  planCinema,
  randomizeCast,
  rigError,
  visibleCast,
  type CinemaGenerateInput,
  type DirectorSettings,
} from "@/lib/catalog/cinema";
import { buildPayload } from "@/lib/catalog/payload";
import { HARMONIES, harmonyPalette, hexToRgb, kmeans, paletteFromPixels, rgbToHsl, type RGB } from "@/components/cinema/color-math";
import { equalSpans, findCuts, lineStats, tileRects } from "@/components/cinema/grid-math";

const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/higgsfield-studios.json"), "utf8")).cinemaStudio;
const imageResearch = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/higgsfield-image-studios.json"), "utf8"));
const dp = research.directorsPanel;

describe("Cinema Studio data matches the research", () => {
  it("film setup, camera and lighting options", () => {
    const strip = (xs: { name: string; apiSlug?: string | null }[]) => xs.map((x) => [x.name, x.apiSlug ?? null]);
    expect(GENRES.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.genre));
    expect(ERAS.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.era));
    expect(TEMPOS.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.tempo));
    expect(CAMERA_BODIES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.camera));
    expect(LENSES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.lens));
    expect(APERTURES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.aperture));
    expect(LIGHTING_PRESETS.map((g) => [g.name, g.slug])).toEqual(strip(dp.lighting.presets));
    expect(GENRES[1].description).toBe(dp.filmSetup.genre[1].description);
  });

  it("all 33 camera moves, 50 palettes with 12 hex colours each, and the Emotion Wheel fragments", () => {
    expect(CAMERA_MOVES).toHaveLength(33);
    expect(CAMERA_MOVES.map((m) => m.slug)).toEqual(dp.camera.movements.map((m: { apiSlug: string }) => m.apiSlug));
    expect(PALETTES).toHaveLength(50);
    expect(PALETTES.map((p) => [p.slug, p.hex])).toEqual(dp.colorPalette.presets.map((p: { apiSlug: string; hexColors: string[] }) => [p.apiSlug, p.hexColors]));
    expect(PALETTES.every((p) => p.hex.length === 12)).toBe(true);
    expect(EMOTION_FAMILIES).toHaveLength(8);
    expect(EMOTION_FAMILIES.flatMap((f) => f.steps.map((s) => s.prompt))).toEqual(
      dp.emotionWheel.families.flatMap((f: { steps: { prompt: string }[] }) => f.steps.map((s) => s.prompt)),
    );
    expect(LIGHT_DIRECTIONS).toHaveLength(26);
    expect(new Set(LIGHT_DIRECTIONS).size).toBe(26);
    expect(LIGHT_DIRECTIONS).toContain("back-bottom-left");
  });

  it("every native value is one cinema-studio-4 accepts", () => {
    const cs4 = getModel("cinema-studio-4")!;
    const values = (param: string) => cs4.options.controls!.find((c) => c.param === param)!.values;
    expect(values("genre")).toEqual(expect.arrayContaining(GENRES.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("era")).toEqual(expect.arrayContaining(ERAS.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("pacing")).toEqual(expect.arrayContaining(TEMPOS.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("camera_model")).toEqual(expect.arrayContaining(CAMERA_BODIES.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("camera_lens")).toEqual(expect.arrayContaining(LENSES.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("camera_aperture")).toEqual(expect.arrayContaining(APERTURES.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("light")).toEqual(expect.arrayContaining(LIGHTING_PRESETS.flatMap((g) => (g.slug ? [g.slug] : []))));
    expect(values("camera_movement")).toEqual(CAMERA_MOVES.map((m) => m.slug));
    expect(values("color_palette")).toEqual(PALETTES.map((p) => p.slug));
  });

  it("the 17 Soul Cast fields with their options and defaults", () => {
    expect(SOUL_CAST_FIELDS).toHaveLength(17);
    const f = imageResearch.characterSheet.soulCast.fields as Record<string, (string | number)[]>;
    const byKey = Object.fromEntries(SOUL_CAST_FIELDS.map((x) => [x.key, x]));
    for (const [k, opts] of Object.entries(f)) {
      const key = k === "budget_millions" ? "budget" : k;
      expect(byKey[key], key).toBeDefined();
      expect(byKey[key].options.map((o) => String(o).toLowerCase()), key).toEqual(opts.map((o) => String(o).toLowerCase()));
    }
    expect(byKey.budget.default).toBe(250);
    expect(byKey.era.default).toBe(2020);
  });
});

const NOIR: DirectorSettings = {
  genre: "noir",
  era: "1980s",
  tempo: "calm",
  camera: "35mm-film",
  lens: "anamorphic",
  focal: "50mm",
  aperture: "f14-wide-open",
  lighting: { kind: "preset", slug: "window" },
  palette: { kind: "preset", slug: "neon-rain-at-midnight" },
  emotions: { maya: { family: "Sadness", step: 1 } },
};

describe("compileDirector", () => {
  it("sends Cinema Studio 4.0 its own fields and writes only the rest into the prompt", () => {
    const c = compileDirector({ prompt: "@maya waits at the bus stop in the rain", settings: NOIR, moves: ["dolly-in", "whip-pan"], brief: "A quiet neo-noir about loss.", mode: "video", target: "native" });
    expect(c.extra).toEqual({
      genre: "noir",
      era: "1980s",
      pacing: "calm",
      camera_model: "35mm-film",
      camera_lens: "anamorphic",
      camera_aperture: "f14-wide-open",
      camera_movement: "dolly-in",
      light: "window",
      color_palette: "neon-rain-at-midnight",
    });
    expect(c.prompt.startsWith("Project brief: A quiet neo-noir about loss. @maya (with sad emotion) waits at the bus stop in the rain.")).toBe(true);
    // Focal length has no API field; the second move goes into words, in order.
    expect(c.prompt).toContain("50mm focal length");
    expect(c.prompt).toMatch(/first .*dolly in.*finally .*whip pan/i);
    expect(c.prompt).not.toMatch(/noir film|1980s|anamorphic|window|#0c0c0e/i);
  });

  it("compiles everything into words for other models, Auto fields left out", () => {
    const c = compileDirector({ prompt: "@maya waits at the bus stop", settings: NOIR, moves: ["dolly-in"], mode: "video", target: "prompt" });
    expect(c.extra).toEqual({});
    expect(c.prompt).toContain("Noir film: hard shadow and high contrast");
    expect(c.prompt).toContain("Set in the 1980s");
    expect(c.prompt).toContain("Montage pacing: calm");
    expect(c.prompt).toMatch(/Shot on 35mm Film .*anamorphic lens.*50mm focal length.*f\/1\.4 aperture/);
    expect(c.prompt).toContain("Camera: the camera performs a smooth, steady dolly in");
    expect(c.prompt).toContain("Lighting: window");
    expect(c.prompt).toContain('"Neon Rain at Midnight" palette #0c0c0e, #334d4e');
    const bare = compileDirector({ prompt: "A lighthouse at dawn", settings: {}, mode: "video", target: "prompt" });
    expect(bare.prompt).toBe("A lighthouse at dawn.");
  });

  it("stills skip tempo and moves; custom palettes and light rigs are always words", () => {
    const c = compileDirector({
      prompt: "a diner at night",
      settings: { ...NOIR, palette: { kind: "custom", name: "Mine", hex: ["#101010", "#ff8800"] }, lighting: { kind: "custom", lights: [{ direction: "front-top-left", color: "#ffaa55", brightness: 80, diffuse: 70 }] } },
      moves: ["whip-pan"],
      mode: "image",
      target: "native",
    });
    expect(c.extra.pacing).toBeUndefined();
    expect(c.extra.camera_movement).toBeUndefined();
    expect(c.extra.color_palette).toBeUndefined();
    expect(c.extra.light).toBeUndefined();
    expect(c.prompt).toContain("palette #101010, #ff8800");
    expect(c.prompt).toContain("key light from the front top left");
    expect(c.prompt).toContain("80% brightness, soft and diffuse");
  });

  it("puts the emotion fragment after the first mention only, once", () => {
    const e = { kai: { family: "Anger", step: 2 } };
    expect(applyEmotions("@Kai turns. @kai shouts", e)).toBe("@Kai (with extremely enraged emotions loudly) turns. @kai shouts");
    expect(applyEmotions("@Kai (with extremely enraged emotions loudly) turns", e)).toBe("@Kai (with extremely enraged emotions loudly) turns");
    expect(applyEmotions("@kaiser turns", e)).toBe("@kaiser turns");
  });

  it("validates the custom rig and references with Higgsfield's messages", () => {
    const l = { direction: "front", color: "#ffffff", brightness: 50, diffuse: 50 };
    expect(rigError([l, l, l])).toBe("A custom rig supports at most 2 light sources");
    expect(rigError([{ ...l, color: "white" }])).toBe("color must be a #RRGGBB hex value");
    expect(rigError([{ ...l, brightness: 101 }])).toBe("brightness must be an integer between 0 and 100");
    expect(rigError([l])).toBeNull();
    expect(checkReferences({ images: 31, videos: [], audios: [], elements: 0 })).toBe("You can add a maximum of 30 images");
    expect(checkReferences({ images: 2, videos: [12, 20], audios: [], elements: 0 })).toBe("The total video duration limit is 30 seconds");
    expect(checkReferences({ images: 2, videos: [1], audios: [], elements: 0 })).toMatch(/at least 2 seconds/);
    expect(checkReferences({ images: 30, videos: [5, 5, 5], audios: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], elements: 8 })).toMatch(/50 input media/);
    expect(checkReferences({ images: 3, videos: [5], audios: [3], elements: 2 })).toBeNull();
  });
});

const base = (over: Partial<CinemaGenerateInput>): CinemaGenerateInput => ({
  engine: "cloud",
  mode: "video",
  action: "generate",
  prompt: "@maya waits at the bus stop in the rain",
  settings: NOIR,
  moves: ["dolly-in", "whip-pan"],
  duration: 10,
  resolution: "1080p",
  aspectRatio: "21:9",
  batch: 2,
  ...over,
});

describe("planCinema", () => {
  it("runs Cinema Studio 4.0 natively with a Higgsfield key, fitted to what the API takes", () => {
    const plan = planCinema(base({}), { higgsfield: true });
    expect(plan.model.id).toBe("cinema-studio-4");
    expect(plan.blocker).toBeUndefined();
    const req = plan.steps[0].request;
    expect(req.params).toMatchObject({ aspectRatio: "21:9", resolution: "720p", duration: 10, numOutputs: 2, generateAudio: true });
    expect(req.params!.extra).toMatchObject({ genre: "noir", camera_movement: "dolly-in", color_palette: "neon-rain-at-midnight" });
    expect(plan.notes.join(" ")).toMatch(/up to 720p/);
    // 2 takes × 10 s × $0.4623.
    expect(plan.costUsd).toBeCloseTo(9.246, 2);
    // The payload Higgsfield receives.
    const route = getModel("cinema-studio-4")!.routes.find((r) => r.op === "t2v")!;
    const payload = buildPayload(route.map!, { ...req.params, prompt: req.prompt });
    expect(payload).toMatchObject({ aspect_ratio: "21:9", resolution: "720p", duration: 10, genre: "noir", era: "1980s", pacing: "calm", light: "window", camera_movement: "dolly-in" });
  });

  it("falls back to Seedance 2.5 with the Director in the prompt without a Higgsfield key", () => {
    const plan = planCinema(base({ modelId: "cinema-studio-4" }), { higgsfield: false });
    expect(plan.model.id).toBe("seedance-2-5");
    expect(plan.notes[0]).toMatch(/needs a Higgsfield key/);
    const req = plan.steps[0].request;
    expect(req.params!.extra).toBeUndefined();
    expect(req.prompt).toContain("Noir film");
    expect(req.params!.duration).toBe(10);
    // Kling 3.0 and Veo 3.1 fit the duration to what they make.
    expect(planCinema(base({ modelId: "kling-3", duration: 30 }), { higgsfield: false }).steps[0].request.params!.duration).toBe(15);
    expect(planCinema(base({ modelId: "veo-3-1", duration: 30 }), { higgsfield: false }).steps[0].request.params!.duration).toBe(8);
  });

  it("open engine: Wan 2.2 Lightning, camera LoRA or Fun Camera, then a palette lock per take", () => {
    const plan = planCinema(base({ engine: "open", moves: ["arc-left"], images: ["/api/files/a.png", "/api/files/b.png"] }), { higgsfield: false });
    expect(plan.model.id).toBe("oss-wan22-14b-fast");
    expect(plan.steps[0].request.loras?.length).toBeGreaterThan(0);
    expect(plan.steps[0].request.prompt).toMatch(/^orbit 360\. /);
    expect(plan.steps[0].request.inputs).toEqual({ images: ["/api/files/a.png"] });
    // Without a start frame the move is camera language in the prompt.
    const t2v = planCinema(base({ engine: "open", moves: ["arc-left"] }), { higgsfield: false });
    expect(t2v.steps[0].request.loras).toBeUndefined();
    expect(t2v.notes.join(" ")).toMatch(/add a start frame/);
    expect(plan.steps[0].request.params!.duration).toBe(5);
    expect(plan.steps[1]).toMatchObject({ key: "palette", perJobOf: "main", after: ["main"] });
    expect(plan.steps[1].request).toMatchObject({ modelId: "oss-palette-video", op: "color-match", chain: [{ slot: "video" }] });
    expect(plan.steps[1].swatch).toEqual(PALETTES.find((p) => p.slug === "neon-rain-at-midnight")!.hex);
    expect(plan.costUsd).toBe(0);

    // A Fun Camera pose needs a start frame; without one the move goes into the prompt.
    expect(openCameraRoute("pan-left", true)).toMatchObject({ via: "fun-camera", pose: "Pan Left" });
    const withFrame = planCinema(base({ engine: "open", moves: ["pan-left"], images: ["/api/files/a.png"], settings: {} }), { higgsfield: false });
    expect(withFrame.model.id).toBe("oss-wan22-fun-camera");
    expect(withFrame.steps[0].request.params!.extra).toMatchObject({ cameraMotion: "Pan Left" });
    expect(withFrame.steps).toHaveLength(1);
    const noLock = planCinema(base({ engine: "open", settings: { ...NOIR, paletteLock: false } }), { higgsfield: false });
    expect(noLock.steps).toHaveLength(1);
  });

  it("multi-shot: Auto on Seedance, Manual into one prompt on Cinema Studio 4.0", () => {
    const auto = planCinema(base({ multiShot: { mode: "auto" } }), { higgsfield: false });
    expect(auto.steps[0].request.params!.multiShot).toBe("auto");
    const manual = planCinema(
      base({ multiShot: { mode: "manual", shots: [{ prompt: "wide of the street", duration: 4 }, { prompt: "close on @maya", duration: 6 }] } }),
      { higgsfield: true },
    );
    expect(manual.steps[0].request.prompt).toMatch(/Shot 1 \[0-4s\]: wide of the street\. Shot 2 \[4-10s\]: close on @maya/);
    expect(manual.steps[0].request.params!.duration).toBe(10);
  });

  it("image mode: stills need the camera; grids are one contact sheet", () => {
    const blocked = planCinema(base({ mode: "image", settings: { genre: "noir" } }), { higgsfield: false });
    expect(blocked.blocker).toMatch(/Camera settings are required/);
    const still = planCinema(base({ mode: "image", resolution: undefined }), { higgsfield: false });
    expect(still.blocker).toBeUndefined();
    expect(still.model.id).toBe("nano-banana-pro");
    expect(still.steps[0].request).toMatchObject({ feature: "cinema-image", params: { aspectRatio: "21:9", resolution: "1K", numOutputs: 2 } });
    const grid = planCinema(base({ mode: "image", action: "grid", grid: { size: "3x3", type: "zooms" } }), { higgsfield: false });
    expect(grid.steps[0].request.params!.numOutputs).toBe(1);
    expect(grid.steps[0].request.prompt).toMatch(/3×3 grid of 9 equally sized film stills/);
    expect(grid.steps[0].request.prompt).toMatch(/extreme wide shot/);
    expect(gridPrompt("x", "4x4", "next_shots")).toMatch(/4×4 grid of 16/);
  });

  it("extend forward / backward and edit on a selected take", () => {
    const source = { url: "/api/files/take.mp4", kind: "video" as const };
    const fwd = planCinema(base({ action: "extend-forward", source }), { higgsfield: true });
    expect(fwd.model.id).toBe("seedance-2-5");
    expect(fwd.steps[0].request).toMatchObject({ op: "extend", inputs: { video: source.url } });
    expect(planCinema(base({ engine: "open", action: "extend-forward", source }), { higgsfield: false }).model.id).toBe("oss-wan22-vace-extend");

    const back = planCinema(base({ action: "extend-backward", source }), { higgsfield: false });
    expect(back.steps.map((s) => s.key)).toEqual(["frame", "before", "main"]);
    expect(back.steps[0].request).toMatchObject({ modelId: "extract-frame", params: { extra: { frame_type: "first" } } });
    expect(back.steps[2]).toMatchObject({ after: ["before", "frame"], request: { op: "flf2v", chain: [{ slot: "images", position: "first" }, { slot: "endImage" }] } });
    const backOpen = planCinema(base({ engine: "open", action: "extend-backward", source: { ...source, firstFrame: "/api/files/f.png" } }), { higgsfield: false });
    expect(backOpen.steps.map((s) => s.request.modelId)).toEqual(["oss-qwen-edit", "oss-wan22-14b-fast"]);
    expect(backOpen.steps[1].request.inputs).toEqual({ endImage: "/api/files/f.png" });

    expect(planCinema(base({ action: "edit", source, prompt: "make it snow" }), { higgsfield: false }).steps[0].request).toMatchObject({ modelId: "kling-o3", op: "v2v" });
    expect(planCinema(base({ action: "edit", source, prompt: "make it snow" }), { higgsfield: true }).steps[0].request.modelId).toBe("seedance-2-5");
    expect(planCinema(base({ action: "edit", source: undefined }), { higgsfield: false }).blocker).toBe("Select a video take to edit");
  });

  it("Soul Cast and Soul Location prompts", () => {
    const values = { genre: "Western", budget: 150, era: 1880, archetype: "Rebel", gender: "Female", race: "Latino", age: 35, facial_hair: "Beard", imperfections: ["Freckles", "Facial scar"], outfit: "Workwear" };
    expect(visibleCast(values).facial_hair).toBeUndefined();
    const p = castPrompt(values);
    expect(p).toMatch(/western film with a \$150M budget/);
    expect(p).toMatch(/35-year-old latino woman, the rebel archetype/);
    expect(p).toMatch(/freckles, facial scar/);
    expect(p).toMatch(/Full-body front view, three-quarter view, side profile and back view/);
    const r = randomizeCast({}, () => 0.5);
    expect(Object.keys(r).sort()).toEqual(["age", "archetype", "era", "gender", "genre", "race"]);
    const cast = planCinema(base({ action: "cast", mode: "image", cast: values, prompt: "" }), { higgsfield: false });
    expect(cast.blocker).toBeUndefined();
    expect(cast.steps[0].request).toMatchObject({ feature: "cinema-cast", modelId: "nano-banana-pro", params: { aspectRatio: "16:9" } });
    expect(planCinema(base({ action: "cast", mode: "image", cast: values }), { higgsfield: true }).model.id).toBe("soul-2");
    const loc = planCinema(base({ action: "location", mode: "image", prompt: "an abandoned diner on Route 66", brief: "" }), { higgsfield: false });
    expect(loc.steps[0].request.prompt).toMatch(/^Establishing shot of a film location: an abandoned diner on Route 66\. An empty set with no people/);
  });
});

describe("grid crop math", () => {
  /** A white sheet with rows × cols grey noise panels at uneven positions. */
  function sheet(width: number, height: number, xs: [number, number][], ys: [number, number][]) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    let seed = 3;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 160) + 40;
    for (const [y0, y1] of ys)
      for (const [x0, x1] of xs)
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const o = (y * width + x) * 4;
            data[o] = data[o + 1] = data[o + 2] = noise();
          }
    return data;
  }

  it("finds gutters a few pixels off the even split", () => {
    const xs: [number, number][] = [[4, 98], [106, 200], [208, 296]];
    const ys: [number, number][] = [[0, 61], [69, 120], [128, 180]];
    const data = sheet(300, 180, xs, ys);
    const x = lineStats(data, 300, 180, "x");
    const y = lineStats(data, 300, 180, "y");
    expect(findCuts(x, 3)).toEqual(xs);
    expect(findCuts(y, 3)).toEqual(ys);
    const { rects, detected } = tileRects(300, 180, 3, 3, { x, y });
    expect(detected).toBe(true);
    expect(rects).toHaveLength(9);
    expect(rects[4]).toEqual({ x: 106, y: 69, w: 94, h: 51, row: 1, col: 1 });
  });

  it("falls back to an equal split when there are no gutters", () => {
    const data = sheet(200, 100, [[0, 200]], [[0, 100]]);
    const x = lineStats(data, 200, 100, "x");
    expect(findCuts(x, 2)).toBeNull();
    const { rects, detected } = tileRects(200, 100, 2, 2, { x, y: lineStats(data, 200, 100, "y") });
    expect(detected).toBe(false);
    expect(rects.map((r) => [r.x, r.y, r.w, r.h])).toEqual([[0, 0, 100, 50], [100, 0, 100, 50], [0, 50, 100, 50], [100, 50, 100, 50]]);
    expect(equalSpans(10, 3)).toEqual([[0, 3], [3, 7], [7, 10]]);
  });
});

describe("palette editor colour math", () => {
  it("k-means finds the colours of an image, dark to light", () => {
    const px: RGB[] = [];
    for (let i = 0; i < 300; i++) px.push([10 + (i % 5), 12, 14], [200, 40 + (i % 7), 30], [240, 240, 235 - (i % 4)]);
    const c = kmeans(px, 3);
    expect(c).toHaveLength(3);
    expect(c[0].rgb[0]).toBeLessThan(20);
    expect(c[1].rgb[0]).toBeGreaterThan(190);
    expect(c[2].rgb[1]).toBeGreaterThan(230);
    expect(c.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    const pal = paletteFromPixels(px, 4);
    expect(pal).toHaveLength(4);
    expect(pal[3]).toBe(c[1].color);
  });

  it("harmonies place their hues at the research's angles", () => {
    expect(HARMONIES.map((h) => h.name)).toEqual(["Analogous", "Complementary", "Monochromatic", "Split complementary", "Triad", "Square"]);
    const tri = harmonyPalette("#d03030", "triad", 7);
    expect(tri).toHaveLength(7);
    expect(tri[6]).toBe("#d03030");
    const hues = tri.slice(0, 6).map((h) => Math.round(rgbToHsl(hexToRgb(h))[0] / 10) * 10);
    expect(new Set(hues.map((h) => h % 360))).toEqual(new Set([0, 120, 240]));
    const mono = harmonyPalette("#3060d0", "monochromatic", 5).map((h) => Math.round(rgbToHsl(hexToRgb(h))[0]));
    expect(Math.max(...mono) - Math.min(...mono)).toBeLessThan(6);
  });
});
