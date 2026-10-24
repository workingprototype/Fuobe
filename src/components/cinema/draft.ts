import { DURATION, type CinemaAction, type CinemaGenerateInput, type CinemaMode, type DirectorSettings, type GridSize, type GridType } from "@/lib/catalog/cinema";
import type { Engine, MediaKind } from "@/lib/catalog/types";

/** The prompt bar's state (lifted into the workspace so the AI Director and tiles can fill it). */

export interface RefItem {
  id: string;
  /** /api/files URL once uploaded ("" while uploading). */
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
  /** Seconds, for video/audio (measured in the browser). */
  duration?: number;
}

export type BarAction = Extract<CinemaAction, "generate" | "extend-forward" | "extend-backward" | "edit">;

export interface TakeSource {
  generationId: string;
  url: string;
  kind: "image" | "video";
  label: string;
}

export interface CinemaDraft {
  mode: CinemaMode;
  imageTool: "still" | "grid";
  prompt: string;
  moves: string[];
  refs: RefItem[];
  /** Model picked per mode and engine ("video:cloud" → "kling-3"). */
  models: Partial<Record<`${CinemaMode}:${Engine}`, string>>;
  duration: number;
  resolution: Record<CinemaMode, string>;
  aspect: Record<CinemaMode, string>;
  batch: number;
  audio: boolean;
  multiShot: { mode: "off" | "auto" | "manual"; shots: { prompt: string; duration: number }[] };
  grid: { size: GridSize; type: GridType };
  action: BarAction;
  source: TakeSource | null;
}

export const initialDraft = (): CinemaDraft => ({
  mode: "video",
  imageTool: "still",
  prompt: "",
  moves: [],
  refs: [],
  models: {},
  duration: DURATION.default,
  resolution: { video: "720p", image: "1K" },
  aspect: { video: "16:9", image: "16:9" },
  batch: 1,
  audio: true,
  multiShot: { mode: "off", shots: [] },
  grid: { size: "2x2", type: "freeform" },
  action: "generate",
  source: null,
});

/** The request body for /generate (and the input planCinema prices live). */
export function draftToInput(d: CinemaDraft, engine: Engine, settings: DirectorSettings, firstFrame?: string): Omit<CinemaGenerateInput, "brief"> {
  const ready = d.refs.filter((r) => r.ref && !r.uploading);
  const action = d.mode === "image" ? (d.imageTool === "grid" ? "grid" : "generate") : d.source?.kind === "video" ? d.action : "generate";
  return {
    engine,
    mode: d.mode,
    action,
    modelId: d.models[`${d.mode}:${engine}`],
    prompt: d.prompt,
    moves: d.mode === "video" ? d.moves : undefined,
    settings,
    images: ready.filter((r) => r.kind === "image").map((r) => r.ref),
    videos: ready.filter((r) => r.kind === "video").map((r) => r.ref),
    audios: ready.filter((r) => r.kind === "audio").map((r) => r.ref),
    duration: d.duration,
    resolution: d.resolution[d.mode],
    aspectRatio: d.aspect[d.mode],
    batch: d.batch,
    audio: d.audio,
    multiShot: d.mode === "video" && d.multiShot.mode !== "off" ? d.multiShot : undefined,
    source: d.source && action !== "generate" && action !== "grid" ? { url: d.source.url, kind: d.source.kind, ...(firstFrame ? { firstFrame } : {}) } : undefined,
    grid: action === "grid" ? d.grid : undefined,
  };
}

/**
 * How many of the Director's Panel groups are set (film setup, camera, palette, lighting, emotions),
 * for the phone's folded "Director" chip. Tempo counts in video mode only, as the panel shows it.
 */
export function directorPicks(s: DirectorSettings, mode: CinemaMode): number {
  const film = !!(s.genre || s.era || (mode === "video" && s.tempo));
  const camera = !!(s.camera || s.lens || s.focal || s.aperture);
  const emotions = Object.keys(s.emotions ?? {}).length > 0;
  return [film, camera, !!s.palette, !!s.lighting, emotions].filter(Boolean).length;
}
