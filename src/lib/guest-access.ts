/**
 * What guests (signed-out visitors) and accounts (people who signed up) may do while public sign-up
 * is on (src/server/auth.ts publicSignup). Path rules only: src/proxy.ts applies them.
 *
 * - A guest opens every page and the catalog and status reads the pages need. The owner's library
 *   comes back empty (or 401 "Sign up to see your library"), and every change is a 401 that the
 *   client turns into "Create a free account" (src/components/guest-prompt.tsx).
 * - An account browses the whole studio and keeps its own library and projects (ACCOUNT_CHANGES),
 *   but never runs on the owner's cloud keys or GPU ("Connect your GPU"), and never changes
 *   install-wide settings, keys or tokens (owner only).
 */

/** Set by the proxy on a guest's request to a route that answers guests itself (GUEST_FILTERED), and on its 401s. */
export const GUEST_HEADER = "x-fuobe-guest";

/** A guest's request, as the proxy marks it for GUEST_FILTERED routes (a client that sends the header itself only gets less). */
export const isGuest = (request: Request) => request.headers.get(GUEST_HEADER) === "1";

export const GUEST_LIBRARY_MESSAGE = "Sign up to see your library.";
export const GUEST_RUN_MESSAGE = "Create a free account to run this.";

/** Catalog and status reads that hold nothing of the owner's library: a guest gets the real answer. */
const GUEST_READS = new Set(["/api/status", "/api/models", "/api/search-index", "/api/comfyui", "/api/settings/models"]);

/** Catalogs mixed with the owner's own items: the route leaves the owner's part out for a guest (GUEST_HEADER). */
const GUEST_FILTERED = new Set(["/api/moodboards", "/api/palettes", "/api/assist/skills"]);

/** The owner's lists ({ items }): a guest gets them empty. */
const EMPTY_LISTS = [
  "/api/generations",
  "/api/generations/trash",
  "/api/assets",
  "/api/folders",
  "/api/elements",
  "/api/canvases",
  "/api/cinema/projects",
  "/api/layers",
  "/api/content-factory/series",
  "/api/dub",
  "/api/explainer",
  "/api/faceless/channels",
  "/api/faceless/episodes",
  "/api/katana",
  "/api/marketing/runs",
  "/api/products",
  "/api/brands",
  "/api/shorts/sessions",
  "/api/shorts/presets",
  "/api/swap-studio/projects",
  "/api/ads/creatives",
  "/api/assist/projects",
  "/api/assist/schedules",
];

const EMPTY: Record<string, unknown> = {
  ...Object.fromEntries(EMPTY_LISTS.map((p) => [p, { items: [] }])),
  "/api/shares": { items: [], signIn: true },
  "/api/photodump": { packs: [] },
  "/api/photodump/packs": { packs: [] },
  "/api/generations/facets": { models: [], kinds: {}, total: 0, favorites: 0, failed: 0, trash: 0, pinned: 0, steps: 0, reviews: {} },
};

export type GuestRead =
  /** A page, or a catalog read: let it through. */
  | { kind: "pass" }
  /** Let it through with GUEST_HEADER: the route answers without the owner's items. */
  | { kind: "filtered" }
  /** Answer this body (the owner's list, empty). */
  | { kind: "empty"; body: unknown }
  /** No such endpoint for a guest (404: the live-updates stream, so the client looks again much later). */
  | { kind: "none" }
  /** The owner's data: 401. */
  | { kind: "closed" };

/** What a guest's GET or HEAD gets. Anything not named here under /api stays closed. */
export function guestRead(pathname: string): GuestRead {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return { kind: "pass" };
  if (GUEST_READS.has(pathname)) return { kind: "pass" };
  if (GUEST_FILTERED.has(pathname)) return { kind: "filtered" };
  if (Object.hasOwn(EMPTY, pathname)) return { kind: "empty", body: EMPTY[pathname] };
  if (pathname === "/api/generations/stream") return { kind: "none" };
  return { kind: "closed" };
}

/** The run routes whose `?preview=1` only plans and prices (any other route would ignore the flag and run). */
const PREVIEWS = [/^\/api\/(generations|audio-tools|dub|katana)$/, /^\/api\/dub\/[^/]+\/voice$/];

/** The estimate routes (named: a dynamic segment called "estimate" on another route must not pass for one). */
const ESTIMATES =
  /^\/api\/(ads|ads\/multiplier|assist\/skills\/[^/]+|content-factory|evolution|faceless|genjutsu|influencer|marketing|marketing\/click-to-ad|mixed-media|remove-object|shorts|storyboards)\/estimate$/;

