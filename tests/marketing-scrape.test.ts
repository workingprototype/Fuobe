import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  colorStats,
  extractColors,
  extractFonts,
  googleFonts,
  heuristicFields,
  heuristicManualKit,
  jsonLd,
  jsonLdProducts,
  matchLanguage,
  mergeKit,
  normalizeColor,
  normalizeWebsite,
  parseJsonObject,
  parseSite,
  productsFromPage,
  sellingPointsFrom,
  shopifyProducts,
  socialOf,
  softFieldsFrom,
} from "@/server/brand";
import { emptyKit } from "@/lib/catalog/marketing";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures/marketing", name), "utf8");
const HOME = fixture("shop-home.html");
const CSS = fixture("base.css");
const URL_ = "https://emberandoat.example/";

describe("brand research: reading a site (saved fixtures, no network)", () => {
  const facts = parseSite(HOME, URL_);

  it("reads the name, description, language and theme colour", () => {
    expect(facts.name).toBe("Ember & Oat");
    expect(facts.description).toMatch(/^Small-batch granola/);
    expect(facts.lang).toBe("en-gb");
    expect(facts.themeColor).toBe("#C2410C");
    expect(facts.shopify).toBe(true);
    expect(facts.organization?.description).toBe("Granola that tastes like a slow Sunday.");
  });

  it("finds the logo: JSON-LD first, then icons; an inline SVG logo is kept whole", () => {
    expect(facts.logos[0]).toBe("https://emberandoat.example/logo.png");
    expect(facts.logos).toContain("https://emberandoat.example/apple-touch-icon.png");
    expect(facts.svgLogo).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(facts.svgLogo).toContain("</svg>");
  });

  it("collects hero images and skips pixels, payment badges and duplicates", () => {
    expect(facts.images).toContain("https://emberandoat.example/cdn/shop/files/hero-granola.jpg?v=12");
    expect(facts.images).toContain("https://cdn.example-shop.com/hero-bowl.jpg");
    expect(facts.images).toContain("https://emberandoat.example/cdn/shop/products/maple-pecan.jpg");
    expect(facts.images.some((u) => /tracking-pixel|payment/.test(u))).toBe(false);
    expect(new Set(facts.images).size).toBe(facts.images.length);
  });

  it("finds socials from links and sameAs, once per network, never share links", () => {
    expect(facts.socials.map((s) => s.network).sort()).toEqual(["Instagram", "TikTok", "YouTube"]);
    expect(facts.socials.find((s) => s.network === "Instagram")?.url).toBe("https://www.instagram.com/emberandoat");
    expect(socialOf("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(socialOf("https://x.com/acme")).toEqual({ network: "X", url: "https://x.com/acme" });
  });

  it("lists stylesheets (not Google Fonts) and keeps inline CSS, headings and text", () => {
    expect(facts.stylesheets).toEqual(["https://emberandoat.example/cdn/shop/t/4/assets/base.css"]);
    expect(facts.inlineCss.join("")).toContain("--color-brand");
    expect(facts.headings[0]).toBe("Granola that tastes like a slow Sunday");
    expect(facts.text).toContain("Roasted in small batches");
    expect(facts.text).not.toContain("<svg");
  });

  it("ranks brand colours: named brand variables and the theme colour first, a dark and a light neutral kept", () => {
    const colors = extractColors([...facts.inlineCss, CSS], facts.themeColor);
    expect(colors[0]).toBe("#c2410c");
    expect(colors).toContain("#0f766e");
    expect(colors.some((c) => colorStats(c).l < 0.18)).toBe(true);
    expect(colors.some((c) => colorStats(c).l > 0.92)).toBe(true);
    // Translucent overlays and shadows aren't brand colours.
    expect(colors).not.toContain("#000000");
    expect(colors.length).toBeLessThanOrEqual(6);
  });

  it("normalises CSS colour literals", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("rgb(194, 65, 12)")).toBe("#c2410c");
    expect(normalizeColor("hsl(174, 84%, 25%)")).toBe("#0a756b");
    expect(normalizeColor("rgba(0,0,0,.4)")).toBeNull();
    expect(normalizeColor("#00000033")).toBeNull();
    expect(normalizeColor("transparent")).toBeNull();
  });

  it("reads fonts from Google Fonts links, CSS variables and heading/body rules", () => {
    expect(googleFonts(HOME)).toEqual(["Fraunces", "Inter"]);
    const f = extractFonts(HOME, [CSS]);
    expect(f.heading).toBe("Fraunces");
    expect(f.body).toBe("Inter");
    expect(f.all).toContain("Ember Display");
    // System stacks are skipped.
    expect(extractFonts("", ["body{font-family:-apple-system,Segoe UI,Helvetica,sans-serif}"]).body).toBeUndefined();
  });
});

