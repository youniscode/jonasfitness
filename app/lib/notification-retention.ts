// Pure, dependency-free retention rules for the coach notification store. Kept
// free of runtime imports so Node's built-in test runner can load it without
// resolving the Next.js/drizzle module graph - the same convention as
// client-ownership, client-dto, client-email and notification-evaluation.

// Dismissed/resolved notifications are hard-deleted once they are strictly
// older than this many days. Active (un-dismissed) rows are never deleted.
export const RETENTION_DAYS = 180;

export type CleanupNotificationRow = {
  id: number;
  kind: string;
  dedupeKey: string;
  clientId: number | null;
  dismissedAt: Date | null;
  createdAt: Date;
};

// `client-inactive:{clientId}:{YYYY-MM-DD}` - the date part is the Paris
// calendar date of the client's most recent completed workout for that episode.
const CLIENT_INACTIVE_KEY = /^client-inactive:\d+:(\d{4}-\d{2}-\d{2})$/;

// The Paris date encoded in a client_inactive dedupe key, or null when the key
// is not a client_inactive key (or is malformed).
export function clientInactiveKeyDate(dedupeKey: string): string | null {
  const match = CLIENT_INACTIVE_KEY.exec(dedupeKey);
  return match ? match[1] : null;
}

// A client_inactive episode is "closed" once the client has trained again - i.e.
// their current latest-workout Paris date is after the episode's anchor date. A
// row whose episode is NOT closed must never be deleted: if the client is still
// on the same anchor date, removing the row would let the still-active inactivity
// period regenerate a fresh (un-dismissed) alert from the same old key.
export function isClientInactiveEpisodeClosed(dedupeKey: string, lastCompletedParisDate: string | undefined): boolean {
  const keyDate = clientInactiveKeyDate(dedupeKey);
  if (keyDate === null) return false;
  if (!lastCompletedParisDate) return false;
  return lastCompletedParisDate > keyDate;
}

// Decides which rows are safe to hard-delete. Active rows (dismissedAt null)
// are never eligible. Dismissed rows must be strictly older than the retention
// window. client_inactive rows are additionally protected: their episode must
// be closed (client retrained) before deletion, so deleting an old row can
// never cause an ancient inactivity episode to regenerate. Deterministic and
// idempotent - running it twice over the same input yields the same result, and
// after the eligible rows are gone a repeat run returns an empty list.
// `lastCompletedByClient` maps clientId to the Paris calendar date
// (YYYY-MM-DD) of that client's most recent completed workout. Callers derive
// it with parisDateKey; this module stays dependency-free by consuming plain
// date strings.
export function notificationCleanupIds(
  rows: CleanupNotificationRow[],
  now: Date,
  lastCompletedByClient: Map<number, string>,
): number[] {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000);
  return rows
    .filter((row) => row.dismissedAt !== null)
    .filter((row) => row.createdAt.getTime() < cutoff.getTime())
    .filter((row) => {
      if (row.kind !== "client_inactive") return true;
      return isClientInactiveEpisodeClosed(row.dedupeKey, row.clientId === null ? undefined : lastCompletedByClient.get(row.clientId));
    })
    .map((row) => row.id);
}
