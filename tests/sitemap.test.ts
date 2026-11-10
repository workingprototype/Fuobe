import { describe, expect, it, vi } from "vitest";

const forwarded = new Headers({ host: "127.0.0.1:3000", "x-forwarded-host": "studio.example.com", "x-forwarded-proto": "https" });
vi.mock("next/headers", () => ({ headers: async () => forwarded }));

const { default: sitemap } = await import("@/app/sitemap");
const { default: robots } = await import("@/app/robots");
const { default: manifest } = await import("@/app/manifest");
const { default: nextConfig } = await import("../next.config");

describe("what search engines are given", () => {
  it("lists the public pages once each, on the address the request came to", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls[0]).toBe("https://studio.example.com");
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith("https://studio.example.com")).toBe(true);
    const paths = urls.map((u) => new URL(u).pathname);
    for (const p of ["/image", "/video", "/edit", "/apps", "/terms", "/privacy"]) expect(paths).toContain(p);
    expect(paths.some((p) => p.startsWith("/apps/app-"))).toBe(true);
  });

  it("never lists anyone's own pages, a hand-off link, or a page that redirects", async () => {
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    for (const p of paths) expect(p).not.toMatch(/^\/(api|settings|library|chat|login|connect)(\/|$)|\/start\//);
    const redirects = (await nextConfig.redirects?.()) ?? [];
    // Only a redirect that always applies (one with `has`/`missing` needs a query the sitemap's links don't carry).
    for (const r of redirects.filter((x) => !("has" in x && x.has) && !("missing" in x && x.missing))) {
      const re = new RegExp(`^${r.source.replace(/:(\w+)\(([^)]+)\)/g, "($2)").replace(/:(\w+)/g, "[^/]+")}$`);
      for (const p of paths) expect(re.test(p), `${p} redirects (${r.source})`).toBe(false);
    }
  });

  it("robots.txt names the sitemap and keeps the API and people's own pages out", async () => {
    const r = await robots();
    expect(r.sitemap).toBe("https://studio.example.com/sitemap.xml");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/settings", "/library"]));
  });

  it("the manifest names Fuobe with its icons", () => {
    const m = manifest();
    expect(m.name).toBe("Fuobe");
    expect(m.icons?.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});
