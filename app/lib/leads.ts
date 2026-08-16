import { safeSource, safeText, type Attribution } from "./attribution.ts";

// Canonical lead status vocabulary. "client" (not "converted") is the state a
// lead reaches once it has been converted into a real client row.
export const leadStatuses = ["new", "contacted", "qualified", "client", "lost"] as const;
export type LeadStatus = typeof leadStatuses[number];
const statusSet = new Set<string>(leadStatuses);

// Statuses a coach may set through the generic lead PATCH. "client" is excluded
// on purpose: it must only be reached through the conversion endpoint, which
// creates/links a real client row.
export const manualLeadStatuses = ["new", "contacted", "qualified", "lost"] as const;

const languages = new Set(["fr", "en", "ar"]);
const contactPreferences = new Set(["WhatsApp", "Email", "Phone"]);
const formats = new Set(["Online", "In person", "Hybrid"]);

export const isLeadStatus = (value: unknown): value is LeadStatus => statusSet.has(String(value));
export const isManualLeadStatus = (value: unknown): value is (typeof manualLeadStatuses)[number] =>
  manualLeadStatuses.includes(String(value) as (typeof manualLeadStatuses)[number]);
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

// Result of reviewing a public coaching application. `neutral` means the request
// is silently accepted with a neutral success (honeypot): bots must not be able
// to tune themselves against the protection.
export type ApplicationReview =
  | { accepted: true; values: ReturnType<typeof applicationValues> }
  | { accepted: false; neutral: true }
  | { accepted: false; error: string; status: number };

export function reviewApplication(body: Record<string, unknown>, now: number = Date.now()): ApplicationReview {
  if (String(body.website ?? "").trim()) return { accepted: false, neutral: true };
  const startedAt = Number(body.startedAt);
  if (!Number.isFinite(startedAt) || now - startedAt < 1200) {
    return { accepted: false, error: "Please take a moment to review your application.", status: 400 };
  }
  if (body.consent !== true) return { accepted: false, error: "Consent is required before sending your application.", status: 400 };
  const values = applicationValues(body);
  if (values.name.length < 2) return { accepted: false, error: "Enter your name.", status: 400 };
  if (!emailIsValid(values.email)) return { accepted: false, error: "Enter a valid email address.", status: 400 };
  if (!values.country) return { accepted: false, error: "Enter your country or time zone.", status: 400 };
  return { accepted: true, values };
}

// Decides what a conversion should do for a lead. `already` when the lead is
// already linked; `link` when a client with the same normalized email exists;
// `create` otherwise. Used by the conversion endpoint and tested in isolation.
export type ConversionPlan =
  | { kind: "already"; clientId: number }
  | { kind: "link"; clientId: number }
  | { kind: "create"; email: string };

export function planConversion(
  lead: { convertedClientId: number | null; email: string },
  existingClient: { id: number } | null | undefined,
): ConversionPlan {
  if (lead.convertedClientId !== null) return { kind: "already", clientId: lead.convertedClientId };
  if (existingClient) return { kind: "link", clientId: existingClient.id };
  return { kind: "create", email: lead.email };
}

// Statuses a lead may be explicitly deleted from. "client" is excluded because
// a converted lead is the acquisition/conversion history for a real client row.
export const deletableLeadStatuses = ["new", "contacted", "qualified", "lost"] as const;
export const isDeletableLeadStatus = (value: unknown): value is (typeof deletableLeadStatuses)[number] =>
  deletableLeadStatuses.includes(String(value) as (typeof deletableLeadStatuses)[number]);

export type LeadDeletionPlan = { allowed: true } | { allowed: false; reason: string };

// Decides whether a lead may be deleted. Converted leads (status "client" or a
// linked convertedClientId) are protected: deleting them would sever the
// acquisition/conversion history attached to a real client. There is no
// automatic retention cleanup in this phase because the schema has no reliable
// "lost at" timestamp (`updatedAt` is touched by unrelated edits, so it cannot
// stand in for `lostAt`); deletion is a deliberate coach action only.
export function planLeadDeletion(lead: { status: string; convertedClientId: number | null }): LeadDeletionPlan {
  if (lead.status === "client" || lead.convertedClientId !== null) {
    return { allowed: false, reason: "Converted leads preserve acquisition history and cannot be deleted." };
  }
  return { allowed: true };
}
