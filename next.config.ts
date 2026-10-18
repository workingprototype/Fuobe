import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The sign-in proxy buffers request bodies (10 MB by default): uploads take up to 200 MB plus the form overhead.
    proxyClientMaxBodySize: "210mb",
  },
  async redirects() {
    return [
      { source: "/characters", destination: "/elements", permanent: true },
      { source: "/characters/:id", destination: "/elements/:id", permanent: true },
      // Studio hubs have one path per mode (src/lib/hubs.ts): old `?mode=` links, and a clip handed
      // to Upscale or Audio without a mode, open that mode's own page (prerendered with the right studio).
      ...["audio", "video-tools", "upscale"].map((hub) => ({
        source: `/${hub}`,
        has: [{ type: "query" as const, key: "mode", value: "(?<mode>[a-z0-9-]+)" }],
        destination: `/${hub}/:mode`,
        permanent: false,
      })),
      ...["audio", "upscale"].map((hub) => ({
        source: `/${hub}`,
        has: [{ type: "query" as const, key: "video" }],
        missing: [{ type: "query" as const, key: "mode" }],
        destination: `/${hub}/video`,
        permanent: false,
      })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
