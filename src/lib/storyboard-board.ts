/** Storyboard board helpers (pure): the title the user recognises and when a film can be made. */
import type { Generation } from "./catalog/types";

/** Where the browser remembers the idea each board was made from (batchId → idea). */
export const BOARD_TITLES_KEY = "fuobe:storyboard-titles";

/** "establishing wide shot: a lighthouse keeper … — beat 1 of 4" → "a lighthouse keeper …" (offline shot lists). */
export function unwrapScene(scene: string): string {
  const s = scene.trim();
  return /^[^:]{2,40}:\s*(.+?)\s+—\s+beat \d+ of \d+$/.exec(s)?.[1] ?? s;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The board's serif title: the idea the user typed (stored on the request by newer servers, or
 * remembered by this browser), else the first scene without the shot-list wrapping.
 */
export function boardTitle(frames: Generation[], remembered?: string | null): string {
  const first = frames[0];
  const req = first?.request as { title?: string; batchTitle?: string } | undefined;
  const own = req?.title?.trim() || req?.batchTitle?.trim();
  if (own) return cap(own);
  if (remembered?.trim()) return cap(remembered.trim());
  const scene = first?.request.frame?.scene;
  return cap(scene ? unwrapScene(scene) : (first?.request.prompt ?? "Storyboard"));
}

/**
 * The name the server stores on a new board (every frame's `batchTitle`, the film's title): the
 * user's idea, or their first scene when they wrote it scene by scene.
 */
export function storyboardName(story: string | undefined, scenes: string[]): string {
  return (story?.trim() || scenes.find((s) => s.trim()) || "Storyboard").trim().replace(/\s+/g, " ").slice(0, 200);
}

/** A film needs every frame finished (and at least two of them). */
export function filmReady(frames: Generation[]): boolean {
  return frames.length > 1 && frames.every((f) => f.status === "succeeded" && !!f.outputs[0]);
}

/** Keep the newest `max` remembered titles. */
export function rememberTitle(map: Record<string, string>, batchId: string, idea: string, max = 60): Record<string, string> {
  const next = { ...map, [batchId]: idea.trim().slice(0, 200) };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}
