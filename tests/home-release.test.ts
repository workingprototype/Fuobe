import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Home's latest-release section (HOME_RELEASE in src/lib/home-showcase.ts, ReleaseSection in home-sections.tsx): every
 * picture has its files in public/ and its prompt, and every tile opens the Image studio on the model with that prompt
 * filled in, without starting a run.
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { ReleaseSection } = await import("@/components/home/home-sections");
const { HOME_RELEASE, releaseArtSrc, releaseHref, releasePill } = await import("@/lib/home-showcase");
const { START_PARAM } = await import("@/lib/composer");

const root = process.cwd();
const size = (url: string) => fs.statSync(path.join(root, "public", url), { throwIfNoEntry: false })?.size ?? 0;
const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

describe("Home's latest release", () => {
  it("names the model, its vendor, its day and its line", () => {
    expect(HOME_RELEASE.modelId).toMatch(/^oss-[a-z0-9-]+$/);
    expect(HOME_RELEASE.name).toContain(HOME_RELEASE.vendor);
    expect(HOME_RELEASE.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(releasePill()).toBe("Day-0 release · 10 Nov");
    expect(releasePill("2027-01-03")).toBe("Day-0 release · 3 Jan");
    expect(HOME_RELEASE.line.length).toBeGreaterThan(40);
  });

  it("has every picture's files, shape and prompt, each picture once", () => {
    const slugs = HOME_RELEASE.art.map((a) => a.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(8);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of HOME_RELEASE.art) {
      for (const [w, ext] of [[480, "avif"], [960, "avif"], [480, "webp"]] as const) {
        expect(size(releaseArtSrc(a.slug, w, ext)), releaseArtSrc(a.slug, w, ext)).toBeGreaterThan(0);
      }
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      expect(a.prompt.trim().length, a.slug).toBeGreaterThan(40);
      expect(a.label.trim().length, a.slug).toBeGreaterThan(0);
    }
    // Every file in the folder is one of the pictures: none left behind by an earlier release.
    const dir = path.join(root, "public", HOME_RELEASE.dir);
    for (const f of fs.readdirSync(dir)) expect(slugs, f).toContain(f.split(".")[0]);
  });

  it("opens the studios on the model, a tile with its prompt filled in and no run started", () => {
    const tile = new URL(releaseHref("image", HOME_RELEASE.art[0].prompt), "https://x.test");
    expect(tile.pathname).toBe("/image");
    expect(tile.searchParams.get("model")).toBe(HOME_RELEASE.modelId);
    expect(tile.searchParams.get("prompt")).toBe(HOME_RELEASE.art[0].prompt);
    expect(tile.searchParams.has(START_PARAM)).toBe(false);
    expect(releaseHref("image")).toBe(`/image?model=${HOME_RELEASE.modelId}`);
    expect(releaseHref("edit")).toBe(`/edit?model=${HOME_RELEASE.modelId}`);
  });

  it("renders each picture as a named link with its prompt, its loop copy out of reach", () => {
    const html = render(createElement(ReleaseSection));
    expect(html).toContain(releasePill());
    expect(html).toContain(`>${HOME_RELEASE.name}</h2>`);
    expect(decode(html)).toContain(`href="${releaseHref("image")}"`);
    expect(decode(html)).toContain(`href="${releaseHref("edit")}"`);
    const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
    const tiles = [...html.matchAll(/<li([^>]*)>(<a [^>]*>)/g)].map((m) => [m[0], m[1], attr(m[2], "href"), attr(m[2], "aria-label")]);
    // Each picture twice: once to reach, once for the loop (hidden from screen readers and the keyboard).
    expect(tiles).toHaveLength(HOME_RELEASE.art.length * 2);
    const reachable = tiles.filter((t) => !t[1].includes("inert"));
    expect(reachable).toHaveLength(HOME_RELEASE.art.length);
    for (const t of tiles.filter((t) => t[1].includes("inert"))) expect(t[1]).toContain('aria-hidden="true"');
    for (const a of HOME_RELEASE.art) {
      const t = reachable.find((r) => decode(r[3]) === `Make your own: ${a.label}`);
      expect(t, a.slug).toBeDefined();
      expect(decode(t![2])).toBe(releaseHref("image", a.prompt));
    }
  });
});
