import { describe, expect, it } from "vitest";
import {
  carriesLayout,
  compileFlux3,
  compileIdeogram,
  compileMoss,
  compileVgl,
  compileWords,
  decodeMoss,
  gridBox,
  layoutCompilerFor,
  locationWords,
  mossBox,
  parseLayout,
  readLayout,
  readsBoxes,
  validateLayout,
  type LayoutBox,
  type LayoutDraft,
  type LayoutItem,
} from "@/lib/layout-prompt";

/** A pixel box [x1, y1, x2, y2] on a width × height canvas as the draft's fractions. */
const px = (b: [number, number, number, number], w: number, h: number): LayoutBox => [b[0] / w, b[1] / h, b[2] / w, b[3] / h];
const draft = (items: LayoutItem[], caption = "A poster.", extra: Partial<LayoutDraft["summary"]> = {}): LayoutDraft => ({
  summary: { caption, meta: [], canvas: "single", ...extra },
  items,
});
const item = (label: LayoutItem["label"], caption: string, box: LayoutBox, more: Partial<LayoutItem> = {}): LayoutItem => ({ label, caption, box, ...more });
const items = (prompt: string) => (JSON.parse(prompt) as { items: { bbox: number[] }[] }).items.map((i) => i.bbox);

// docs/research/new-models-7.md §4.2: re-derived by hand from LinXce's example draft, OpenMOSS's layout.md and LinXce's tests.
describe("compileMoss: MOSS-Image's JSON layout", () => {
  it("places the research's vectors at 1024 × 1024 and 1536 × 1024", () => {
    const square = draft([
      item("text", "Large title.", px([128, 96, 896, 224], 1024, 1024), { text: "EXPLORE" }),
      item("object", "A mountain.", px([128, 288, 896, 640], 1024, 1024)),
      item("text", "Small print.", px([288, 800, 736, 864], 1024, 1024), { text: "2026" }),
    ]);
    expect(items(compileMoss(square, 1024, 1024))).toEqual([
      [-416, -384, -288, 384],
      [-224, -384, 128, 384],
      [288, -224, 352, 224],
    ]);
    const cup = draft([item("object", "A cup.", px([176, 224, 800, 864], 1536, 1024))]);
    expect(items(compileMoss(cup, 1536, 1024))).toEqual([[-288, -592, 352, 32]]);
  });

  it("keeps LinXce's near-integer and fractional edges (tests/test_layout.py)", () => {
    const near = parseLayout({
      width: 1536,
      height: 1024,
      bbox_coord_space: "abs",
      bbox_format: "xyxy",
      summary: { caption: "A poster." },
      items: [{ label: "text", caption: "Large title.", text: "EXPLORE", bbox: [927.9999999999, 271.9999999999, 1408.0000000001, 448.0000000001] }],
    })!;
    expect(near.from).toBe("linxce");
    expect([near.width, near.height]).toEqual([1536, 1024]);
    expect(items(compileMoss(near.draft, 1536, 1024))).toEqual([[-240, 160, -64, 640]]);
    const frac = parseLayout({
      width: 1536,
      height: 1024,
      bbox_coord_space: "abs",
      bbox_format: "xyxy",
      summary: { caption: "A poster." },
      items: [{ label: "object", caption: "A circle.", bbox: [927.9999999, 271.9999999, 1408.0000001, 448.0000001] }],
    })!;
    expect(items(compileMoss(frac.draft, 1536, 1024))).toEqual([[-241, 159, -63, 641]]);
  });

  it("is the trimmed caption alone with no boxes", () => {
    expect(compileMoss(draft([], "  A quiet harbour at dawn.  "), 1024, 1024)).toBe("A quiet harbour at dawn.");
  });

  it("writes keys in MOSS's documented order and leaves the editor colour out", () => {
    const d = draft([item("text", "Neon sign.", [0.1, 0.1, 0.5, 0.3], { text: "OPEN", tags: ["neon"], palette: ["#ff0044"], color: "#00ff00" })], "A bar at night.", {
      meta: ["photo", "night"],
      palette: ["#101010"],
    });
    const s = compileMoss(d, 1024, 1024);
    expect(s).toBe(
      '{"summary":{"meta":["photo","night"],"canvas":"single","caption":"A bar at night.","palette":["#101010"]},' +
        '"items":[{"label":"text","caption":"Neon sign.","text":"OPEN","bbox":[-410,-410,-204,0],"tags":["neon"],"palette":["#ff0044"]}],' +
        '"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}',
    );
    expect(s).not.toContain("color");
    expect(Object.keys(JSON.parse(s))).toEqual(["summary", "items", "bbox_coord_space", "bbox_format"]);
  });

  it("keeps Chinese text as written (no ASCII escapes)", () => {
    const d = draft([item("text", "便利贴上的手写字。", [0.25, 0.25, 0.75, 0.5], { text: "记得买牛奶和鸡蛋！" })], "冰箱和厨房台面。");
    const s = compileMoss(d, 1024, 1024);
    expect(s).toContain("记得买牛奶和鸡蛋！");
    expect(s).toContain("冰箱和厨房台面。");
    expect(s).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it("orders a box drawn from its far corner", () => {
    expect(mossBox([0.75, 0.5, 0.25, 0.25], 1024, 1024)).toEqual(mossBox([0.25, 0.25, 0.75, 0.5], 1024, 1024));
  });
});

describe("decodeMoss", () => {
  const d = draft(
    [item("character", "A girl in a yellow coat.", px([96, 160, 480, 992], 1024, 1024)), item("text", "Title.", px([544, 96, 960, 224], 1024, 1024), { text: "雨天" })],
    "A rainy street.",
    { meta: ["illustration"], canvas: "single" },
  );

  it("decodes the compiled prompt back to the same boxes", () => {
    const back = decodeMoss(compileMoss(d, 1024, 1024), 1024, 1024)!;
    expect(back.summary).toEqual({ caption: "A rainy street.", meta: ["illustration"], canvas: "single" });
    expect(back.items.map((i) => i.box)).toEqual(d.items.map((i) => i.box));
    expect(back.items[1]).toMatchObject({ label: "text", text: "雨天" });
    expect(compileMoss(back, 1024, 1024)).toBe(compileMoss(d, 1024, 1024));
    expect(back.aspect).toBe("1:1");
  });

  it("reads any key order (fal's actual_prompt puts bbox before text)", () => {
    const fal = JSON.stringify({
      bbox_format: "yxyx",
      items: [{ bbox: [-480, -352, -352, 352], text: "SALE", caption: "Red headline.", label: "text" }],
      summary: { caption: "A shop window.", canvas: "single", meta: [] },
      bbox_coord_space: "abs_centralized",
    });
    const back = decodeMoss(fal, 1024, 1024)!;
    expect(back.items).toEqual([{ label: "text", caption: "Red headline.", text: "SALE", box: px([160, 32, 864, 160], 1024, 1024) }]);
    expect(compileMoss(back, 1024, 1024)).toBe(
      '{"summary":{"meta":[],"canvas":"single","caption":"A shop window."},"items":[{"label":"text","caption":"Red headline.","text":"SALE","bbox":[-480,-352,-352,352]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}',
    );
  });

  it("takes plain words as a caption and refuses JSON that isn't a layout", () => {
    expect(decodeMoss("A koi pond at night", 1536, 1024)).toEqual({ summary: { caption: "A koi pond at night", meta: [], canvas: "single" }, items: [], aspect: "3:2" });
    expect(decodeMoss('{"foo": 1}', 1024, 1024)).toBeNull();
  });
});

describe("parseLayout", () => {
  const linxce = {
    width: 1024,
    height: 1024,
    bbox_coord_space: "abs",
    bbox_format: "xyxy",
    summary: { caption: "A poster.", canvas: "single" },
    items: [{ label: "object", caption: "A mountain.", bbox: [128, 288, 896, 640], color: "#3366ff" }],
  };
  const want = [{ label: "object", caption: "A mountain.", box: px([128, 288, 896, 640], 1024, 1024), color: "#3366ff" }];

  it("reads a LinXce draft, with prose around it", () => {
    const p = parseLayout(`Here is the layout I made in ComfyUI:\n${JSON.stringify(linxce)}\nThanks!`)!;
    expect(p.from).toBe("linxce");
    expect(p.draft.items).toEqual(want);
    expect(p.draft.aspect).toBe("1:1");
  });

  it("reads a draft encoded twice, and inside {layout | draft | source} envelopes", () => {
    expect(parseLayout(JSON.stringify(JSON.stringify(linxce)))!.draft.items).toEqual(want);
    expect(parseLayout(JSON.stringify({ layout: JSON.stringify(linxce) }))!.draft.items).toEqual(want);
    expect(parseLayout(JSON.stringify({ draft: linxce }))!.draft.items).toEqual(want);
    expect(parseLayout(JSON.stringify({ source: JSON.stringify({ layout: JSON.stringify(linxce) }) }))!.draft.items).toEqual(want);
    // Past four levels it gives up rather than guess.
    let deep: unknown = linxce;
    for (let i = 0; i < 5; i++) deep = { layout: JSON.stringify(deep) };
    expect(parseLayout(JSON.stringify(deep))).toBeNull();
  });

  it("repairs Stable Diffusion's \\( escapes", () => {
    const raw = `{"summary":{"caption":"A \\(bold\\) poster"},"items":[]}`;
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseLayout(raw)!.draft.summary.caption).toBe("A \\(bold\\) poster");
  });

  it("decodes a compiled prompt on its own size, else the canvas given", () => {
    const compiled = compileMoss(draft([item("object", "A cup.", px([176, 224, 800, 864], 1536, 1024))], "A table."), 1536, 1024);
    const p = parseLayout(compiled, { width: 1536, height: 1024 })!;
    expect(p.from).toBe("compiled");
    expect(p.draft.items[0].box).toEqual(px([176, 224, 800, 864], 1536, 1024));
    expect(p.draft.aspect).toBe("3:2");
  });

  it("reads a compiled prompt without the root's bbox fields as centred, as decodeMoss does", () => {
    const bare = '{"summary":{"caption":"x"},"items":[{"label":"text","caption":"t","text":"HI","bbox":[-416,-384,-288,384]}]}';
    const p = parseLayout(bare)!;
    expect(p.from).toBe("compiled");
    expect(p.draft.items[0].box).toEqual([0.125, 0.09375, 0.875, 0.21875]);
    expect(p.draft.items).toEqual(decodeMoss(bare, 1024, 1024)!.items);
    // No negative edge and no size of its own: still the centre's (only LinXce drafts carry their size).
    const quadrant = parseLayout('{"items":[{"label":"object","caption":"c","bbox":[0,0,256,512]}]}')!;
    expect(quadrant.from).toBe("compiled");
    expect(quadrant.draft.items[0].box).toEqual([0.5, 0.5, 1, 0.75]);
    // A sized draft with top-left boxes and no root fields stays LinXce's.
    const sized = parseLayout({ width: 1024, height: 1024, items: [{ label: "object", caption: "c", bbox: [128, 288, 896, 640] }] })!;
    expect(sized.from).toBe("linxce");
    expect(sized.draft.items[0].box).toEqual(px([128, 288, 896, 640], 1024, 1024));
  });

  it("converts a legacy scene prompt (scene_type / gen_brief / elements / must_not)", () => {
    const scene = {
      scene_type: "Movie poster",
      gen_brief: "a lone astronaut",
      must_not: ["not blurry", "watermarks"],
      palette: ["#000000"],
      elements: [
        { type: "person", identity: "astronaut", shape: "standing", note: "facing left", bbox: [-256, -128, 256, 128] },
        { type: "text", identity: "LOST", bbox: [320, -256, 448, 256] },
        { type: "text", note: "no words given", bbox: [-480, -480, -400, -400] },
      ],
    };
    const p = parseLayout(scene)!;
    expect(p.from).toBe("scene");
    expect(p.draft.summary).toEqual({ caption: "Movie poster. a lone astronaut Avoid: blurry; watermarks", meta: [], canvas: "single", palette: ["#000000"] });
    expect(p.draft.items[0]).toEqual({ label: "character", caption: "astronaut standing facing left", box: [0.375, 0.25, 0.625, 0.75] });
    expect(p.draft.items[1]).toMatchObject({ label: "text", text: "LOST", box: [0.25, 0.8125, 0.75, 0.9375] });
    // A text element with no words becomes an object.
    expect(p.draft.items[2].label).toBe("object");
  });

  it("scales a scene that spills past the canvas to fit it", () => {
    const p = parseLayout({ scene_type: "Wide", elements: [{ type: "obj", identity: "bar", bbox: [-100, -1024, 100, 1024] }] })!;
    const [x0, , x1] = p.draft.items[0].box;
    expect(x0).toBeCloseTo(0);
    expect(x1).toBeCloseTo(1);
  });

  it("reads ComfyUI CreateBoundingBoxes elements (0-1000, yxyx), bare or in prose", () => {
    const elements = [
      { type: "obj", bbox: [100, 200, 600, 800], desc: "a red car", color_palette: ["#FF0000"] },
      { type: "text", bbox: [700, 100, 900, 900], text: "FAST", desc: "chrome letters" },
    ];
    const p = parseLayout(JSON.stringify(elements), { width: 1344, height: 768 })!;
    expect(p.from).toBe("elements");
    expect([p.width, p.height]).toEqual([1344, 768]);
    expect(p.draft.items).toEqual([
      { label: "object", caption: "a red car", box: [0.2, 0.1, 0.8, 0.6], palette: ["#FF0000"] },
      { label: "text", caption: "chrome letters", text: "FAST", box: [0.1, 0.7, 0.9, 0.9] },
    ]);
    expect(parseLayout(`elements: ${JSON.stringify(elements)} (from the node)`)!.draft.items).toHaveLength(2);
  });

  it("reads Fuobe's own draft back (Export, then Import)", () => {
    const d = draft([item("text", "Headline.", [0.1, 0.05, 0.9, 0.2], { text: "30% OFF" })], "A candle sale poster.", { meta: ["flat"], canvas: "collage" });
    const p = parseLayout(JSON.stringify({ ...d, aspect: "4:5" }))!;
    expect(p.from).toBe("fuobe");
    expect(p.draft).toEqual({ ...d, aspect: "4:5" });
    expect(readLayout({ ...d, aspect: "4:5" })).toEqual({ ...d, aspect: "4:5" });
  });

  it("gives null for text with no layout in it", () => {
    expect(parseLayout("just a prompt about a koi pond")).toBeNull();
    expect(parseLayout('{"width": 512}')).toBeNull();
    expect(parseLayout("")).toBeNull();
  });
});

describe("validateLayout", () => {
  it("names what stops a run", () => {
    const d = draft([item("object", "A cup.", [0.1, 0.1, 0.4, 0.4]), item("text", "Title.", [0.2, 0.6, 0.8, 0.8], { text: "  " }), item("object", "Spill.", [0.5, 0.5, 1.2, 0.9])]);
    expect(validateLayout(d, 1000, 1024).map((i) => i.message)).toEqual([
      "Width and height must be multiples of 16 px (this canvas is 1000 × 1024)",
      "Type the words for box 2",
      "Box 3 goes past the edge of the picture",
    ]);
    expect(validateLayout(d, 1024, 1024).find((i) => i.item === 1)).toMatchObject({ level: "error", message: "Type the words for box 2" });
    expect(validateLayout(draft([item("object", "Flat.", [0.2, 0.5, 0.6, 0.5])]), 1024, 1024)[0].message).toBe("Box 1 has no size: draw it again");
  });

  it("warns past 2048 px a side or 4 megapixels", () => {
    expect(validateLayout(draft([]), 2048, 2048)).toEqual([]);
    expect(validateLayout(draft([]), 3840, 2160)).toEqual([
      { level: "warning", message: "3840 × 2160 is past what MOSS-Image was made for (2048 px a side, 4 megapixels): the boxes may drift" },
    ]);
  });

  it("holds MOSI to 4,000 characters", () => {
    const long = draft(Array.from({ length: 40 }, (_, i) => item("object", `Item number ${i} with a long description of its look and feel.`, [0.01 * i, 0.01, 0.01 * i + 0.01, 0.02])));
    expect(validateLayout(long, 1024, 1024, "moss")).toEqual([]);
    const issues = validateLayout(long, 1024, 1024, "mosi");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/^MOSI takes prompts up to 4,000 characters; this layout is \d,\d{3}$/);
  });
});

