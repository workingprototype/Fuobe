import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-marketing-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
// The fixture site runs on 127.0.0.1 (no outside network in tests).
process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";

// Route handlers call connection() and after(); outside a request, run the work directly.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: unknown) => void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => {}),
}));

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const brand = await import("@/server/brand");
const mk = await import("@/server/marketing");
const ads = await import("@/server/ads");
const brandsRoute = await import("@/app/api/brands/route");
const brandRoute = await import("@/app/api/brands/[id]/route");
const researchRoute = await import("@/app/api/brands/[id]/research/route");
const chatRoute = await import("@/app/api/brands/[id]/chat/route");
const confirmRoute = await import("@/app/api/brands/[id]/chat/confirm/route");
const productsRoute = await import("@/app/api/products/route");
const productRoute = await import("@/app/api/products/[id]/route");
const readRoute = await import("@/app/api/products/read/route");
const runsRoute = await import("@/app/api/marketing/runs/route");
const estimateRoute = await import("@/app/api/marketing/estimate/route");
const multiplierEstimate = await import("@/app/api/ads/multiplier/estimate/route");
const multiplierRoute = await import("@/app/api/ads/multiplier/route");
const againRoute = await import("@/app/api/marketing/runs/[id]/again/route");
const composeRoute = await import("@/app/api/marketing/runs/[id]/compose/route");
const adsEstimate = await import("@/app/api/ads/estimate/route");
const creativesRoute = await import("@/app/api/ads/creatives/route");
const creativeRoute = await import("@/app/api/ads/creatives/[id]/route");
const saveRoute = await import("@/app/api/ads/creatives/[id]/save/route");
const { saveFile } = await import("@/server/storage");
const { getModel } = await import("@/lib/catalog");

