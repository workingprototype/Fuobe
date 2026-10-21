import { connection } from "next/server";
import { presetFallback } from "@/lib/catalog/packs";
import { higgsfieldKey, higgsfieldPresets } from "@/server/providers/higgsfield";

/**
 * Soul styles, Genjutsu looks and Marketing Studio templates, straight from Higgsfield. Soul and
 * Soul 2.0 fall back to the researched list (same ids, with categories) when there's no key or the
 * live list fails, so the picker always works and the id is right once a key is added.
 */
export async function GET(request: Request) {
  await connection();
  const source = new URL(request.url).searchParams.get("source") ?? "";
  const fallback = presetFallback(source);
  if (!higgsfieldKey()) {
    if (fallback) return Response.json({ ...fallback, fallback: true, note: "Built-in list · add a Higgsfield key in Settings for previews" });
    return Response.json({ items: [], error: "Add a Higgsfield API key in Settings to load these" });
  }
  try {
    const items = await higgsfieldPresets(source);
    if (!items.length && fallback) return Response.json({ ...fallback, fallback: true, note: "Higgsfield returned no styles — showing the built-in list" });
    // Live items get the researched categories and descriptions where the ids match.
    const known = new Map(fallback?.items.map((p) => [p.id, p]));
    return Response.json({
      items: items.map((p) => ({ ...p, categories: known.get(p.id)?.categories ?? (p.group ? [p.group] : []), description: known.get(p.id)?.description })),
      ...(fallback && { categories: fallback.categories }),
    });
  } catch (e) {
    if (fallback) return Response.json({ ...fallback, fallback: true, note: `Higgsfield's list didn't load (${(e as Error).message}) — showing the built-in list` });
    return Response.json({ items: [], error: (e as Error).message }, { status: 502 });
  }
}
