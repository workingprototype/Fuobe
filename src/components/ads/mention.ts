/**
 * @product mentions in the brand chat (pure text helpers, kept out of the component so they're tested):
 * the "@query" being typed before the caret, the products it matches, and the text after one is picked.
 */

/** The "@query" being typed just before the caret ("…for @Nig|"), or null when the caret isn't in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  return m ? { start: before.length - m[1].length - 1, query: m[1] } : null;
}

/** Products whose name matches what's typed after "@" (names starting with it first). */
export function mentionMatches<P extends { name: string }>(products: P[], query: string): P[] {
  const q = query.trim().toLowerCase().replace(/_/g, " ");
  if (!q) return products;
  const hits = products.filter((p) => p.name.toLowerCase().includes(q));
  return [...hits.filter((p) => p.name.toLowerCase().startsWith(q)), ...hits.filter((p) => !p.name.toLowerCase().startsWith(q))];
}

/** The text with "@Name " for the picked product: in place of the "@query" being typed, else at the caret. */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const q = mentionQuery(text, at);
  const start = q ? q.start : at;
  const before = text.slice(0, start);
  const after = text.slice(at);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const tag = `${pad}@${name}${/^\s/.test(after) ? "" : " "}`;
  return { text: before + tag + after, caret: (before + tag).length };
}
