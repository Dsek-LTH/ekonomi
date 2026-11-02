import type { MetadataRoute } from "next";

/** Lets the app be installed to a home screen under its own name and icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "D-sektionen | Ekonomi",
    short_name: "Ekonomi",
    description: "Utlägg, budget och bokföring för D-sektionen",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f4f5",
    theme_color: "#f4f4f5",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
