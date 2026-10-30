import { paletteIndex } from "@/lib/palette-index";
import { handler } from "@/server/access/route";

/**
 * The ⌘K palette's catalog: apps, camera motions, effects and models, slim (names, categories, where
 * each opens). Static, so it's prerendered at build time; the palette loads it once, on first open.
 */
export const GET = handler({ access: "signed-in" }, async () => {
  return Response.json(paletteIndex());
});