describe("other models' forms", () => {
  const poster = draft(
    [
      item("object", "A lit candle on a wooden table.", [0.3, 0.35, 0.7, 0.95], { palette: ["#ffaa00"] }),
      item("text", "Bold serif headline.", [0.1, 0.05, 0.9, 0.2], { text: "30% OFF" }),
    ],
    "A sale poster for a candle shop",
    { meta: ["warm", "minimal"], palette: ["#2b1d0e", "#ffaa00"] },
  );

  it("gridBox and locationWords", () => {
    expect(gridBox([0.25, 0.1, 0.75, 0.5])).toEqual([100, 250, 500, 750]);
    // Python's round: halves go to the even neighbour.
    expect(gridBox([0.0005, 0.0015, 0.0025, 0.0035])).toEqual([2, 0, 4, 2]);
    expect(locationWords([0, 0, 0.3, 0.3])).toBe("top left");
    expect(locationWords([0.4, 0.4, 0.6, 0.6])).toBe("center");
    expect(locationWords([0.7, 0.4, 0.95, 0.6])).toBe("middle right");
    expect(locationWords([0.4, 0.75, 0.6, 0.95])).toBe("bottom center");
    expect(locationWords([0.1, 0.05, 0.9, 0.2])).toBe("across the top");
    expect(locationWords([0.05, 0.1, 0.3, 0.9])).toBe("down the left side");
    expect(locationWords([0, 0, 1, 1])).toBe("filling the frame");
  });

  it("compileFlux3: a caption citing <obj_N>, then the layout table", () => {
    expect(compileFlux3(poster)).toBe(
      'A sale poster for a candle shop. <obj_1> A lit candle on a wooden table, <obj_2> the words "30% OFF" (Bold serif headline). ' +
        '[{"id": "obj_1", "bbox": [350, 300, 950, 700], "desc": "A lit candle on a wooden table."}, {"id": "obj_2", "bbox": [50, 100, 200, 900], "desc": "Bold serif headline. \\"30% OFF\\""}]',
    );
    expect(compileFlux3(draft([], " Just words "))).toBe("Just words");
  });

  it("compileIdeogram: BuildJsonPromptIdeogram's shape", () => {
    const backdrop = { ...poster, items: [item("object", "Dark wood panelling.", [0, 0, 1, 1]), ...poster.items] };
    expect(JSON.parse(compileIdeogram(backdrop))).toEqual({
      high_level_description: "A sale poster for a candle shop",
      style_description: { aesthetics: "warm, minimal", lighting: "", medium: "", art_style: "", color_palette: ["#2B1D0E", "#FFAA00"] },
      compositional_deconstruction: {
        background: "Dark wood panelling.",
        elements: [
          { type: "obj", bbox: [350, 300, 950, 700], desc: "A lit candle on a wooden table.", color_palette: ["#FFAA00"] },
          { type: "text", bbox: [50, 100, 200, 900], text: "30% OFF", desc: "Bold serif headline." },
        ],
      },
    });
    // No style words, no backdrop: the caption describes the background.
    expect(JSON.parse(compileIdeogram(draft([item("object", "A cup.", [0.4, 0.4, 0.6, 0.6])], "A kitchen.")))).toEqual({
      high_level_description: "A kitchen.",
      compositional_deconstruction: { background: "A kitchen.", elements: [{ type: "obj", bbox: [400, 400, 600, 600], desc: "A cup." }] },
    });
  });

  it("compileVgl: Bria FIBO 2's objects and text_render with location words", () => {
    expect(compileVgl(poster)).toEqual({
      short_description: "A sale poster for a candle shop",
      objects: [
        { description: "A lit candle on a wooden table.", location: "center", relationship: 'below the words "30% OFF"', relative_size: "medium", shape_and_color: "in #ffaa00" },
      ],
      text_render: [{ text: "30% OFF", location: "across the top", size: "medium", appearance_details: "Bold serif headline." }],
      aesthetics: { composition: "a single picture", color_scheme: "#2b1d0e, #ffaa00", mood_atmosphere: "warm, minimal" },
    });
    expect(compileVgl(draft([item("character", "", [0.4, 0.4, 0.6, 0.6])])).objects[0]).toMatchObject({ description: "a person", relationship: "the only element in the picture" });
  });

  it("compileWords: plain sentences", () => {
    expect(compileWords(poster)).toBe(
      'A sale poster for a candle shop. In the center: A lit candle on a wooden table. Across the top: the words "30% OFF" (Bold serif headline). Style: warm, minimal. Color palette: #2b1d0e, #ffaa00.',
    );
    expect(compileWords({ ...poster, summary: { ...poster.summary, canvas: "multi_panel", meta: [], palette: undefined } })).toContain("Laid out as a multi-panel layout.");
  });

  it("layoutCompilerFor picks the model's form", () => {
    const at = (layout?: "moss" | "flux3" | "ideogram" | "vgl") => layoutCompilerFor({ options: { layout } })(poster, 1024, 1024);
    expect(at("moss")).toEqual({ format: "moss", prompt: compileMoss(poster, 1024, 1024) });
    expect(at("flux3")).toEqual({ format: "flux3", prompt: compileFlux3(poster) });
    expect(at("ideogram")).toEqual({ format: "ideogram", prompt: compileIdeogram(poster) });
    expect(at("vgl")).toEqual({ format: "vgl", prompt: compileWords(poster), vgl: compileVgl(poster) });
    expect(at()).toEqual({ format: "words", prompt: compileWords(poster) });
    expect(layoutCompilerFor(undefined)(poster, 1024, 1024).format).toBe("words");
    expect([readsBoxes({ options: { layout: "moss" } }), readsBoxes({ options: { layout: "vgl" } }), readsBoxes({ options: {} })]).toEqual([true, false, false]);
  });

  it("carriesLayout reads params.extra.layout", () => {
    expect(carriesLayout({ layout: poster })).toBe(true);
    expect(carriesLayout({ layout: "nope" })).toBe(false);
    expect(carriesLayout(undefined)).toBe(false);
  });
});
