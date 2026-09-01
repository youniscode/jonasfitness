import type { MetadataRoute } from "next";

// Canonical public surfaces only. Auth-gated routes (/progress product,
// /dashboard, /client) are deliberately excluded from the sitemap.
const BASE = "https://jonasprogress.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/progress/founding`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/legal`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/legal/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/legal/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/legal/refunds`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}