const json = (method: string, body?: unknown, url = "http://x/api") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function settle(id: string, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------
// A fixture website on 127.0.0.1

const fx = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures/marketing", name), "utf8");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(12_000, 7)]);
let origin = "";
const local = (s: string) => s.replace(/https:\/\/(emberandoat\.example|cdn\.example-shop\.com|dewtheory\.example)/g, origin);
const COLLECTION = () =>
  `<html><head><script type="application/ld+json">{"@type":"ItemList","itemListElement":[${["Night Serum", "Day Cream", "Lip Balm"]
    .map((n, i) => `{"@type":"ListItem","item":{"@type":"Product","name":"${n}","image":"${origin}/img/p${i}.png","offers":{"price":"${10 + i}","priceCurrency":"USD"}}}`)
    .join(",")}]}</script></head><body></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", origin);
  const send = (body: string | Buffer, type: string) => {
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  };
  if (u.pathname === "/") return send(local(fx("shop-home.html")), "text/html");
  if (u.pathname.endsWith("base.css")) return send(fx("base.css"), "text/css");
  if (u.pathname === "/products.json") return send(local(fx("products.json")), "application/json");
  if (u.pathname === "/products/barrier-cream") return send(local(fx("product-page.html")), "text/html");
  if (u.pathname === "/products/maple-pecan-granola") return send(`<html><head><script src="https://cdn.shopify.com/x.js"></script><title>Maple</title></head><body><h1>Maple</h1></body></html>`, "text/html");
  if (u.pathname === "/products/maple-pecan-granola.json") return send(JSON.stringify({ product: JSON.parse(local(fx("products.json"))).products[0] }), "application/json");
  if (u.pathname === "/collections/skin") return send(COLLECTION(), "text/html");
  if (/\.(png|jpe?g|gif)$/.test(u.pathname)) return send(PNG, "image/png");
  res.writeHead(404);
  res.end();
});

beforeAll(async () => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const upload = (name = "product.png") => saveFile({ data: PNG, contentType: "image/png", name, source: "upload" }).url;

// ---------------------------------------------------------------------------

describe("brand kits", () => {
  let brandId = "";

  it("researches a website: name, colours, fonts, inline SVG logo, images, socials and Shopify products", async () => {
    const { brand: b, run } = brand.createBrandFromWebsite(`${origin}/`);
    expect(b.status).toBe("researching");
    expect(b.progress?.label).toBe("Reading your website");
    await run;
    const done = brand.getBrand(b.id)!;
    brandId = done.id;
    expect(done.status).toBe("ready");
    expect(done.progress).toBeNull();
    expect(done.name).toBe("Ember & Oat");
    expect(done.colors[0]).toBe("#c2410c");
    expect(done.fonts).toEqual({ heading: "Fraunces", body: "Inter" });
    expect(done.logo).toMatch(/^\/api\/files\/uploads\/.+\.svg$/);
    expect(done.images.length).toBeGreaterThan(0);
    expect(done.socials.map((s) => s.network)).toContain("Instagram");
    expect(done.tagline).toMatch(/^Small-batch granola/);
    expect(done.sellingPoints).toContain("Vegan");
    expect(done.language).toBe("English");
    const products = brand.listProducts(done.id);
    expect(products.map((p) => p.name)).toEqual(["Maple Pecan Granola", "Cocoa Hazelnut Butter"]);
    expect(products[0].price).toBe(12.5);
    expect(products[0].images).toHaveLength(2);
    expect(products[0].images[0]).toMatch(/^\/api\/files\/uploads\//);
    expect(products[0].sellingPoints.length).toBeGreaterThan(0);
  });

  it("re-runs the research without duplicating products; a site that can't be read still gives a kit to fill in", async () => {
    const res = await researchRoute.POST(json("POST"), params({ id: brandId }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 100 && brand.getBrand(brandId)!.status === "researching"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(brand.getBrand(brandId)!.status).toBe("ready");
    expect(brand.listProducts(brandId)).toHaveLength(2);

    const { brand: dead, run } = brand.createBrandFromWebsite(`http://127.0.0.1:9/`);
    await run;
    const d = brand.getBrand(dead.id)!;
    expect(d.status).toBe("ready");
    expect(d.note).toMatch(/couldn't read the site/);
    expect(d.name).toBe("127");
    brand.deleteBrand(dead.id);
  });

  it("lists, edits (cleaning values) and cancels through the routes", async () => {
    const list = await (await brandsRoute.GET()).json();
    expect(list.items[0]).toMatchObject({ id: brandId, productCount: 2 });
    const res = await brandRoute.PATCH(json("PATCH", { tagline: "  Slow Sunday granola  ", colors: ["#ABCDEF", "nope", "rgb(1,2,3)"], tone: ["Warm", "Warm", ""], language: "de" }), params({ id: brandId }));
    const b = await res.json();
    expect(b.tagline).toBe("Slow Sunday granola");
    expect(b.colors).toEqual(["#abcdef", "#010203"]);
    expect(b.tone).toEqual(["Warm"]);
    expect(b.language).toBe("German");
    const view = await (await brandRoute.GET(json("GET"), params({ id: brandId }))).json();
    expect(view.products).toHaveLength(2);
    expect((await researchRoute.DELETE(json("DELETE"), params({ id: "missing" }))).status).toBe(404);
    expect((await brandsRoute.POST(json("POST", { website: "not a site" }))).status).toBe(422);
  });

  it("builds a kit by hand from a description (offline: name and look from the words)", async () => {
    const res = await brandsRoute.POST(json("POST", { description: "Hollow Pine — hand-poured soy candles that smell like a cabin weekend.", colors: ["#6b7f6a"] }));
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ name: "Hollow Pine", status: "ready", source: "manual", colors: ["#6b7f6a"] });
    expect(b.fonts.heading).toBe("DM Serif Display");
    expect((await brandsRoute.POST(json("POST", { description: "" }))).status).toBe(422);
  });

  it("adds products by hand and from links (JSON-LD, Shopify product JSON, collection pages), with duplicate checks", async () => {
    const created = await productsRoute.POST(json("POST", { name: "Gift Box", brandId, price: 30, sellingPoints: ["Three flavours"], images: [upload()] }));
    expect(created.status).toBe(201);
    const dup = await productsRoute.POST(json("POST", { name: "gift box", brandId }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("«gift box» is already among this brand's products.");
    expect((await productsRoute.POST(json("POST", { name: "gift box", brandId, force: true }))).status).toBe(201);
    expect((await productsRoute.POST(json("POST", { name: "Bad", price: -1 }))).status).toBe(422);
    const tooMany = await productsRoute.POST(json("POST", { name: "X", sellingPoints: ["1", "2", "3", "4", "5", "6"] }));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toMatch(/Add up to five selling points/);

    const read = await (await readRoute.POST(json("POST", { url: `${origin}/products/barrier-cream`, brandId }))).json();
    expect(read.products[0]).toMatchObject({ name: "Barrier Cream", price: 34, currency: "EUR", brandId });
    expect(read.products[0].images).toHaveLength(2);
    const again = await (await readRoute.POST(json("POST", { url: `${origin}/products/barrier-cream`, brandId }))).json();
    expect(again.duplicate.name).toBe("Barrier Cream");

    // Read with its brand (Click to Ad), the product joins the site's own kit — here the researched one, which has it already.
    const shop = await (await readRoute.POST(json("POST", { url: `${origin}/products/maple-pecan-granola`, withBrand: true }))).json();
    expect(shop.brandId).toBe(brandId);
    expect(shop.duplicate).toMatchObject({ name: "Maple Pecan Granola", price: 12.5, brandId });
    expect(shop.brand).toMatchObject({ name: "Ember & Oat", logo: expect.stringMatching(/^\/api\/files\//) });
    expect(brand.listProducts(brandId).filter((x) => x.name === "Maple Pecan Granola")).toHaveLength(1);

    const coll = await (await readRoute.POST(json("POST", { url: `${origin}/collections/skin`, limit: 2 }))).json();
    expect(coll.products.map((p: { name: string }) => p.name)).toEqual(["Night Serum", "Day Cream"]);
    expect(coll.message).toBe("Found 3 products on that page and added the first 2. Paste a product's own link to add another.");

    const p = read.products[0];
    const patched = await (await productRoute.PATCH(json("PATCH", { audience: "Sensitive skin", url: "dewtheory.example/cream" }), params({ id: p.id }))).json();
    expect(patched).toMatchObject({ audience: "Sensitive skin", url: "https://dewtheory.example/cream" });
    const unassigned = await (await productsRoute.GET(json("GET", undefined, "http://x/api/products?brand=none"))).json();
    expect(unassigned.items.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(["Night Serum", "Day Cream"]));
    expect((await productRoute.DELETE(json("DELETE"), params({ id: p.id }))).status).toBe(204);
  });

  it("keeps a product page's logo and colours in the site's brand kit (made once, then matched by host)", () => {
    const bits = { name: "Dew Theory", logo: upload("logo.png"), colors: ["#112233", "#445566"], fonts: { heading: "Fraunces" } };
    const made = brand.kitForSite("https://www.dewtheory.example/products/barrier-cream", bits);
    expect(made).toMatchObject({ name: "Dew Theory", website: "https://www.dewtheory.example/", status: "ready", logo: bits.logo, colors: bits.colors, fonts: { heading: "Fraunces" } });
    expect(made.note).toMatch(/Made from a product page on dewtheory\.example/);
    const again = brand.kitForSite("https://dewtheory.example/products/night-serum", { colors: ["#ffffff"], fonts: {} });
    expect(again.id).toBe(made.id);
    expect(again.colors).toEqual(bits.colors); // the kit's own colours win
    // The kit reaches Click to Ad's video prompts through the product's brand.
    const p = brand.createProduct({ name: "Barrier Cream", brandId: made.id, images: [upload()] });
    const plan = mk.planClickToAd({ engine: "cloud", productId: p.id, styleId: "clean-minimal" }, { product: p, brand: brand.getBrand(made.id), script: "One two three four five six seven eight." });
    expect(plan.meta.brandId).toBe(made.id);
    expect(plan.steps.find((s) => s.key === "shot1")!.request.prompt).toMatch(/Brand: Dew Theory.*#112233/);
    brand.deleteBrand(made.id);
  });

  it("plans Marketing Studio runs per format and engine", () => {
    const b = brand.getBrand(brandId)!;
    const product = brand.listProducts(brandId)[0];
    const ctx = { product, brand: b, higgsfield: false };
    const cloudAd = mk.planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline" }, ctx);
    const r = cloudAd.steps[0].request;
    expect(r).toMatchObject({ modelId: "gpt-image-2-5", op: "edit", feature: "marketing", params: { aspectRatio: "4:5", numOutputs: 1 } });
    expect(r.prompt).toContain("“Meet Maple Pecan Granola”");
    expect(r.prompt).toContain("“Shop now”");
    expect(r.inputs?.images).toEqual([product.images[0]]); // the SVG logo isn't sent to the model
    expect(cloudAd.meta.overlay).toBeNull();

    const openAd = mk.planMarketing({ engine: "open", format: "ads", templateId: "ad-hero-headline", headline: "Crunch, sorted" }, ctx);
    expect(openAd.steps[0].request).toMatchObject({ modelId: "oss-qwen-edit", op: "edit" });
    expect(openAd.steps[0].request.prompt).toMatch(/no text, letters/);
    expect(openAd.meta.overlay).toEqual({ headline: "Crunch, sorted", cta: "Shop now" });

    const poster = mk.planMarketing({ engine: "cloud", format: "poster", templateId: "po-swiss-grid", prompt: "Autumn launch" }, { ...ctx, product: null });
    expect(poster.steps[0].request).toMatchObject({ modelId: "ideogram-3", op: "t2i", params: { palette: b.colors.slice(0, 5) } });
    expect(mk.planMarketing({ engine: "open", format: "poster", prompt: "Autumn" }, { ...ctx, product: null }).steps[0].request).toMatchObject({ modelId: "oss-qwen-image", op: "t2i" });

    const shot = mk.planMarketing({ engine: "cloud", format: "product-standalone", templateId: "ps-ice-bath" }, ctx);
    expect(shot.steps[0].request.modelId).toBe("bria-product-shot");
    expect(shot.steps[0].request.prompt).toMatch(/^The product is half buried in crushed ice/);
    expect(() => mk.planMarketing({ engine: "cloud", format: "product-standalone" }, { ...ctx, product: null })).toThrow("Attach a product to generate");
    expect(() => mk.planMarketing({ engine: "cloud", format: "product-with-model" }, { ...ctx, product: null })).toThrow("Attach reference or product");
    expect(() => mk.planMarketing({ engine: "cloud", format: "ads", templateId: "po-swiss-grid" }, ctx)).toThrow(/another format/);

    // Open motion longer than a clip: shots from the product photo, then a join.
    const motion = mk.planMarketing({ engine: "open", format: "motion-hyper", templateId: "mh-orbit-hero", duration: 15 }, ctx);
    expect(motion.steps.map((s) => s.key)).toEqual(["shot1", "shot2", "shot3", "film"]);
    expect(motion.steps[0].request).toMatchObject({ modelId: "oss-wan22-14b-fast", op: "i2v", params: { duration: 5, aspectRatio: "9:16" }, feature: "marketing-step" });
    expect(motion.steps[3]).toMatchObject({ after: ["shot1", "shot2", "shot3"], request: { modelId: "oss-join-clips", op: "concat", feature: "marketing" } });
    const cloudMotion = mk.planMarketing({ engine: "cloud", format: "motion-hyper", duration: 15 }, ctx);
    expect(cloudMotion.steps).toHaveLength(1);
    expect(cloudMotion.steps[0].request).toMatchObject({ modelId: "seedance-2-5", op: "i2v", params: { duration: 12 } });
    expect(cloudMotion.notes[0]).toMatch(/12 s clips/);
  });

  it("plans the UGC presenter chain on both engines", () => {
    const b = brand.getBrand(brandId)!;
    const product = brand.listProducts(brandId)[0];
    const script = "Okay so I have to tell you about this granola. It is crunchy, not too sweet, and I eat it every single morning now. Try it.";
    const cloud = mk.planMarketing({ engine: "cloud", format: "ugc-talking", hookId: "product-hit", settingId: "kitchen" }, { product, brand: b, higgsfield: false, script });
    expect(cloud.steps.map((s) => s.key)).toEqual(["voice", "still", "talk", "captions", "hook", "broll", "film"]);
    const step = (k: string) => cloud.steps.find((s) => s.key === k)!;
    expect(step("voice").request).toMatchObject({ modelId: "elevenlabs-v4", op: "tts", prompt: script });
    expect(step("still").request.prompt).toContain("leaning on a kitchen counter");
    expect(step("talk")).toMatchObject({ after: ["still", "voice"], chain: [{ slot: "images" }, { slot: "audio" }], request: { modelId: "omnihuman-2", op: "avatar" } });
    expect(step("captions").request.modelId).toBe("auto-subtitle");
    expect(step("hook")).toMatchObject({ after: ["still"], request: { op: "i2v", modelId: "seedance-2-5" } });
    expect(step("film")).toMatchObject({ after: ["hook", "captions", "broll"], request: { modelId: "join-clips", feature: "marketing" } });
    expect(cloud.finals).toEqual(["film"]);
    expect(cloud.meta.script).toBe(script);

    expect(() => mk.planMarketing({ engine: "open", format: "ugc-talking" }, { product, brand: b, higgsfield: false, script })).toThrow(/voice sample/);
    const open = mk.planMarketing({ engine: "open", format: "tiktok", hookId: null, voiceSample: upload("voice.png") }, { product, brand: b, higgsfield: false, script });
    expect(open.steps.map((s) => s.key)).toEqual(["voice", "still", "talk", "captions", "broll", "film"]);
    expect(open.steps[0].request).toMatchObject({ modelId: "oss-chatterbox", inputs: { voiceAudio: expect.stringMatching(/^\/api\/files\//) } });
    expect(open.steps[2].request.modelId).toBe("oss-infinitetalk-long");
    expect(open.steps[3].request.prompt).toMatch(/^0\.00-\d+\.\d\d: Okay so I/);
  });

  it("runs a template in demo mode and lists the run with its generations", async () => {
    const product = brand.listProducts(brandId)[0];
    const est = await (await estimateRoute.POST(json("POST", { engine: "cloud", format: "ads", templateId: "ad-offer-burst", productId: product.id, brandId, batch: 2 }))).json();
    expect(est).toMatchObject({ demo: true, runs: 1, steps: [{ key: "image", modelId: "gpt-image-2-5" }] });
    const blocked = await (await estimateRoute.POST(json("POST", { engine: "cloud", format: "ads" }))).json();
    expect(blocked.blocker).toBe("Attach a product to generate");

    const res = await runsRoute.POST(json("POST", { engine: "cloud", format: "ads", templateId: "ad-offer-burst", productId: product.id, brandId, batch: 2 }));
    expect(res.status).toBe(201);
    const { runs } = await res.json();
    expect(runs).toHaveLength(1);
    const g = await settle(runs[0].finalIds[0]);
    expect(g.status).toBe("succeeded");
    expect(g.outputs).toHaveLength(2);
    expect(g.request.title).toBe("Offer Burst · Maple Pecan Granola");
    const list = await (await runsRoute.GET(json("GET", undefined, "http://x/api/marketing/runs?feature=marketing"))).json();
    expect(list.items[0]).toMatchObject({ id: runs[0].id, title: "Offer Burst · Maple Pecan Granola", meta: { templateId: "ad-offer-burst", format: "ads" } });
    expect(list.items[0].generations[0].status).toBe("succeeded");
  });

  it("runs a whole UGC pipeline on the demo provider (open engine: voice clone → presenter → captions → join)", async () => {
    const product = brand.listProducts(brandId)[0];
    const { runs, script } = await mk.runMarketing({ engine: "open", format: "ugc-talking", templateId: "ugc-honest-review", productId: product.id, brandId, voiceSample: upload("v.png"), duration: 10 });
    expect(script?.split(" ").length).toBeLessThanOrEqual(25);
    const run = runs[0];
    expect(run.generations).toHaveLength(6);
    const film = await settle(run.finalIds[0], 120_000);
    expect(film.status).toBe("succeeded");
    expect(film.op).toBe("concat");
    expect(mk.getRun(run.id)!.generations.every((x) => x.status === "succeeded")).toBe(true);
  }, 150_000);
});

describe("Click to Ad", () => {
  it("plans product-only and presenter ads, ≤ 12 s, on both engines", () => {
    const product = { ...brand.listProducts()[0] };
    const script = "Three reasons I keep this in my bag. It is light, it is tough, and it looks great.";
    const cloud = mk.planClickToAd({ engine: "cloud", productId: product.id, styleId: "clean-minimal" }, { product, script });
    expect(cloud.steps.map((s) => s.key)).toEqual(["voice", "shot1", "shot2", "shot3", "film", "mux", "captions"]);
    expect(cloud.steps.slice(1, 4).reduce((n, s) => n + (s.request.params?.duration ?? 0), 0)).toBe(12);
    expect(cloud.steps[1].request).toMatchObject({ modelId: "seedance-2-5", params: { aspectRatio: "9:16", resolution: "480p", generateAudio: false } });
    expect(cloud.steps.find((s) => s.key === "mux")).toMatchObject({ after: ["film", "voice"], chain: [{ slot: "video" }, { slot: "audio" }], request: { modelId: "merge-audio-video" } });
    expect(() => mk.planClickToAd({ engine: "open", productId: product.id, styleId: "luxury" }, { product, script })).toThrow(/voice sample/);
    const open = mk.planClickToAd({ engine: "open", productId: product.id, styleId: "luxury", voiceSample: upload("s.png") }, { product, script });
    expect(open.steps.filter((s) => s.key.startsWith("shot")).map((s) => s.request.params?.duration)).toEqual([5, 5]);
    expect(open.steps.at(-1)!.request).toMatchObject({ modelId: "oss-captions-burnin", feature: "click-to-ad" });
    const presenter = mk.planClickToAd({ engine: "cloud", productId: product.id, styleId: "simple-ugc" }, { product, script });
    expect(presenter.steps.map((s) => s.key)).toEqual(["voice", "still", "talk", "captions", "broll", "film"]);
    expect(mk.clickToAdSeconds("cloud", true)).toEqual({ voice: 8, broll: 4 });
  });

  it("writes a script offline within the word budget", async () => {
    const product = brand.listProducts()[0];
    const s = await mk.clickToAdScript({ engine: "cloud", productId: product.id, styleId: "simple-ugc" });
    expect(s.by).toBe("rules");
    expect(s.script.split(" ").length).toBeLessThanOrEqual(20);
    expect(s.script).toContain(product.name);
  });
});

describe("Ad Multiplier", () => {
  const video = () => saveFile({ data: PNG, contentType: "video/mp4", name: "ad.mp4", source: "upload" }).url;

  it("recreates the whole ad: Kling with renumbered @images (keeps audio), Wan Animate + original sound on open", () => {
    const imgs = [upload("a.png"), upload("b.png")];
    const cloud = mk.planMultiplier({ engine: "cloud", video: video(), duration: 12, images: imgs, mode: "prompt", prompt: "Swap the bottle for @image_2", quality: "1080p" }, { higgsfield: false });
    expect(cloud.steps).toHaveLength(1);
    expect(cloud.steps[0].request).toMatchObject({ modelId: "kling-o3", op: "v2v", prompt: "Swap the bottle for @Image1", inputs: { images: [imgs[1], imgs[0]] }, params: { extra: { keep_audio: true } } });
    const open = mk.planMultiplier({ engine: "open", video: video(), duration: 12, images: imgs, mode: "prompt", prompt: "", quality: "1080p" }, { higgsfield: false });
    expect(open.steps.map((s) => [s.key, s.request.modelId])).toEqual([["edit", "oss-wan22-animate"], ["sound", "oss-mux"]]);
    expect(() => mk.planMultiplier({ engine: "open", video: video(), duration: 12, mode: "prompt", quality: "720p" }, { higgsfield: false })).toThrow(/Add an image/);
  });

  it("adds a hook and a CTA around the original (trimmed first), from the frames the browser grabbed", () => {
    const v = video();
    const plain = mk.planMultiplier({ engine: "cloud", video: v, duration: 20, mode: "sections", hook: "Wait for it", cta: "Shop today", quality: "720p", firstFrame: upload("f.png"), lastFrame: upload("l.png") }, { higgsfield: false });
    expect(plain.steps.map((s) => s.key)).toEqual(["hook", "cta", "film"]);
    const film = plain.steps.at(-1)!;
    expect(film.request.inputs).toEqual({ videos: [v] });
    expect(film.request.chain).toEqual([{ slot: "videos", position: "first" }, { slot: "videos", position: "last" }]);
    expect(plain.steps[0].request.prompt).toContain("“Wait for it”");

    const trimmed = mk.planMultiplier({ engine: "cloud", video: v, duration: 40, start: 5, end: 20, mode: "sections", cta: "Shop today", hook: null, quality: "720p" }, { higgsfield: false });
    expect(trimmed.steps.map((s) => s.key)).toEqual(["clip", "last", "cta", "film"]);
    expect(trimmed.steps[0].request).toMatchObject({ modelId: "trim-video", params: { startTime: 5, endTime: 20 } });
    expect(trimmed.steps.at(-1)).toMatchObject({ after: ["clip", "cta"], request: { inputs: undefined } });
    expect(() => mk.planMultiplier({ engine: "cloud", video: v, duration: 3, mode: "prompt", quality: "720p" }, { higgsfield: false })).toThrow("Video duration: 4-30 seconds");
  });

  it("prices a version per second and says what blocks it", async () => {
    const est = await (await multiplierEstimate.POST(json("POST", { engine: "cloud", video: video(), duration: 10, mode: "prompt", quality: "720p", versions: 2 }))).json();
    expect(est).toMatchObject({ runs: 2, demo: true, steps: [{ modelId: "kling-o3" }] });
    const bad = await (await multiplierEstimate.POST(json("POST", { engine: "cloud", video: video(), duration: 45, mode: "prompt", quality: "720p" }))).json();
    expect(bad.blocker).toBe("Video duration: 4-30 seconds");
  });

  it("makes versions in demo mode, runs them again with the same input, and saves a composed still", async () => {
    const res = await multiplierRoute.POST(json("POST", { engine: "cloud", video: video(), duration: 10, mode: "prompt", prompt: "Recreate this ad.", quality: "720p", versions: 2 }));
    expect(res.status).toBe(201);
    const { runs } = await res.json();
    expect(runs).toHaveLength(2);
    expect(runs[0].meta.input).toMatchObject({ mode: "prompt", versions: 1 });
    const again = await againRoute.POST(json("POST"), params({ id: runs[0].id }));
    expect(again.status).toBe(201);
    const next = (await again.json()).runs;
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe(runs[0].id);
    expect(next[0].title).toBe(runs[0].title);
    expect((await againRoute.POST(json("POST"), params({ id: "nope" }))).status).toBe(404);
    const list = await (await runsRoute.GET(json("GET", undefined, "http://x/api/marketing/runs?feature=ad-multiplier"))).json();
    expect(list.items.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([runs[0].id, runs[1].id, next[0].id]));

    const png = upload("composed.png");
    const saved = await composeRoute.POST(json("POST", { url: png, ratio: "9:16", text: "New headline · Shop now" }), params({ id: runs[0].id }));
    expect(saved.status).toBe(201);
    const g = await saved.json();
    expect(g).toMatchObject({ status: "succeeded", modelId: "local-ad-compose", prompt: "New headline · Shop now" });
    expect(g.outputs[0].url).toBe(png);
    expect((await composeRoute.POST(json("POST", { url: "https://x.example/a.png", ratio: "9:16" }), params({ id: runs[0].id }))).status).toBe(400);
  });
});

describe("Ads Studio", () => {
  let brandId = "";
  let products: { id: string; name: string }[] = [];

  beforeAll(async () => {
    const b = await brand.createManualBrand({ description: "Dew Theory — fragrance-free barrier creams for sensitive skin." });
    brandId = b.id;
    products = [
      brand.createProduct({ name: "Barrier Cream", brandId, sellingPoints: ["Calms redness overnight", "Fragrance-free"], price: 34, currency: "EUR", images: [upload()] }),
      brand.createProduct({ name: "Night Serum", brandId, sellingPoints: ["Repairs while you sleep"], images: [upload()] }),
    ];
  });

  it("writes varied ad copy offline, one angle after another", () => {
    const b = brand.getBrand(brandId)!;
    const p = brand.getProduct(products[0].id)!;
    const c = ads.heuristicConcepts(b, p, 6, "winter sale");
    expect(c.map((x) => x.angle)).toEqual(["benefit", "pain-point", "real-life", "offer", "material", "how-to"]);
    expect(c[0].headline).toBe("Calms redness overnight");
    expect(c[3].headline).toBe("Barrier Cream, just EUR 34");
    expect(c.every((x) => x.visual.includes("winter sale"))).toBe(true);
    expect(new Set(c.map((x) => x.headline)).size).toBe(6);
    // A partial LLM answer is completed by the rules.
    const merged = ads.conceptsFrom('{"ads":[{"angle":"offer","headline":"Calm skin, 20% off","body":"This week only.","cta":"Get it","visual":"Cream on a frosted window sill"}]}', c.slice(0, 2));
    expect(merged[0]).toEqual({ angle: "offer", headline: "Calm skin, 20% off", body: "This week only.", cta: "Get it", visual: "Cream on a frosted window sill" });
    expect(merged[1]).toEqual(c[1]);
  });

  it("prices a run first, then fills the grid as ads render (copy, then one picture per ad)", async () => {
    const items = [
      { productId: products[0].id, count: 3 },
      { productId: products[1].id, count: 2 },
    ];
    const est = await (await adsEstimate.POST(json("POST", { brandId, engine: "open", items }))).json();
    expect(est).toMatchObject({ route: "fuobe", modelId: "oss-qwen-edit", total: 5, demo: true });
    const { batchId, creatives, run } = ads.createBatch({ brandId, engine: "open", items });
    expect(creatives).toHaveLength(5);
    expect(creatives.every((c) => c.status === "writing")).toBe(true);
    await run;
    const written = ads.listCreatives({ brandId, batchId });
    expect(written.every((c) => c.headline && c.generationId)).toBe(true);
    const g = await settle(written[0].generationId!);
    expect(g.request).toMatchObject({ feature: "ads", modelId: "oss-qwen-edit", op: "edit" });
    expect(g.request.prompt).toMatch(/No text, letters/);
    for (const c of written) await settle(c.generationId!);
    const ready = await (await creativesRoute.GET(json("GET", undefined, `http://x/api/ads/creatives?brand=${brandId}&batch=${batchId}`))).json();
    expect(ready.items.every((c: { status: string; image: string }) => c.status === "ready" && c.image.startsWith("/api/files/"))).toBe(true);

    const first = ready.items[0];
    const edited = await (await creativeRoute.PATCH(json("PATCH", { headline: "Calm, finally", layout: "band" }), params({ id: first.id }))).json();
    expect(edited).toMatchObject({ headline: "Calm, finally", layout: "band" });
    const png = saveFile({ data: PNG, contentType: "image/png", name: "ad.png", source: "upload" }).url;
    const saved = await (await saveRoute.POST(json("POST", { url: png, ratio: "4:5" }), params({ id: first.id }))).json();
    expect(saved.generation).toMatchObject({ modelId: "local-ad-compose", feature: "ads", status: "succeeded", provider: "local" });
    expect(getModel("local-ad-compose")?.routes[0].provider).toBe("local");
    const retried = await ads.retryCreative(first.id);
    expect(retried.generationId).not.toBe(first.generationId);
    expect((await creativeRoute.DELETE(json("DELETE"), params({ id: first.id }))).status).toBe(204);
  }, 120_000);

  it("chats offline: a request becomes a proposal to confirm, which starts a batch", async () => {
    const res = await chatRoute.POST(json("POST", { text: "Make 3 ads for @Night Serum with a holiday theme" }), params({ id: brandId }));
    const { messages } = await res.json();
    const reply = messages.at(-1);
    expect(reply.proposal).toEqual({ items: [{ productId: products[1].id, count: 3 }], direction: "with a holiday theme" });
    expect(reply.text).toBe("Here's the plan: 3 ads for Night Serum — with a holiday theme. Create them?");
    expect(ads.offlineProposal("Make 2 playful ads for @Night Serum", products)).toEqual({ count: 2, productIds: [products[1].id], direction: "playful" });
    expect(ads.offlineProposal("Write five ad variations with different CTAs", products)).toMatchObject({ count: 5, productIds: [], direction: "with different CTAs" });
    expect(ads.offlineProposal("Generate 4 ads for my product", products)).toMatchObject({ count: 4, direction: "" });
    const question = await (await chatRoute.POST(json("POST", { text: "What's our tone?" }), params({ id: brandId }))).json();
    expect(question.messages.at(-1).proposal).toBeNull();
    const ok = await confirmRoute.POST(json("POST", { messageId: reply.id, engine: "cloud" }), params({ id: brandId }));
    expect(ok.status).toBe(201);
    const { batchId } = await ok.json();
    expect(ads.listCreatives({ brandId, batchId })).toHaveLength(3);
    expect((await confirmRoute.POST(json("POST", { messageId: reply.id, engine: "cloud" }), params({ id: brandId }))).status).toBe(422);
    expect(ads.offlineProposal("hello there", [])).toBeNull();
    expect(ads.mentionedProducts("try @night_serum and @Barrier Cream", products)).toEqual([products[0].id, products[1].id]);
  });

  it("deleting a brand takes its kit, products and ads off the shelf", async () => {
    expect((await brandRoute.DELETE(json("DELETE"), params({ id: brandId }))).status).toBe(204);
    expect(brand.getBrand(brandId)).toBeNull();
    expect(brand.listProducts(brandId)).toHaveLength(0);
    expect(ads.listCreatives({ brandId })).toHaveLength(0);
  });
});
