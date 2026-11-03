import type { MetadataRoute } from "next";

/**
 * Lets the app be installed to a home screen under its own name and icon, and
 * open full screen from there without the browser's address bar.
 *
 * The colours are the dark `--color-canvas` (CANVAS in app/layout.tsx). A
 * manifest is one file for every reader, so it cannot follow the theme the way
 * the page's own theme-color does. Android paints the launch screen in
 * `background_color` before the page has loaded, and a dark one is the smaller
 * jolt: a light reader sees a dark frame for a moment, where a dark reader
 * would otherwise see a white flash.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The app's identity once installed. Without it the browser uses
    // start_url, and changing that would make every phone think it is a
    // different app.
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
      // Android crops this one to the launcher's own shape (circle, squircle)
      // and only keeps the middle 80%, so the coin is drawn smaller inside it.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    // A long press on the icon. The one job most people open the app for.
    shortcuts: [
      {
        name: "Nytt utlägg",
        url: "/expenses/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
