import { isWay } from "@/lib/ai-setup/ways";

/**
 * Where a new account goes first: the welcome page, which connects its GPU (the pre-flight board), then on to where it
 * was headed (`after`, a path on this site). Not back to Settings' Your GPU (its Sign up free): the welcome page is that
 * same choice. "Set it up with my AI" (a guest's sign-up from it) opens on the welcome page, on the link's way.
 * Used by the sign-up form and by sign-up with Google or GitHub.
 */
export function welcomePath(after: string, origin: string): string {
  const q = new URLSearchParams({ welcome: "1" });
  if (after !== "/" && !after.startsWith("/connect") && !after.startsWith("/settings#your-gpu")) q.set("next", after);
  const nextUrl = new URL(after, origin);
  if (nextUrl.pathname === "/connect" && nextUrl.searchParams.get("setup") === "ai") {
    q.set("setup", "ai");
    const way = nextUrl.searchParams.get("way");
    if (isWay(way)) q.set("way", way);
  }
  return `/connect?${q}`;
}
