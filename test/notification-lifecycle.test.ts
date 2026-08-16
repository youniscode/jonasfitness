import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeKeyId,
  resolveNotificationIds,
  type ActiveNotificationRow,
  type ResolutionEvidence,
} from "../app/lib/notification-lifecycle.ts";

function evidence(overrides: Partial<ResolutionEvidence> = {}): ResolutionEvidence {
  return {
    todayParisKey: "2026-08-16",
    scheduledSessionIds: new Set(),
    alertSessionIds: new Set(),
    scheduledConsultationIds: new Set(),
    dueLeadIds: new Set(),
    unreviewedProgressIds: new Set(),
    unreviewedWorkoutIds: new Set(),
    openInactiveClientIds: new Set(),
    ...overrides,
  };
}

test("dedupeKeyId extracts the numeric entity id from a dedupe key", () => {
  assert.equal(dedupeKeyId("session-reminder:42:2026-08-16T11:00:00.000Z"), 42);
  assert.equal(dedupeKeyId("client-workout:7"), 7);
  assert.equal(dedupeKeyId("client-inactive:9:2026-08-08"), 9);
  assert.equal(dedupeKeyId("progress-update:3"), 3);
  // The daily briefing key has no numeric id.
  assert.equal(dedupeKeyId("daily-briefing:2026-08-16"), null);
});

test("a notification beyond a candidate-query limit is NOT resolved merely because it was omitted", () => {
  // Simulate 50 active session reminders while the generation query is limited
  // to 40. Because resolution uses the positively-verified scheduledSessionIds
  // (which still contains all 50 ids), none may be auto-resolved.
  const sessionIds = new Set<number>();
  const active: ActiveNotificationRow[] = [];
  for (let i = 0; i < 50; i += 1) {
    const sessionId = 1000 + i;
    sessionIds.add(sessionId);
    active.push({ id: i + 1, kind: "session_reminder", dedupeKey: `session-reminder:${sessionId}:2026-08-16T11:00:00.000Z` });
  }
  assert.deepEqual(resolveNotificationIds(active, evidence({ scheduledSessionIds: sessionIds })), []);
});

test("a genuinely resolved notification IS auto-resolved", () => {
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "session_reminder", dedupeKey: "session-reminder:101:2026-08-15T09:00:00.000Z" },
    { id: 2, kind: "session_reminder", dedupeKey: "session-reminder:102:2026-08-16T11:00:00.000Z" },
  ];
  // Session 102 is still scheduled in the window; session 101 is gone (left the
  // window or was cancelled) → only id 1 resolves.
  const resolved = resolveNotificationIds(active, evidence({ scheduledSessionIds: new Set([102]) }));
  assert.deepEqual(resolved, [1]);
});

test("inactivity reset after retraining still resolves the old episode", () => {
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-08" },
    { id: 2, kind: "client_inactive", dedupeKey: "client-inactive:43:2026-08-10" },
  ];
  // Client 42 is still on a live episode (open); client 43 has retrained
  // (closed, absent from openInactiveClientIds) → only id 2 resolves.
  const resolved = resolveNotificationIds(active, evidence({ openInactiveClientIds: new Set([42]) }));
  assert.deepEqual(resolved, [2]);
});

test("a stale daily briefing is resolved but today's is kept", () => {
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "daily_briefing", dedupeKey: "daily-briefing:2026-08-16" },
    { id: 2, kind: "daily_briefing", dedupeKey: "daily-briefing:2026-08-15" },
  ];
  assert.deepEqual(resolveNotificationIds(active, evidence({ todayParisKey: "2026-08-16" })), [2]);
});

test("resolution never fabricates ids and leaves dismissed rows alone", () => {
  // Dismissed rows are excluded upstream (the service only fetches
  // dismissedAt IS NULL). resolveNotificationIds is a pure function of its
  // input, so it can only return ids it was given — never touch other rows.
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "client_workout", dedupeKey: "client-workout:7" },
  ];
  const resolved = resolveNotificationIds(active, evidence({ unreviewedWorkoutIds: new Set() }));
  assert.deepEqual(resolved, [1]);
  // The input itself is unchanged.
  assert.equal(active.length, 1);
});

test("repeated evaluation is idempotent (deterministic output)", () => {
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "client_workout", dedupeKey: "client-workout:7" },
    { id: 2, kind: "progress_update", dedupeKey: "progress-update:9" },
    { id: 3, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-08" },
  ];
  const ev = evidence({
    unreviewedWorkoutIds: new Set([7]),
    unreviewedProgressIds: new Set(),
    openInactiveClientIds: new Set([42]),
  });
  const first = resolveNotificationIds(active, ev);
  const second = resolveNotificationIds(active, ev);
  assert.deepEqual(first, second);
  assert.deepEqual(first.sort((a, b) => a - b), [2]);
});

test("unknown notification kinds are never auto-resolved", () => {
  const active: ActiveNotificationRow[] = [
    { id: 1, kind: "some_future_kind", dedupeKey: "some-future-kind:1" },
  ];
  assert.deepEqual(resolveNotificationIds(active, evidence()), []);
});
