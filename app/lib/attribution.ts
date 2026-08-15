export const acquisitionSources = ["Unknown", "Instagram", "TikTok", "Facebook", "Google Search", "YouTube", "WhatsApp", "Referral", "Website", "Direct", "Other"] as const;
export type AcquisitionSource = typeof acquisitionSources[number];

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
