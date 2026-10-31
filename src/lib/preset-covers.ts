/**
 * A preset's real cover for the pickers (camera motions, effects, Mix, Cinema Studio's moves): the same still and
 * clip its gallery card shows. Reads the slim covers map (preset-covers.generated.ts: which presets have a cover,
 * and a clip), never the manifest with its provenance (preset-previews.generated.ts), so client code can import it.
 * Keep it to the pickers' own chunks all the same: tests/preset-covers.test.ts checks the importers.
 */
import type { CameraMove } from "./catalog/cinema";
import { PRESET_COVERS } from "./preset-covers.generated";

export interface PresetCover {
  /** The still (a clip's first frame), shown at rest. */
  poster: string;
  /** The short muted clip, played only while the tile is hovered, focused or picked. */
  video?: string;
}

export function presetCover(id: string | undefined): PresetCover | undefined {
  if (!id || !Object.hasOwn(PRESET_COVERS, id)) return undefined;
  const c = PRESET_COVERS[id];
  if (typeof c === "object") return c;
  const base = `/previews/presets/${id}`;
  return c ? { poster: `${base}.jpg`, video: `${base}.mp4` } : { poster: `${base}.jpg` };
}

/**
 * Moves whose camera motion shows another shot than the name says: Drone Orbit runs 360 Orbit, whose clip circles
 * a dancer at ground level, not from the air.
 */
const OTHER_SHOT = new Set(["drone-orbit"]);

/** A Cinema Studio move's cover: the one of the camera motion it runs (catalog/cinema.ts, MOVE_MOTION). */
export const moveCover = (m: Pick<CameraMove, "slug" | "motionId">) => (OTHER_SHOT.has(m.slug) ? undefined : presetCover(m.motionId));
