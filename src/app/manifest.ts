import type { MetadataRoute } from "next";

/** Android paints the launch screen in `background_color` before the page has loaded. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "D-sektionen | Ekonomi",
    short_name: "Ekonomi",
    description: "Utlägg, budget och bokföring för D-sektionen",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#17171a",
    theme_color: "#17171a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops this one to the launcher's own shape (circle, squircle) and only
      // keeps the middle 80%, so the coin is drawn smaller inside it.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Nytt utlägg",
        url: "/expenses/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
