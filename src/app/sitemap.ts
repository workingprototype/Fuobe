import type { MetadataRoute } from "next";
import { hubParams } from "@/components/studio/mode-switch-studio";
import { APPS } from "@/lib/catalog";
import { siteOrigin } from "@/server/site-origin";

/**
 * The pages anyone can open, for search engines (`/sitemap.xml`, named in robots.txt). Studios, tools and apps only:
 * nobody's own pages (Library, Settings, Chat, a project or a canvas) and no hand-off links (`/…/start/…`). The
 * addresses use the host the request came to, so a self-hosted Fuobe lists its own.
 */
/** Apps whose page redirects to another (next.config.ts): Click to Ad's studio. */
const MOVED_APPS = new Set(["app-click-to-ad", "app-link-to-video-ad"]);

const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  ...["/image", "/video", "/edit", "/live-edit", "/studios", "/apps", "/audio", "/upscale", "/video-tools", "/fx", "/motions", "/effects", "/motions-and-effects"].map((path) => ({ path, priority: 0.9 })),
  ...[
    "/create",
    "/canvas",
    "/cinema",
    "/genjutsu",
    "/character-sheet",
    "/character-swap",
    "/color-grade",
    "/content-factory",
    "/elements",
    "/explainer",
    "/extend",
    "/faceless",
    "/fashion-factory",
    "/image-to-3d",
    "/influencer",
    "/inpaint",
    "/katana",
    "/kinetic",
    "/layers",
    "/lipsync",
    "/marketing",
    "/marketing/click-to-ad",
    "/mixed-media",
    "/motion-control",
    "/moodboards",
    "/photodump",
    "/reframe",
    "/shorts",
    "/storyboard",
    "/video-edit",
    "/virality",
    "/ads",
    "/ads/multiplier",
  ].map((path) => ({ path, priority: 0.7 })),
  ...(["audio", "upscale", "video-tools"] as const).flatMap((hub) => hubParams(hub).map(({ mode }) => ({ path: `/${hub}/${mode}`, priority: 0.6 }))),
  // An app whose page sends the visitor on (next.config.ts redirects) is listed at the page it goes to.
  ...APPS.filter((a) => !MOVED_APPS.has(a.id)).map((a) => ({ path: `/apps/${a.id}`, priority: 0.6 })),
  { path: "/terms", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  const seen = new Set<string>();
  return PAGES.filter((p) => !seen.has(p.path) && !!seen.add(p.path)).map((p) => ({ url: `${origin}${p.path === "/" ? "" : p.path}`, changeFrequency: "weekly", priority: p.priority }));
}
