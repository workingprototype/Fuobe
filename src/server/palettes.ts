import "server-only";
import { nanoid } from "nanoid";
import { MODELS } from "@/lib/catalog";
import { PALETTES as CINEMA_PALETTES } from "@/lib/catalog/cinema";
import { MAX_COLORS_RECRAFT, MAX_COLORS, normalizeHex, paletteError, type Palette, type PaletteSource, type SignatureCaps } from "@/lib/catalog/palettes";
import type { GenerationRequest } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";

/**
 * Colour signatures: the user's palettes plus the 50 Cinema Studio 4.0 palettes (seeded once, so the
 * library is shared with Cinema Studio's colour grades and its slugs stay valid for cinema-studio-4).
 */

interface Row {
  id: string;
  name: string;
  colors_json: string;
  background: string | null;
  slug: string | null;
  source: PaletteSource;
  thumb_url: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

const toPalette = (r: Row): Palette => ({
  id: r.id,
  name: r.name,
  colors: JSON.parse(r.colors_json) as string[],
  background: r.background,
  slug: r.slug,
  source: r.source,
  thumb: r.thumb_url,
  createdAt: r.created_at,
});

/** The built-ins as rows: Cinema Studio's 12 colours, the 12th also the background (Higgsfield's shape). */
export function builtinPalettes(): Omit<Palette, "createdAt">[] {
  return CINEMA_PALETTES.map((p) => {
    const colors = p.hex.map((h) => normalizeHex(h)!);
    return { id: `builtin-${p.slug}`, name: p.name, colors, background: colors[colors.length - 1], slug: p.slug, source: "builtin" as const, thumb: null };
  });
}

declare global {
  var __fuobePalettesSeeded: boolean | undefined;
}

/** Seed (or top up) the built-in palettes; cheap after the first call in a process. */
function ensureBuiltins(): void {
  if (globalThis.__fuobePalettesSeeded) return;
  const now = Date.now();
  const insert = db().prepare(
    `INSERT OR IGNORE INTO palettes (id, name, colors_json, background, slug, source, thumb_url, position, created_at, updated_at)
     VALUES (@id, @name, @colors_json, @background, @slug, 'builtin', NULL, @position, @now, @now)`,
  );
  db().transaction(() => {
    builtinPalettes().forEach((p, i) => insert.run({ id: p.id, name: p.name, colors_json: JSON.stringify(p.colors), background: p.background, slug: p.slug, position: i, now }));
  })();
  globalThis.__fuobePalettesSeeded = true;
}

/** Your palettes (newest first), then the built-ins in Cinema Studio's order. */
export function listPalettes(): Palette[] {
  ensureBuiltins();
  const rows = db().prepare("SELECT * FROM palettes ORDER BY CASE source WHEN 'builtin' THEN 1 ELSE 0 END, CASE source WHEN 'builtin' THEN position ELSE -created_at END").all() as Row[];
  return rows.map(toPalette);
}

export function getPalette(id: string): Palette | null {
  ensureBuiltins();
  const r = db().prepare("SELECT * FROM palettes WHERE id = ?").get(id) as Row | undefined;
  return r ? toPalette(r) : null;
}

export function createPalette(input: { name: string; colors: string[]; background?: string | null; source?: "manual" | "images"; thumb?: string | null }): Palette {
  const colors = input.colors.map((c) => normalizeHex(c)).filter((c): c is string => !!c);
  const background = input.background ? normalizeHex(input.background) : null;
  if (colors.length !== input.colors.length) throw new Error(`${input.colors.find((c) => !normalizeHex(c))} isn't a colour — use #RRGGBB`);
  const err = paletteError({ name: input.name, colors, background });
  if (err) throw new Error(err);
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: input.name.trim(),
    colors_json: JSON.stringify(colors),
    background,
    slug: null,
    source: input.source ?? "manual",
    thumb_url: input.thumb ?? null,
    position: 0,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      `INSERT INTO palettes (id, name, colors_json, background, slug, source, thumb_url, position, created_at, updated_at)
       VALUES (@id, @name, @colors_json, @background, @slug, @source, @thumb_url, @position, @created_at, @updated_at)`,
    )
    .run(row);
  return toPalette(row);
}

export function renamePalette(id: string, name: string): Palette {
  const cur = getPalette(id);
  if (!cur) throw new Error("Palette not found");
  if (cur.source === "builtin") throw new Error("Built-in palettes can't be renamed");
  const err = paletteError({ name, colors: cur.colors });
  if (err) throw new Error(err);
  db().prepare("UPDATE palettes SET name = ?, updated_at = ? WHERE id = ?").run(name.trim(), Date.now(), id);
  return getPalette(id)!;
}

/** Delete one of your palettes (built-ins stay). Returns false when there was none. */
export function deletePalette(id: string): boolean {
  const cur = getPalette(id);
  if (!cur) return false;
  if (cur.source === "builtin") throw new Error("Built-in palettes can't be deleted");
  db().prepare("DELETE FROM palettes WHERE id = ?").run(id);
  return true;
}

/** Which models take a palette natively, how many colours, and their background field (from the field maps). */
export function signatureCaps(): SignatureCaps {
  const native: SignatureCaps["native"] = {};
  for (const m of MODELS) {
    const maps = m.routes.map((r) => r.map?.palette).filter((p): p is NonNullable<typeof p> => !!p);
    if (!maps.length) continue;
    native[m.id] = { max: m.family === "recraft" ? MAX_COLORS_RECRAFT : MAX_COLORS, ...(maps.every((p) => p.background) && { background: maps[0].background }) };
  }
  return { native };
}

/**
 * The open palette lock: each image the request makes is recoloured to the palette afterwards by
 * oss-palette-image (a colour transfer to a swatch rendered from the hex list). One two-step chain
 * per image, all in one batch.
 */
export function createLockedRun(request: GenerationRequest, colors: string[], strength = 0.8) {
  const hex = colors.map((c) => normalizeHex(c)).filter((c): c is string => !!c);
  if (!hex.length) throw new Error("Pick a palette first");
  const n = Math.max(1, Math.min(4, request.params?.numOutputs ?? 1));
  const batchId = nanoid(10);
  const items = [];
  for (let i = 0; i < n; i++) {
    const step = n > 1 ? { label: `Image ${i + 1} of ${n}`, index: i, of: n } : undefined;
    const { items: made } = createPipeline(
      [
        { key: "image", request: { ...request, params: { ...request.params, numOutputs: 1 }, ...(step && { step }) } },
        {
          key: "lock",
          request: {
            feature: request.feature,
            modelId: "oss-palette-image",
            op: "color-match",
            prompt: "Palette lock",
            params: { palette: hex, extra: { strength } },
            step: { label: n > 1 ? `Palette lock ${i + 1} of ${n}` : "Palette lock", index: i, of: n },
          },
          after: "image",
          chain: [{ slot: "images", position: "first" }],
        },
      ],
      { batchId },
    );
    items.push(...made);
  }
  return { batchId, items };
}
