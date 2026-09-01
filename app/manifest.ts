import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jonas Progress",
    short_name: "Jonas Progress",
    description: "Self-directed training software: beat the logbook. See what you did last time, set what you want to beat today, and record what you actually achieved.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f3ed",
    theme_color: "#10140e",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
