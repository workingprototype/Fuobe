/**
 * The release tile's title (home-bento.tsx), by the day: "today" only on the day the model came out (UTC), then a title
 * that stays true. Home is prerendered, so the page is built with the later title and the tile changes it in the
 * browser on the day itself (ReleaseTitle in bento-islands.tsx). No other code in this module: the browser loads it.
 */
export const RELEASE_TITLES = { today: "Live on Fuobe today", later: "Now on Fuobe" } as const;

/** The title for a release that came out on `released` (YYYY-MM-DD, UTC), as seen at `now`. */
export const releaseTitle = (released: string, now: Date) => (now.toISOString().slice(0, 10) === released ? RELEASE_TITLES.today : RELEASE_TITLES.later);
