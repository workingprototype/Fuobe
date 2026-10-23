import { useSyncExternalStore } from "react";

/** Apple keyboards say ⌘ where everyone else says Ctrl. */
export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

/** The modifier key's name for this browser: "⌘" on Apple devices, "Ctrl" elsewhere (and on the server). */
export function modKey(): "⌘" | "Ctrl" {
  return typeof navigator !== "undefined" && isApplePlatform(navigator.platform) ? "⌘" : "Ctrl";
}

const noop = () => () => {};

/**
 * The modifier key's name, after hydration: the server and the first client render say "Ctrl", so a
 * keycap never makes the HTML and the first render disagree.
 */
export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(noop, modKey, () => "Ctrl");
}
