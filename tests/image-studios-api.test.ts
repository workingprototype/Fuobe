import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-image-studios-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.HF_KEY;
delete process.env.HF_API_KEY;

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { createElement } = await import("@/server/elements");
const palettes = await import("@/server/palettes");
const moodboards = await import("@/server/moodboards");
const { PALETTES } = await import("@/lib/catalog/cinema");
const { MODELS } = await import("@/lib/catalog");
const palettesRoute = await import("@/app/api/palettes/route");
const paletteRoute = await import("@/app/api/palettes/[id]/route");
const lockRoute = await import("@/app/api/palettes/lock/route");
const moodboardsRoute = await import("@/app/api/moodboards/route");
const photodumpRoute = await import("@/app/api/photodump/route");
const packsRoute = await import("@/app/api/photodump/packs/route");
const fashionRoute = await import("@/app/api/photodump/fashion/route");
const characterRoute = await import("@/app/api/photodump/character/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("higgsfieldKey", "");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (method: string, body?: unknown, url = "http://x/api") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const upload = () => saveFile({ data: PNG, contentType: "image/png", source: "upload" }).url;

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("palettes", () => {
  it("seeds Cinema Studio's 50 palettes once, with their slugs and the 12th colour as background", async () => {
    // (GET /api/palettes returns exactly these two; route GETs need a request scope, so the server functions are called here.)
    const body = { items: palettes.listPalettes(), caps: palettes.signatureCaps() };
    const builtins = body.items.filter((p) => p.source === "builtin");
    expect(builtins).toHaveLength(50);
    expect(builtins.map((p) => p.slug)).toEqual(PALETTES.map((p) => p.slug));
    expect(builtins[0].colors).toHaveLength(12);
    expect(builtins[0].background).toBe(builtins[0].colors[11]);
    expect(palettes.listPalettes().filter((p) => p.source === "builtin")).toHaveLength(50);
    // Which models take a palette comes from their field maps.
    const native = Object.keys(body.caps.native).sort();
    const fromMaps = MODELS.filter((m) => m.routes.some((r) => r.map?.palette)).map((m) => m.id).sort();
    expect(native).toEqual(fromMaps);
    expect(body.caps.native["recraft-4-1"]).toEqual({ max: 10, background: "background_color" });
    expect(body.caps.native["ideogram-3"]).toEqual({ max: 12 });
  });

  it("saves, renames and deletes your palettes; built-ins stay", async () => {
    const bad = await palettesRoute.POST(json("POST", { name: "x", colors: ["#zzzzzz"] }));
    expect(bad.status).toBe(400);
    const res = await palettesRoute.POST(json("POST", { name: "Sea Glass", colors: ["#aabbcc", "112233"], background: "#000000", source: "manual" }));
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.colors).toEqual(["#AABBCC", "#112233"]);
    expect(palettes.listPalettes()[0].id).toBe(p.id);
    expect((await paletteRoute.PATCH(json("PATCH", { name: "Sea Glass II" }), params({ id: p.id }))).status).toBe(200);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: "builtin-static-noon" }))).status).toBe(400);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: p.id }))).status).toBe(204);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: p.id }))).status).toBe(404);
  });

  it("locks an open image to the palette with a chained palette-transfer step", async () => {
    const res = await lockRoute.POST(
      json("POST", { request: { feature: "image", modelId: "oss-qwen-image", prompt: "a lighthouse", params: { numOutputs: 2, palette: ["#102030"] } }, colors: ["#102030", "#2a9d8f"] }),
    );
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: { id: string; modelId: string; op: string; batchId: string; request: { step?: { label: string } } }[] };
    expect(items).toHaveLength(4);
    expect(new Set(items.map((g) => g.batchId)).size).toBe(1);
    const locks = items.filter((g) => g.modelId === "oss-palette-image");
    expect(locks.map((g) => g.op)).toEqual(["color-match", "color-match"]);
    expect(locks[0].request.step?.label).toBe("Palette lock 1 of 2");
    const done = await settle(locks[0].id);
    expect(done.status).toBe("succeeded");
    expect(done.request.params?.palette).toEqual(["#102030", "#2A9D8F"]);
  }, 45_000);
});

