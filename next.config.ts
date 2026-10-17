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