describe("products", () => {
  it("reads Shopify's products.json with prices, links and absolute image URLs", () => {
    const ps = shopifyProducts(JSON.parse(fixture("products.json")), "https://emberandoat.example");
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({
      name: "Maple Pecan Granola",
      price: 12.5,
      url: "https://emberandoat.example/products/maple-pecan-granola",
      images: ["https://emberandoat.example/cdn/shop/products/maple-pecan.jpg", "https://cdn.example-shop.com/maple-pecan-2.jpg"],
      brand: "Ember & Oat",
    });
    // List items stay on their own lines, so each becomes its own selling point.
    expect(ps[0].description).toBe("Crunchy clusters of organic oats, Oregon pecans and dark maple syrup.\nVegan and gluten-free\nOnly 6 grams of sugar per serving");
    expect(sellingPointsFrom(ps[0].description)).toEqual(["Crunchy clusters of organic oats, Oregon pecans and dark maple syrup", "Vegan and gluten-free", "Only 6 grams of sugar per serving"]);
    expect(ps[1].price).toBe(9);
    // A single product's JSON (/products/<handle>.json) has the same shape under "product".
    expect(shopifyProducts({ product: { title: "One", images: [] } }, "https://x.example")[0].name).toBe("One");
  });

  it("reads a JSON-LD Product (array of blocks, typed list, offers, brand, mixed image forms)", () => {
    const html = fixture("product-page.html");
    const ps = jsonLdProducts(jsonLd(html), "https://dewtheory.example/products/barrier-cream");
    expect(ps).toEqual([
      {
        name: "Barrier Cream",
        description: "A fragrance-free cream that calms reactive skin. Dermatologist-tested.",
        price: 34,
        currency: "EUR",
        url: "https://dewtheory.example/products/barrier-cream",
        images: ["https://dewtheory.example/img/cream-front.jpg", "https://dewtheory.example/img/cream-back.jpg"],
        brand: "Dew Theory",
      },
    ]);
    expect(productsFromPage(html, "https://dewtheory.example/products/barrier-cream")[0].name).toBe("Barrier Cream");
  });

  it("falls back to OpenGraph product tags (European decimal price)", () => {
    const [p] = productsFromPage(fixture("og-only.html"), "https://bottles.example/trail");
    expect(p).toMatchObject({ name: "Trail Bottle 750 ml", price: 29.9, currency: "EUR", url: "https://bottles.example/trail", images: ["https://bottles.example/trail.jpg"] });
    expect(p.description).toMatch(/24 hours/);
  });

  it("pulls short selling points out of a description", () => {
    expect(sellingPointsFrom("Keeps drinks cold for 24 hours. Leak-proof lid! Made from recycled steel. Read our privacy policy.")).toEqual([
      "Keeps drinks cold for 24 hours",
      "Leak-proof lid!",
      "Made from recycled steel",
    ]);
  });
});