/** A POST that only plans and prices a run (an estimate route, or ?preview=1 where PREVIEWS honours it): free, and open to guests. */
export function isPriceCheck(method: string, pathname: string, search: string): boolean {
  if (method !== "POST") return false;
  if (ESTIMATES.test(pathname)) return true;
  return new URLSearchParams(search).get("preview") === "1" && PREVIEWS.some((r) => r.test(pathname));
}

/**
 * Changes an account may make: its own library and projects (create, rename, move, share, delete,
 * upload), never anything that reaches a model. Everything else an account sends (a run, an AI
 * helper, a connector, the MCP endpoint…) is refused with "Connect your GPU": an account never
 * spends the owner's cloud keys or GPU.
 */
const ACCOUNT_CHANGES: [methods: string, path: RegExp][] = [
  ["POST", /^\/api\/auth\/logout$/],
  ["POST", /^\/api\/uploads$/],
  ["POST", /^\/api\/media\/probe$/],
  ["POST", /^\/api\/folders$/],
  ["PATCH DELETE", /^\/api\/folders\/[^/]+$/],
  ["PATCH DELETE", /^\/api\/generations\/[^/]+$/],
  ["POST", /^\/api\/generations\/(bulk|local)$/],
  ["POST", /^\/api\/generations\/[^/]+\/(cancel|finish)$/],
  ["DELETE", /^\/api\/generations\/trash$/],
  ["DELETE", /^\/api\/assets\/[^/]+$/],
  ["POST", /^\/api\/shares$/],
  ["PATCH DELETE", /^\/api\/shares\/[^/]+$/],
  ["POST", /^\/api\/(canvases|cinema\/projects|layers|elements|palettes|products|brands|swap-studio\/projects|shorts\/presets|photodump\/packs|assist\/projects|assist\/memory)$/],
  [
    "PATCH DELETE",
    /^\/api\/(canvases|cinema\/projects|layers|elements|palettes|products|brands|moodboards|swap-studio\/projects|content-factory\/series|faceless\/channels|faceless\/episodes|dub|shorts\/presets|shorts\/sessions|assist|assist\/projects|assist\/memory|assist\/schedules|assist\/skills|ads\/creatives)\/[^/]+$/,
  ],
  ["DELETE", /^\/api\/(katana|marketing\/runs|photodump\/packs)\/[^/]+$/],
  ["POST", /^\/api\/canvases\/[^/]+\/duplicate$/],
  ["POST", /^\/api\/assist\/skills\/[^/]+\/duplicate$/],
  ["POST", /^\/api\/ads\/creatives\/[^/]+\/save$/],
  ["POST", /^\/api\/cinema\/projects\/[^/]+\/folders$/],
  ["PATCH DELETE", /^\/api\/cinema\/projects\/[^/]+\/(items|folders\/[^/]+)$/],
  ["PUT", /^\/api\/cinema\/projects\/[^/]+\/items\/[^/]+\/tiles$/],
  ["POST", /^\/api\/layers\/[^/]+\/versions$/],
  ["PATCH DELETE", /^\/api\/layers\/[^/]+\/jobs\/[^/]+$/],
  ["DELETE", /^\/api\/assist\/projects\/[^/]+\/sources\/[^/]+$/],
];

/** May an account make this change itself? (Reads are always fine; price checks are free.) */
export function accountMayChange(method: string, pathname: string, search: string): boolean {
  if (method === "GET" || method === "HEAD" || isPriceCheck(method, pathname, search)) return true;
  return ACCOUNT_CHANGES.some(([methods, path]) => methods.split(" ").includes(method) && path.test(pathname));
}

/** Set on an account's refused run: the client shows "Connect your GPU to run this". */
export const CONNECT_GPU_HEADER = "x-fuobe-connect-gpu";
export const CONNECT_GPU_MESSAGE = "Connect your GPU to run this. Free accounts run on their own ComfyUI.";

/** Install-wide settings, keys and tokens: changes are the owner's (403 for an account). */
const OWNER_WRITES = new Set(["/api/settings", "/api/settings/models", "/api/loras", "/api/llm", "/api/providers/test", "/api/auth/public"]);
/** Owner only, reads included: the password, the API tokens, the assistant's connectors and the MCP endpoint. */
const OWNER_ALL = [/^\/api\/auth\/(password|tokens)$/, /^\/api\/assist\/connectors(\/|$)/, /^\/api\/mcp$/];

export function ownerOnly(method: string, pathname: string): boolean {
  if (OWNER_ALL.some((r) => r.test(pathname))) return true;
  return method !== "GET" && method !== "HEAD" && OWNER_WRITES.has(pathname);
}
