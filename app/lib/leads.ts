import { safeSource, safeText, type Attribution } from "./attribution";

export const leadStatuses = ["new", "contacted", "qualified", "client", "lost"] as const;
export type LeadStatus = typeof leadStatuses[number];
const statusSet = new Set<string>(leadStatuses);
const languages = new Set(["fr", "en", "ar"]);
const contactPreferences = new Set(["WhatsApp", "Email", "Phone"]);
const formats = new Set(["Online", "In person", "Hybrid"]);

export const isLeadStatus = (value: unknown): value is LeadStatus => statusSet.has(String(value));
export const emailIsValid = (value: string) => /^\S+@\S+\.\S+$/.test(value) && value.length <= 180;

export function applicationValues(body: Record<string, unknown>) {
  const attributionValue = body.attribution && typeof body.attribution === "object" && !Array.isArray(body.attribution)
    ? body.attribution as Record<string, unknown>
    : {};
  const attribution: Attribution = {
    source: attributionValue.source ? safeSource(attributionValue.source) : "Direct",
    medium: safeText(attributionValue.medium, 80) || "direct",
    campaign: safeText(attributionValue.campaign, 120),
    referrer: safeText(attributionValue.referrer, 220),
    landingPage: safeText(attributionValue.landingPage, 180),
  };
  const language = safeText(body.preferredLanguage, 2);
  const contactPreference = safeText(body.contactPreference, 20);
  const coachingFormat = safeText(body.coachingFormat, 30);
  return {
    name: safeText(body.name, 100),
    email: safeText(body.email, 180).toLowerCase(),
    phone: safeText(body.phone, 40),
    country: safeText(body.country, 80),
    goal: safeText(body.goal, 80) || "General fitness",
    experience: safeText(body.experience, 80),
    trainingDays: Math.min(7, Math.max(1, Number(body.trainingDays) || 3)),
    coachingFormat: formats.has(coachingFormat) ? coachingFormat : "Online",
    contactPreference: contactPreferences.has(contactPreference) ? contactPreference : "WhatsApp",
    preferredLanguage: languages.has(language) ? language : "fr",
    message: safeText(body.message, 1200),
    attribution,
  };
}
