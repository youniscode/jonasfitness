export const acquisitionSources = ["Unknown", "Instagram", "TikTok", "Facebook", "Google Search", "YouTube", "WhatsApp", "Referral", "Website", "Direct", "Other"] as const;
export type AcquisitionSource = typeof acquisitionSources[number];
export const attributionStorageKey = "jonas:first-touch:v1";

export type Attribution = {
  source: AcquisitionSource;
  medium: string;
  campaign: string;
  referrer: string;
  landingPage: string;
};

const sourceSet = new Set<string>(acquisitionSources);
export const safeText = (value: unknown, limit = 180) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export function safeSource(value: unknown): AcquisitionSource {
  const source = safeText(value, 40);
  return sourceSet.has(source) ? source as AcquisitionSource : "Other";
}

export function sourceFromReferrer(referrer: string): AcquisitionSource {
  if (!referrer) return "Direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("facebook") || host === "fb.com") return "Facebook";
    if (host.includes("google")) return "Google Search";
    if (host.includes("youtube") || host === "youtu.be") return "YouTube";
    if (host.includes("whatsapp")) return "WhatsApp";
    return "Referral";
  } catch { return "Referral"; }
}

// Attribution carried into the Progress checkout flow. ONLY sanitized values
// ever leave the browser: source is allowlist-mapped (never raw), medium and
// campaign are trimmed + length-capped. Referrers, landing-page query strings
// and personal information are deliberately not carried.
export type SanitizedAttribution = {
  source: string;
  medium: string;
  campaign: string;
};

/**
 * Server-side sanitization of a client-supplied attribution object. Returns
 * null when nothing usable is present (checkout without attribution is fine).
 * `source` is mapped through the allowlist (`safeSource`), `medium`/`campaign`
 * through the existing capped `safeText` - raw values are never trusted.
 */
export function sanitizeAttribution(value: unknown): SanitizedAttribution | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const source = safeText(raw.source, 40);
  const medium = safeText(raw.medium, 80);
  const campaign = safeText(raw.campaign, 120);
  if (!source && !medium && !campaign) return null;
  return {
    // Empty source becomes "". Non-empty sources are mapped through the UTM/
    // referrer classifier first (handles raw lowercase "instagram"), falling
    // back to the canonical allowlist (handles stored "Direct"/"Instagram").
    // Unknown values always land on "Other" - never on raw input.
    source: source ? (sourceFromUtm(source) === "Other" ? safeSource(source) : sourceFromUtm(source)) : "",
    medium,
    campaign,
  };
}

export function sourceFromUtm(value: string): AcquisitionSource {
  const source = value.trim().toLowerCase();
  if (source.includes("instagram") || source === "ig") return "Instagram";
  if (source.includes("tiktok")) return "TikTok";
  if (source.includes("facebook") || source === "fb") return "Facebook";
  if (source.includes("google")) return "Google Search";
  if (source.includes("youtube")) return "YouTube";
  if (source.includes("whatsapp")) return "WhatsApp";
  if (source.includes("referral")) return "Referral";
  if (source.includes("website")) return "Website";
  return source ? "Other" : "Unknown";
}

export type AcquisitionRow = {
  id: number;
  name: string;
  source: string;
  campaign: string;
  createdAt: Date | string;
};

export type AcquisitionSummary = {
  total: number;
  tracked: number;
  sources: { source: string; count: number }[];
  topSource: string;
  recent: { id: number; name: string; source: string; campaign: string; createdAt: Date | string }[];
};

// Pure aggregation for the acquisition dashboard. Rows are expected to be
// newest-first (the API orders by createdAt desc). Every client row counts
// exactly once, so a freshly converted client appears in `total`, in its
// source bucket, and at the top of `recent` - with its real first-touch
// source preserved. Duplicate rows would inflate counts, which the idempotent
// conversion find-or-create never produces.
export function aggregateAcquisition(rows: AcquisitionRow[]): AcquisitionSummary {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  const sources = [...counts.entries()].map(([source, count]) => ({ source, count }))
    .toSorted((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const tracked = rows.filter((row) => row.source !== "Unknown");
  return {
    total: rows.length,
    tracked: tracked.length,
    sources,
    topSource: sources.find((item) => item.source !== "Unknown")?.source ?? "Not enough data",
    recent: rows.slice(0, 8).map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      campaign: row.campaign,
      createdAt: row.createdAt,
    })),
  };
}
