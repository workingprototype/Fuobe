import type { CinemaTakeInfo, CinemaTile } from "@/lib/catalog/cinema";
import type { Generation } from "@/lib/catalog/types";
import type { StreamEvent } from "@/lib/generation-stream";

/** A take as the workspace lists it: the generation plus where the project files it. */
export type CinemaGeneration = Generation & {
  folderId: string | null;
  tiles?: CinemaTile[];
  take?: CinemaTakeInfo;
  /** The project the take belongs to (set on every item; "My Generations" mixes projects). */
  projectId?: string | null;
};

/**
 * Apply one live event (GET /api/generations/stream) to a cached list of takes. Known takes are
 * updated in place, keeping what the project adds (its folder, tiles, take info): the stream's
 * folderId is the library's, not the scene's. Deleted or trashed takes leave the list. Unknown ids
 * are ignored (new takes arrive with the generate response). Returns the same array when nothing
 * changed, so React Query keeps every tile as it is.
 */
export function applyToTakes<T extends CinemaGeneration>(list: T[] | undefined, ev: StreamEvent): T[] | undefined {
  if (!list) return list;
  const id = ev.type === "deleted" ? ev.id : ev.generation.id;
  const at = list.findIndex((g) => g.id === id);
  if (at < 0) return list;
  if (ev.type === "deleted" || ev.generation.deletedAt) return list.filter((g) => g.id !== id);
  const old = list[at];
  if (old.updatedAt > ev.generation.updatedAt) return list;
  const next = list.slice();
  next[at] = { ...ev.generation, folderId: old.folderId, projectId: old.projectId, tiles: old.tiles, take: old.take } as T;
  return next;
}
