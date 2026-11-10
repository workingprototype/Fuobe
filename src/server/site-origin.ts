import "server-only";
import { headers } from "next/headers";

/**
 * This site's address as the request came to it (behind a proxy, its forwarded host and scheme), for the sitemap and
 * robots.txt, so a self-hosted Fuobe lists its own pages.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
