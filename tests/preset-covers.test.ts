import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import { SOUL_LOOK_CARDS } from "@/lib/catalog/soul-looks.generated";
import { toPresetCard } from "@/lib/preset-card-data";
import { isCover } from "@/lib/preset-cards";
import { presetCover, thumbOf } from "@/lib/preset-covers";
import { PRESET_COVERS } from "@/lib/preset-covers.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";

/*
 * The real covers manifest (src/lib/preset-previews.generated.ts, written by pnpm eval:covers) against the files
 * in public/previews, unmocked: an entry committed without its files, or files without their entry, fails here
 * rather than as broken images on the cards. tests/preset-cards.test.ts covers the logic with a mocked manifest.
 */

const root = process.cwd();
const entries = Object.entries(PRESET_PREVIEWS);

describe("the preset covers manifest", () => {
  it("lists catalog presets (or Soul looks) only, in the order the generator writes them", () => {
    const ids = new Set([...APPS, ...MOTIONS, ...EFFECTS].map((p) => p.id).concat(SOUL_LOOK_CARDS.map((l) => l.id)));
    const keys = entries.map(([k]) => k);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    for (const k of keys) expect(ids.has(k), `${k} is a preset or Soul look`).toBe(true);
  });

  it("points every entry at a JPEG poster (and an MP4 clip) that exists and isn't empty, with its provenance", () => {
    for (const [id, e] of entries) {
      expect(e.poster, id).toMatch(/^\/previews\/[a-z0-9-]+\/[^/]+\.jpg$/);
      if (e.video !== undefined) expect(e.video, id).toMatch(/^\/previews\/[a-z0-9-]+\/[^/]+\.mp4$/);
      for (const url of [e.poster, e.video].filter((u): u is string => !!u)) {
        expect(fs.statSync(path.join(root, "public", url), { throwIfNoEntry: false })?.size, url).toBeGreaterThan(0);
      }
      expect(typeof e.run === "string" && e.run.length > 0, `${id} names its run`).toBe(true);
      expect(typeof e.engine === "string" && e.engine.length > 0, `${id} names its engine`).toBe(true);
    }
  });

  it("leaves no cover file in public/previews that no entry names (with its poster's small copy for the pickers)", () => {
    const named = new Set(entries.flatMap(([, e]) => [e.poster, thumbOf(e.poster), e.video].filter(Boolean)));
    const dir = path.join(root, "public", "previews");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(jpg|mp4)$/.test(f)) : [];
    const orphans = files.map((f) => `/previews/${f.replaceAll("\\", "/")}`).filter((u) => !named.has(u));
    expect(orphans).toEqual([]);
  });

  // Every one of the 255 effects is getting a hover clip (about 50 bytes of card data each), so the budget is
  // sized for all of them, not for today's count.
  it("shows each cover on its card, and keeps the effects gallery's card data under 100 KB with them", () => {
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) {
      const c = toPresetCard(p);
      const e = PRESET_PREVIEWS[p.id];
      expect(isCover(c.preview), p.id).toBe(!!e);
      if (e) expect([c.preview.poster, c.preview.video], p.id).toEqual([e.poster, e.video]);
    }
    expect(JSON.stringify(EFFECTS.map(toPresetCard)).length).toBeLessThan(100_000);
  });

  it("gives the pickers every cover through the slim map, with the same files, and nothing else", () => {
    // Written with the manifest by pnpm eval:covers (scripts/eval/lib/covers.mjs): a manifest changed without it fails here.
    expect(Object.keys(PRESET_COVERS)).toEqual(entries.map(([k]) => k));
    for (const [id, e] of entries) expect(presetCover(id), id).toEqual({ poster: e.poster, thumb: thumbOf(e.poster), ...(e.video && { video: e.video }) });
    // Save 3D Rotation, which shows the 3D Rotation app's turntable shot (tests/picker-covers.test.ts).
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) if (!PRESET_PREVIEWS[p.id] && p.id !== "motion-3d-rotation") expect(presetCover(p.id), p.id).toBeUndefined();
    for (const id of [undefined, "", "toString", "constructor", "__proto__"]) expect(presetCover(id), String(id)).toBeUndefined();
  });

  it("is read only on the server and in the preset header's own chunk", () => {
    // Client chunks keep whatever client code uses from a module. preset-cards.ts is in the galleries',
    // home's, shorts' and mixed media's chunks, so importing the manifest there (or preset-card-data.ts,
    // which does) would ship it to all of them. A new importer belongs here only if it's a server page
    // or loaded on its own (next/dynamic), like the preset header.
    const sources = fs
      .readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => ({ file: f.replaceAll("\\", "/"), text: fs.readFileSync(path.join(root, "src", f), "utf8") }));
    const importers = (spec: RegExp) =>
      sources
        .filter((s) => spec.test(s.text))
        .map((s) => s.file)
        .sort();
    expect(importers(/from "[^"]*preset-previews\.generated"/)).toEqual(["lib/preset-card-data.ts"]);
    expect(importers(/from "[^"]*preset-card-data"/)).toEqual([
      "app/(studio)/apps/page.tsx",
      "app/(studio)/effects/page.tsx",
      "app/(studio)/motions/page.tsx",
      "app/(studio)/page.tsx",
      "components/preset-header.tsx",
    ]);
    // The slim map (which presets have a cover, and a clip: a few KB) is for the pickers, each in its own chunk: the
    // camera motion and Mix pickers (next/dynamic in composer.tsx) and Cinema Studio's moves (next/dynamic in
    // camera-moves.tsx, loaded when the "#" picker or the Director panel's Movement tab shows them).
    expect(importers(/from "[^"]*preset-covers\.generated"/)).toEqual(["lib/preset-covers.ts"]);
    // (A type is no code: the cover tile takes a cover without importing the map.)
    expect(importers(/^import (?!type )[^;]*from "[^"]*preset-covers";/m)).toEqual(["components/cinema/move-list.tsx", "components/studio/preset-chips.tsx"]);
    const composer = fs.readFileSync(path.join(root, "src", "components", "studio", "composer.tsx"), "utf8");
    expect(composer).toMatch(/dynamic\(\(\) => import\("\.\/preset-chips"\)/);
    expect(importers(/from "[^"]*\/move-list"/)).toEqual([]);
    const moves = fs.readFileSync(path.join(root, "src", "components", "cinema", "camera-moves.tsx"), "utf8");
    expect(moves).toMatch(/dynamic\(\(\) => import\("\.\/move-list"\)/);
    const header = fs.readFileSync(path.join(root, "src", "components", "studio", "studio-page.tsx"), "utf8");
    expect(header).toMatch(/dynamic\(\(\) => import\("@\/components\/preset-header"\)/);
  });

  it("serves the covers with a day's cache, revalidated in the background (their names stay when a cover is made again)", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toContainEqual({ source: "/previews/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] });
  });
});
