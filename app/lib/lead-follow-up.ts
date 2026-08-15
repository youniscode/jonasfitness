import { safeText } from "./attribution";

export const activityTypes = ["note", "phone", "email", "whatsapp", "status", "follow_up", "consultation"] as const;
export const consultationStatuses = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type ActivityType = typeof activityTypes[number];
export type ConsultationStatus = typeof consultationStatuses[number];

const activityTypeSet = new Set<string>(activityTypes);
const consultationStatusSet = new Set<string>(consultationStatuses);

export const isActivityType = (value: unknown): value is ActivityType => activityTypeSet.has(String(value));
export const isConsultationStatus = (value: unknown): value is ConsultationStatus => consultationStatusSet.has(String(value));

export function optionalDate(value: unknown) {
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function consultationValues(body: Record<string, unknown>) {
  const startAt = optionalDate(body.startAt);
  return {
    startAt,
    durationMinutes: Math.min(120, Math.max(15, Number(body.durationMinutes) || 30)),
    notes: safeText(body.notes, 800),
  };
}
