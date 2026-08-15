import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jonas Fitness",
    short_name: "Jonas Fitness",
    description: "Coach-led training, live workout logging and client progress.",
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
