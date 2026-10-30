import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import MANIFEST from "@/lib/catalog/preview-media.generated.json";
import { isStill, kindOf, mediaHash, POSTER_WIDTHS, previewSrc, WEBP_WIDTH, type PreviewKind, type PreviewManifest } from "@/lib/preview-media";

const root = path.resolve(__dirname, "..");

/** Every file of a preset's media, as URLs. */
const urlsOf = (kind: PreviewKind, id: string, hash: string) => {
  const src = previewSrc(kind, id, hash);
  return [...src.avifSrcSet.split(", ").map((s) => s.split(" ")[0]), src.webpSrc, ...(src.mp4Src ? [src.mp4Src] : [])];
};

describe("preview media files", () => {
  it("files each preset's media under its type", () => {
    for (const p of MOTIONS) expect(kindOf(p.id), p.id).toBe("motions");
    for (const p of EFFECTS) expect(kindOf(p.id), p.id).toBe("effects");
    for (const p of APPS) expect(kindOf(p.id), p.id).toBe("apps");
    for (const id of ["look-anime", "motion", "motion-", "Motion-Zoom", "app-../x", "constructor-x"]) expect(kindOf(id), id).toBeUndefined();
  });

  it("names the poster sizes and the clip after the preset and its hash", () => {
    expect(previewSrc("effects", "effect-set-on-fire", "0123abcd")).toEqual({
      avifSrcSet:
        "/previews/effects/effect-set-on-fire.0123abcd.320.avif 320w, /previews/effects/effect-set-on-fire.0123abcd.480.avif 480w, /previews/effects/effect-set-on-fire.0123abcd.640.avif 640w",
      webpSrc: "/previews/effects/effect-set-on-fire.0123abcd.480.webp",
      mp4Src: "/previews/effects/effect-set-on-fire.0123abcd.mp4",
    });
  });

  it("gives a still (hash + s) its poster files and no clip", () => {
    expect(isStill("0123abcds")).toBe(true);
    expect(isStill("0123abcd")).toBe(false);
    expect(isStill("0123abcdx")).toBe(false);
    expect(previewSrc("apps", "app-relight", "0123abcds")).toEqual({
      avifSrcSet:
        "/previews/apps/app-relight.0123abcd.320.avif 320w, /previews/apps/app-relight.0123abcd.480.avif 480w, /previews/apps/app-relight.0123abcd.640.avif 640w",
      webpSrc: "/previews/apps/app-relight.0123abcd.480.webp",
    });
  });

  it("names the files the build script writes", () => {
    // scripts/build-previews.mjs can't import this module, so it repeats the rules: keep them in step.
    const script = fs.readFileSync(path.join(root, "scripts/build-previews.mjs"), "utf8");
    expect(/const POSTER_WIDTHS = \[([\d, ]+)\];/.exec(script)?.[1]).toBe(POSTER_WIDTHS.join(", "));
    expect(/const WEBP_WIDTH = (\d+);/.exec(script)?.[1]).toBe(String(WEBP_WIDTH));
    expect(script).toContain('const KINDS = { motion: "motions", effect: "effects", app: "apps" };');
  });

  it("reads the manifest only on the server and in the preset header's own chunk", () => {
    // Client chunks keep whatever client code uses from a module. preset-cards.ts is in the galleries',
    // home's, shorts' and mixed media's chunks, so importing the manifest there (or preset-card-data.ts,
    // which does) would ship it to all of them. A new importer belongs here only if it's a server page
    // or loaded on its own (next/dynamic), like the preset header.
    const importers = (spec: RegExp) =>
      fs
        .readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f) && spec.test(fs.readFileSync(path.join(root, "src", f), "utf8")))
        .map((f) => f.replaceAll("\\", "/"))
        .sort();
    expect(importers(/from "[^"]*preview-media\.generated\.json"/)).toEqual(["lib/preset-card-data.ts"]);
    expect(importers(/from "[^"]*preset-card-data"/)).toEqual([
      "app/(studio)/apps/page.tsx",
      "app/(studio)/effects/page.tsx",
      "app/(studio)/motions/page.tsx",
      "app/(studio)/page.tsx",
      "components/preset-header.tsx",
    ]);
  });

  it("looks a preset's hash up in the manifest", () => {
    const manifest: PreviewManifest = { motions: { "motion-zoom-in": "89abcdef" } };
    expect(mediaHash(manifest, "motion-zoom-in")).toBe("89abcdef");
    expect(mediaHash(manifest, "motion-zoom-out")).toBeUndefined();
    expect(mediaHash(manifest, "effect-zoom-in")).toBeUndefined();
    expect(mediaHash({}, "app-relight")).toBeUndefined();
  });

  it("lists only catalog presets whose files are all in public/previews, sorted", () => {
    const manifest: PreviewManifest = MANIFEST;
    const ids = new Set([...MOTIONS, ...EFFECTS, ...APPS].map((p) => p.id));
    const kinds = Object.keys(manifest);
    expect(kinds).toEqual([...kinds].sort());
    for (const [kind, entries] of Object.entries(manifest) as [PreviewKind, Record<string, string>][]) {
      expect(Object.keys(entries)).toEqual(Object.keys(entries).sort());
      for (const [id, hash] of Object.entries(entries)) {
        expect(ids.has(id), `${id} is in the catalog`).toBe(true);
        expect(kindOf(id), id).toBe(kind);
        expect(hash, id).toMatch(/^[0-9a-f]{8}s?$/);
        for (const url of urlsOf(kind, id, hash)) expect(fs.statSync(path.join(root, "public", url), { throwIfNoEntry: false })?.size, url).toBeGreaterThan(0);
      }
    }
  });

  it("serves the files as immutable (their names change with their content)", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toContainEqual({ source: "/previews/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] });
  });
});
