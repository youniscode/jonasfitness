import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientInactiveKeyDate,
  isClientInactiveEpisodeClosed,
  notificationCleanupIds,
  RETENTION_DAYS,
  type CleanupNotificationRow,
} from "../app/lib/notification-retention.ts";

const NOW = new Date("2026-08-16T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function row(overrides: Partial<CleanupNotificationRow> & { id: number }): CleanupNotificationRow {
  return {
    kind: "client_workout",
    dedupeKey: `client-workout:${overrides.id}`,
    clientId: null,
    dismissedAt: daysAgo(200),
    createdAt: daysAgo(200),
    ...overrides,
  };
}

test("clientInactiveKeyDate extracts the Paris date from a client_inactive key", () => {
  assert.equal(clientInactiveKeyDate("client-inactive:42:2026-08-08"), "2026-08-08");
  assert.equal(clientInactiveKeyDate("client-workout:7"), null);
  assert.equal(clientInactiveKeyDate("client-inactive:42:not-a-date"), null);
  assert.equal(clientInactiveKeyDate("client-inactive:42:2026-08"), null);
});

test("isClientInactiveEpisodeClosed is true only after the client retrains", () => {
  const key = "client-inactive:42:2026-08-08";
  // Client retrained later (last workout 2026-08-14) → episode closed.
  assert.equal(isClientInactiveEpisodeClosed(key, "2026-08-14"), true);
  // Client is still on the same anchor date → episode still live.
  assert.equal(isClientInactiveEpisodeClosed(key, "2026-08-08"), false);
  // Unknown current activity → be conservative.
  assert.equal(isClientInactiveEpisodeClosed(key, undefined), false);
  // Not a client_inactive key → be conservative.
  assert.equal(isClientInactiveEpisodeClosed("client-workout:7", "2026-08-14"), false);
});

test("active (un-dismissed) rows are never deleted even when very old", () => {
  const ids = notificationCleanupIds([row({ id: 1, dismissedAt: null, createdAt: daysAgo(400) })], NOW, new Map());
  assert.deepEqual(ids, []);
});

test("dismissed rows are retained before and exactly at the retention threshold", () => {
  const justBefore = row({ id: 1, createdAt: daysAgo(RETENTION_DAYS - 1) });
  const exactlyAt = row({ id: 2, createdAt: daysAgo(RETENTION_DAYS) });
  const ids = notificationCleanupIds([justBefore, exactlyAt], NOW, new Map());
  assert.deepEqual(ids, []);
});

test("very old dismissed rows are deleted", () => {
  const old = row({ id: 1, createdAt: daysAgo(RETENTION_DAYS + 1) });
  const older = row({ id: 2, createdAt: daysAgo(400) });
  const ids = notificationCleanupIds([old, older], NOW, new Map());
  assert.deepEqual(ids.sort((a, b) => a - b), [1, 2]);
});

test("an old dismissed client_inactive episode that is still live is never deleted", () => {
  // Client last trained 2026-08-08 and is still inactive on that anchor date;
  // the dismissed alert must survive so the episode cannot regenerate.
  const lastCompleted = new Map([[42, "2026-08-08"]]);
  const liveEpisode = row({ id: 1, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-08", clientId: 42, createdAt: daysAgo(400) });
  assert.equal(notificationCleanupIds([liveEpisode], NOW, lastCompleted).length, 0);
});

test("an old dismissed client_inactive episode that is closed is deleted", () => {
  // Client retrained on 2026-08-14, closing the 2026-08-08 episode.
  const lastCompleted = new Map([[42, "2026-08-14"]]);
  const closedEpisode = row({ id: 1, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-08", clientId: 42, createdAt: daysAgo(400) });
  assert.deepEqual(notificationCleanupIds([closedEpisode], NOW, lastCompleted), [1]);
});

test("a current inactivity episode is retained even if its row is old", () => {
  // The episode is current: anchor date equals the client's latest workout date.
  const lastCompleted = new Map([[42, "2026-08-16"]]);
  const currentEpisode = row({ id: 1, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-16", clientId: 42, createdAt: daysAgo(400) });
  assert.equal(notificationCleanupIds([currentEpisode], NOW, lastCompleted).length, 0);
});

test("cleanup returns nothing when no rows qualify", () => {
  assert.deepEqual(notificationCleanupIds([], NOW, new Map()), []);
  const recent = row({ id: 1, createdAt: daysAgo(10) });
  assert.deepEqual(notificationCleanupIds([recent], NOW, new Map()), []);
});

test("cleanup is deterministic and idempotent across repeated runs", () => {
  const lastCompleted = new Map([[42, "2026-08-14"]]);
  const input = [
    row({ id: 1, kind: "client_workout", createdAt: daysAgo(400) }),
    row({ id: 2, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-08", clientId: 42, createdAt: daysAgo(400) }),
    row({ id: 3, kind: "client_inactive", dedupeKey: "client-inactive:42:2026-08-10", clientId: 42, createdAt: daysAgo(400) }),
    row({ id: 4, kind: "client_workout", createdAt: daysAgo(10) }),
  ];
  const first = notificationCleanupIds(input, NOW, lastCompleted);
  const second = notificationCleanupIds(input, NOW, lastCompleted);
  assert.deepEqual(first, second);
  // Rows 1 (old + dismissed) and 2 (closed episode) are deleted; row 3's episode
  // (anchor 2026-08-10 < 2026-08-14) is also closed, so it is deleted too; row 4
  // is too recent.
  assert.deepEqual(first.sort((a, b) => a - b), [1, 2, 3]);
});
