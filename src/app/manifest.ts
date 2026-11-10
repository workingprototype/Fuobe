import type { MetadataRoute } from "next";

/** The web app manifest: Fuobe's name and icon when the site is added to a home screen or installed. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fuobe",
    short_name: "Fuobe",
    description: "A complete AI studio. Open source.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#5d4bdb",
    icons: [
      { src: "/brand/fuobe-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/fuobe-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/fuobe-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
