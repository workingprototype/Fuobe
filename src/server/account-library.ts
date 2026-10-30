import "server-only";
import { db } from "./db";

/**
 * An account's own runs (public sign-up, "Your GPU"): a generation an account started carries its
 * id in the stored request (`account`, set by the server only). Everything else is the owner's.
 * The proxy lets an account read, cancel and delete only its own (src/proxy.ts).
 */

/** Who made this generation: an account id, null for the owner, undefined when there is no such generation. */
export function generationAccount(id: string): string | null | undefined {
  const row = db().prepare("SELECT json_extract(request_json, '$.account') AS account FROM generations WHERE id = ?").get(id) as { account: string | null } | undefined;
  return row ? (row.account ?? null) : undefined;
}

/** Who made the generation this stored file came from (undefined: not a generation's file). */
export function fileAccount(rel: string): string | null | undefined {
  const row = db()
    .prepare("SELECT json_extract(g.request_json, '$.account') AS account FROM assets a JOIN generations g ON g.id = a.generation_id WHERE a.rel_path = ? LIMIT 1")
    .get(rel) as { account: string | null } | undefined;
  return row ? (row.account ?? null) : undefined;
}