describe("moodboards", () => {
  it("refuses boards outside Higgsfield's limits, in its words", async () => {
    const few = await moodboardsRoute.POST(json("POST", { name: "x", images: [upload(), upload()] }));
    expect(few.status).toBe(400);
    expect((await few.json()).error).toBe("Upload at least 5 photos to continue.");
    const noName = await moodboardsRoute.POST(json("POST", { name: " ", images: Array.from({ length: 5 }, upload) }));
    expect((await noName.json()).error).toBe("Please enter a moodboard name");
  });

  it("builds a board through its cover job (open: collages on Qwen-Image-Edit Style Reference), then it's usable", async () => {
    const images = Array.from({ length: 6 }, upload);
    const res = await moodboardsRoute.POST(json("POST", { name: "Neon Haze", images, collages: [upload()], engine: "open" }));
    expect(res.status).toBe(201);
    const m = await res.json();
    expect(["queued", "running", "cover"]).toContain(m.status);
    expect(m.refs).toEqual(images);
    const g = gens.getGeneration(m.generationId)!;
    expect(g.modelId).toBe("oss-style-qwen-edit");
    expect(g.feature).toBe("moodboard");
    expect(g.request.inputs?.images).toEqual(m.collages);
    await settle(m.generationId);
    const done = moodboards.getMoodboard(m.id)!;
    expect(done.status).toBe("complete");
    // A demo cover makes no Recraft style and keeps the first image as the cover.
    expect(done.styleId).toBeNull();
    expect(done.cover).toBe(images[0]);
    const list = { items: moodboards.listMoodboards(), curated: moodboards.curatedMoodboards() };
    expect(list.items.map((x) => x.id)).toContain(m.id);
    expect(list.curated).toHaveLength(33);
    expect(new Set(list.curated.map((c) => c.category))).toEqual(new Set(["All presets", "Mood", "Styles", "Camera"]));
    // A style LoRA needs AI-Toolkit: without its URL the board says where to set it up and makes no element.
    expect(() => moodboards.trainMoodboard(m.id)).toThrow(/AI-Toolkit URL/);
    expect(moodboards.getMoodboard(m.id)!.lora).toBeNull();
  }, 45_000);

  it("prepares cloud boards on Recraft V4 Styles with the 10 most representative images", () => {
    const images = Array.from({ length: 12 }, upload);
    const m = moodboards.createMoodboard({ name: "Paper Cut", images, engine: "cloud" });
    const g = gens.getGeneration(m.generationId!)!;
    expect(g.modelId).toBe("recraft-4-style");
    expect(g.request.inputs?.images).toEqual(images.slice(0, 10));
    expect(m.refs).toHaveLength(10);
    // Training a style LoRA needs AI-Toolkit; until then it says where to set it up.
    expect(() => moodboards.trainMoodboard(m.id)).toThrow(/still training/);
    expect(moodboards.deleteMoodboard(m.id)).toBe(true);
    expect(moodboards.getMoodboard(m.id)).toBeNull();
  });
});