describe("brand fields: LLM answers, offline heuristics and the merge", () => {
  it("parses an LLM answer wrapped in chatter and code fences, dropping malformed fields", () => {
    const j = parseJsonObject('Sure! ```json\n{"name":"Ember & Oat","tone":["Warm","Honest",""],"colors":["#c2410c","nope"],"language":"en","sellingPoints":"Free shipping; Vegan","products":[{"name":"Maple Pecan Granola","sellingPoints":["Crunchy"]},{"oops":1}]}\n``` hope that helps');
    const s = softFieldsFrom(j);
    expect(s.name).toBe("Ember & Oat");
    expect(s.tone).toEqual(["Warm", "Honest"]);
    expect(s.colors).toEqual(["#c2410c"]);
    expect(s.language).toBe("English");
    expect(s.sellingPoints).toEqual(["Free shipping", "Vegan"]);
    expect(s.products).toEqual([{ name: "Maple Pecan Granola", audience: undefined, sellingPoints: ["Crunchy"] }]);
    expect(parseJsonObject("no json here")).toBeNull();
    expect(softFieldsFrom(null)).toEqual({});
  });

  it("builds soft fields offline from the page text", () => {
    const facts = parseSite(HOME, URL_);
    const h = heuristicFields(facts, ["#c2410c", "#1c1917", "#ffffff"], { heading: "Fraunces" });
    expect(h.tagline).toBe("Small-batch granola and nut butters, slow-roasted in Portland");
    expect(h.values).toEqual(expect.arrayContaining(["Sustainability", "Craftsmanship"]));
    expect(h.sellingPoints).toEqual(expect.arrayContaining(["Free shipping over $40", "30-day money-back guarantee", "Vegan"]));
    expect(h.aesthetics).toContain("Classic serif typography");
    expect(h.language).toBe("English");
  });

  it("merges: the LLM wins field by field, code-read facts win for logo/colours/fonts, empty answers never erase", () => {
    const base = { ...emptyKit("Emberandoat"), details: ["Ships from Oregon"] };
    const merged = mergeKit(
      base,
      { name: "Ember & Oat", website: URL_, logo: "/api/files/uploads/x/logo.svg", colors: ["#c2410c", "#0f766e"], fonts: { heading: "Fraunces", body: "Inter" }, socials: [], images: ["/api/files/uploads/x/a.jpg"] },
      { tagline: "From the rules", tone: ["Friendly"], values: ["Quality"], language: "English" },
      { name: "", tagline: "Granola for slow Sundays", tone: [], values: ["Craft", "Community"], colors: ["#000000"], fonts: { heading: "Lobster" } },
    );
    expect(merged.name).toBe("Ember & Oat");
    expect(merged.tagline).toBe("Granola for slow Sundays");
    expect(merged.tone).toEqual(["Friendly"]);
    expect(merged.values).toEqual(["Craft", "Community"]);
    expect(merged.colors).toEqual(["#c2410c", "#0f766e"]);
    expect(merged.fonts).toEqual({ heading: "Fraunces", body: "Inter" });
    expect(merged.logo).toBe("/api/files/uploads/x/logo.svg");
    expect(merged.details).toEqual(["Ships from Oregon"]);
  });

  it("makes a manual kit from a description with no LLM (name, look by category)", () => {
    const k = heuristicManualKit("Dew Theory — fragrance-free barrier creams for sensitive skin, sold direct online.");
    expect(k.name).toBe("Dew Theory");
    expect(k.overview).toMatch(/^Dew Theory/);
    expect(k.colors).toHaveLength(4);
    expect(k.fonts?.heading).toBe("Cormorant Garamond");
    expect(k.tone).toContain("Gentle");
  });

  it("matches languages and websites", () => {
    expect(matchLanguage("de-DE")).toBe("German");
    expect(matchLanguage("Japanese")).toBe("Japanese");
    expect(matchLanguage("klingon")).toBeUndefined();
    expect(normalizeWebsite("acme.com")).toBe("https://acme.com/");
    expect(normalizeWebsite("http://shop.acme.co.uk/path")).toBe("http://shop.acme.co.uk/path");
    expect(normalizeWebsite("not a site")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
    expect(normalizeWebsite("ftp://acme.com")).toBeNull();
  });
});
