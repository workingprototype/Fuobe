import type { MetadataRoute } from "next";
import { siteOrigin } from "@/server/site-origin";

/** robots.txt: every public page may be read; the API and people's own pages aren't for search engines. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/settings", "/library", "/chat", "/login", "/c/", "/s/"] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