describe("photodump, fashion factory and character sheet runs", () => {
  it("prices and makes an Instadump from one selfie as one batch", async () => {
    const selfie = upload();
    const preview = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie, aspectRatio: "3:4" }, "http://x/api/photodump?preview=1"))).json();
    expect(preview).toMatchObject({ modelId: "nano-banana-pro", count: 9, demo: true });
    const res = await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie, aspectRatio: "3:4" }));
    expect(res.status).toBe(201);
    const { batchId, items } = await res.json();
    expect(items).toHaveLength(9);
    expect(items.every((g: { batchId: string; feature: string }) => g.batchId === batchId && g.feature === "photodump")).toBe(true);
    expect(items[0].request.batchTitle).toBe("Winter special · Selfie");
    expect(items[0].request.inputs.images).toEqual([selfie]);
    expect((await settle(items[0].id)).status).toBe("succeeded");
  }, 45_000);

  it("makes a user pack and a character's photodump on the open engine", async () => {
    const pack = await (await packsRoute.POST(json("POST", { name: "Mine", refs: [upload(), upload()] }))).json();
    expect(pack.id).toMatch(/^user-/);
    const el = createElement({ name: "Maya", kind: "character", references: [upload()] });
    const { items } = await (await photodumpRoute.POST(json("POST", { packId: pack.id, engine: "open", elementId: el.id }))).json();
    expect(items).toHaveLength(2);
    expect(items[0].modelId).toBe("oss-qwen-edit");
    // The pack's photo, then Maya's reference (her @mention resolves on the server).
    expect(items[0].request.inputs.images).toEqual([pack.refs[0]]);
    expect(items[0].request.prompt).toMatch(/^@Maya recreated in image 1/);
    const bad = await photodumpRoute.POST(json("POST", { packId: "zen", engine: "cloud" }));
    expect(bad.status).toBe(400);
  });

  it("runs the Fashion Factory steps", async () => {
    const el = createElement({ name: "Ines", kind: "character", references: [upload()] });
    const base = await (await fashionRoute.POST(json("POST", { step: "base", templateId: "red-room", elementId: el.id, engine: "cloud" }))).json();
    expect(base.items[0]).toMatchObject({ modelId: "nano-banana-pro", feature: "fashion" });
    expect(base.items[0].request.params).toMatchObject({ aspectRatio: "3:4", numOutputs: 4 });
    const outfit = await (await fashionRoute.POST(json("POST", { step: "outfit", templateId: "red-room", base: upload(), garment: upload(), engine: "cloud" }))).json();
    expect(outfit.items[0].modelId).toBe("fashn-tryon");
    const set = await (await fashionRoute.POST(json("POST", { step: "photoset", templateId: "red-room", dressed: upload(), engine: "open" }))).json();
    expect(set.items).toHaveLength(9);
    expect(set.items.every((g: { modelId: string; batchId: string }) => g.modelId === "oss-qwen-edit" && g.batchId === set.batchId)).toBe(true);
    const missing = await fashionRoute.POST(json("POST", { step: "photoset", templateId: "nope", dressed: upload(), engine: "open" }));
    expect((await missing.json()).error).toBe("Template required");
  });

  it("makes character sheets from references, a Soul Cast build and a description", async () => {
    const tooMany = await characterRoute.POST(json("POST", { mode: "reference", engine: "cloud", images: Array.from({ length: 6 }, upload) }));
    expect((await tooMany.json()).error).toBe("Maximum 5 images");
    const ref = await (await characterRoute.POST(json("POST", { mode: "reference", engine: "cloud", images: [upload(), upload()] }))).json();
    expect(ref.items[0]).toMatchObject({ modelId: "nano-banana-pro", op: "edit", feature: "character-sheet" });
    const cast = await (await characterRoute.POST(json("POST", { mode: "cast", engine: "open", cast: { genre: "Western", gender: "Female", age: 30, archetype: "Rebel" } }))).json();
    expect(cast.items[0].modelId).toBe("oss-zimage-soul-cast");
    expect(cast.items[0].prompt).toMatch(/30-year-old woman, the rebel archetype/);
    const noKey = await (await characterRoute.POST(json("POST", { mode: "cast", engine: "cloud", cast: { genre: "Drama" } }))).json();
    expect(noKey.items[0].modelId).toBe("nano-banana-pro");
    expect(noKey.notes[0]).toMatch(/Higgsfield key/);
    const app = await (await characterRoute.POST(json("POST", { mode: "describe", engine: "open", prompt: "a surfer from Lisbon" }))).json();
    expect(app.items[0]).toMatchObject({ presetId: "app-ai-influencer", modelId: "oss-zimage-soul-cast", feature: "app:app-ai-influencer" });
  });
});
