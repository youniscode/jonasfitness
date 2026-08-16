import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationCandidates, keyDate, parisDateKey, parisDaysBetween } from "../app/lib/notification-evaluation.ts";
import { cronSecretMatches } from "../app/lib/cron-auth.ts";

const OWNER = "coach-a";
const NOW = new Date("2026-08-16T10:00:00.000Z");

const rows = {
  sessionRows: [
    { id: 1, clientId: 10, clientName: "Maya", startAt: new Date("2026-08-16T11:00:00.000Z"), readinessLevel: "amber", readinessScore: 62, coachAction: "Reduce volume today.", respondedAt: null },
    { id: 2, clientId: 11, clientName: "Samir", startAt: new Date("2026-08-16T09:00:00.000Z"), readinessLevel: "green", readinessScore: 88, coachAction: "", respondedAt: new Date("2026-08-16T08:30:00.000Z") },
  ],
  consultationRows: [
    { id: 1, leadId: 100, leadName: "Alex", startAt: new Date("2026-08-16T14:00:00.000Z"), durationMinutes: 30 },
  ],
  followUpRows: [
    { id: 100, name: "Alex", status: "new", source: "Instagram", nextFollowUpAt: new Date("2026-08-15T09:00:00.000Z") },
    { id: 101, name: "Noor", status: "lost", source: "Direct", nextFollowUpAt: new Date("2026-08-14T09:00:00.000Z") },
    { id: 102, name: "Converted", status: "client", source: "Direct", nextFollowUpAt: new Date("2026-08-13T09:00:00.000Z") },
  ],
  progressRows: [
    { id: 1, clientId: 10, clientName: "Maya", weight: 64.2, energy: 7, adherence: 90, createdAt: new Date("2026-08-16T09:00:00.000Z") },
  ],
  workoutRows: [
    { id: 1, clientId: 10, clientName: "Maya", title: "Day 1", completedAt: new Date("2026-08-16T08:00:00.000Z"), completedSets: 12, totalVolume: 4800 },
  ],
  inactivityRows: [],
};

const emptyRows = {
  sessionRows: [],
  consultationRows: [],
  followUpRows: [],
  progressRows: [],
  workoutRows: [],
  inactivityRows: [],
};

const inactivityClient = (clientId: number, clientName: string, lastCompletedAt: Date) => ({ clientId, clientName, lastCompletedAt });

test("parisDateKey uses Europe/Paris, not UTC", () => {
  // 22:30 UTC is already 00:30 the next day in Paris (CEST, UTC+2).
  assert.equal(parisDateKey(new Date("2026-08-16T22:30:00.000Z")), "2026-08-17");
  // Midday UTC is the same calendar day in Paris.
  assert.equal(parisDateKey(new Date("2026-08-16T10:00:00.000Z")), "2026-08-16");
  // Winter (CET, UTC+1): 23:30 UTC rolls into the next Paris day.
  assert.equal(parisDateKey(new Date("2026-01-15T23:30:00.000Z")), "2026-01-16");
});

test("parisDateKey is deterministic", () => {
  const date = new Date("2026-08-16T22:30:00.000Z");
  assert.equal(parisDateKey(date), parisDateKey(date));
});

test("keyDate formats and tolerates null", () => {
  assert.equal(keyDate(new Date("2026-08-16T10:00:00.000Z")), "2026-08-16T10:00:00.000Z");
  assert.equal(keyDate(null), "unknown");
});

test("daily briefing dedupe key rolls over on Paris midnight, not UTC", () => {
  const late = new Date("2026-08-16T23:30:00.000Z"); // Paris is already 2026-08-17
  const result = buildNotificationCandidates(OWNER, late, {
    sessionRows: [], consultationRows: [], followUpRows: [], progressRows: [], workoutRows: [], inactivityRows: [],
  });
  assert.equal(result.candidates[0].dedupeKey, "daily-briefing:2026-08-17");
});

test("cronSecretMatches accepts only the exact bearer secret", () => {
  assert.equal(cronSecretMatches("Bearer secret", "secret"), true);
  assert.equal(cronSecretMatches("Bearer wrong", "secret"), false);
  assert.equal(cronSecretMatches("bearer secret", "secret"), false);
  assert.equal(cronSecretMatches("Bearer secret extra", "secret"), false);
  assert.equal(cronSecretMatches(null, "secret"), false);
  assert.equal(cronSecretMatches("Bearer secret", undefined), false);
  assert.equal(cronSecretMatches("Bearer secret", null), false);
  assert.equal(cronSecretMatches("Bearer secret", ""), false);
});

test("buildNotificationCandidates is deterministic across repeated evaluation", () => {
  const first = buildNotificationCandidates(OWNER, NOW, rows);
  const second = buildNotificationCandidates(OWNER, NOW, rows);
  assert.deepEqual(first.candidates, second.candidates);
});

test("buildNotificationCandidates does not mutate its inputs (concurrent-safe)", () => {
  const before = JSON.stringify(rows);
  buildNotificationCandidates(OWNER, NOW, rows);
  assert.equal(JSON.stringify(rows), before);
});

test("buildNotificationCandidates produces one unique dedupe key per underlying event", () => {
  const { candidates } = buildNotificationCandidates(OWNER, NOW, rows);
  const keys = candidates.map((candidate) => candidate.dedupeKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("buildNotificationCandidates applies the expected rules", () => {
  const { candidates, sessionReminders, pulseAlerts, activeFollowUps } = buildNotificationCandidates(OWNER, NOW, rows);

  const kinds = candidates.map((candidate) => candidate.kind).sort();
  assert.deepEqual(kinds, [
    "client_workout",
    "consultation",
    "daily_briefing",
    "lead_follow_up",
    "progress_update",
    "pulse_alert",
    "session_reminder",
  ]);

  // Only the future session becomes a reminder; only amber/red become a pulse alert.
  assert.equal(sessionReminders.length, 1);
  assert.equal(sessionReminders[0].id, 1);
  assert.equal(pulseAlerts.length, 1);
  assert.equal(pulseAlerts[0].id, 1);

  // Lost and client (converted) leads never produce follow-up reminders.
  assert.equal(activeFollowUps.length, 1);
  assert.equal(activeFollowUps[0].id, 100);

  // Every candidate belongs to the coach being evaluated.
  candidates.forEach((candidate) => assert.equal(candidate.ownerId, OWNER));
});

test("parisDaysBetween counts whole Paris calendar days", () => {
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-16T08:00:00.000Z")), 0);
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-15T10:00:00.000Z")), 1);
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-10T10:00:00.000Z")), 6);
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-09T10:00:00.000Z")), 7);
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-08T10:00:00.000Z")), 8);
  // Future-dated activity is negative (safely ignored by the threshold rule).
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), new Date("2026-08-20T10:00:00.000Z")), -4);
});

test("parisDaysBetween is safe across UTC midnight and summer/winter offsets", () => {
  // 23:30 UTC on Aug 9 is already Aug 10 in Paris (CEST, UTC+2). Measured from
  // Aug 16, that is 6 full Paris days — still NOT inactive (off-by-one guard).
  const lastLate = new Date("2026-08-09T23:30:00.000Z");
  assert.equal(parisDateKey(lastLate), "2026-08-10");
  assert.equal(parisDaysBetween(new Date("2026-08-16T10:00:00.000Z"), lastLate), 6);

  // Winter (CET, UTC+1): 23:30 UTC on Jan 8 is Jan 9 in Paris → 7 days to Jan 16.
  const lastWinter = new Date("2026-01-08T23:30:00.000Z");
  assert.equal(parisDateKey(lastWinter), "2026-01-09");
  assert.equal(parisDaysBetween(new Date("2026-01-16T10:00:00.000Z"), lastWinter), 7);
});

test("no inactivity alert before the 7-day threshold", () => {
  const result = buildNotificationCandidates(OWNER, NOW, {
    ...emptyRows,
    inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-10T08:00:00.000Z"))], // 6 days ago
  });
  assert.equal(result.candidates.some((candidate) => candidate.kind === "client_inactive"), false);
  assert.equal(result.inactiveClients.length, 0);
});

test("inactivity alert at exactly 7 full Paris days", () => {
  const result = buildNotificationCandidates(OWNER, NOW, {
    ...emptyRows,
    inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-09T08:00:00.000Z"))],
  });
  const inactive = result.candidates.filter((candidate) => candidate.kind === "client_inactive");
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].clientId, 20);
  assert.equal(inactive[0].severity, "medium");
  assert.equal(result.inactiveClients.length, 1);
});

test("inactivity alert after threshold carries the duration", () => {
  const result = buildNotificationCandidates(OWNER, NOW, {
    ...emptyRows,
    inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-08T08:00:00.000Z"))], // 8 days ago
  });
  const inactive = result.candidates.filter((candidate) => candidate.kind === "client_inactive");
  assert.equal(inactive.length, 1);
  assert.ok(inactive[0].title.includes("8 days"));
  assert.equal(result.inactiveClients[0].days, 8);
});

test("inactivity dedupe key is stable across repeated evaluation (no daily duplicates)", () => {
  const input = { ...emptyRows, inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-08T08:00:00.000Z"))] };
  const first = buildNotificationCandidates(OWNER, NOW, input).candidates.find((candidate) => candidate.kind === "client_inactive");
  const second = buildNotificationCandidates(OWNER, NOW, input).candidates.find((candidate) => candidate.kind === "client_inactive");
  assert.ok(first);
  assert.equal(first.dedupeKey, second?.dedupeKey);
  assert.equal(first.dedupeKey, "client-inactive:20:2026-08-08");
});

test("concurrent evaluation yields identical inactivity candidates", () => {
  const input = { ...emptyRows, inactivityRows: [
    inactivityClient(20, "Maya", new Date("2026-08-08T08:00:00.000Z")),
    inactivityClient(21, "Samir", new Date("2026-08-01T08:00:00.000Z")),
  ]};
  const first = buildNotificationCandidates(OWNER, NOW, input).candidates.filter((candidate) => candidate.kind === "client_inactive");
  const second = buildNotificationCandidates(OWNER, NOW, input).candidates.filter((candidate) => candidate.kind === "client_inactive");
  assert.deepEqual(first, second);
});

test("a new inactivity episode after retraining produces a new dedupe key", () => {
  const episodeA = buildNotificationCandidates(OWNER, NOW, { ...emptyRows, inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-08T08:00:00.000Z"))] }).candidates.find((candidate) => candidate.kind === "client_inactive");
  // Client retrains (last workout 2026-09-01) and goes inactive again.
  const episodeB = buildNotificationCandidates(OWNER, new Date("2026-09-10T10:00:00.000Z"), { ...emptyRows, inactivityRows: [inactivityClient(20, "Maya", new Date("2026-09-01T08:00:00.000Z"))] }).candidates.find((candidate) => candidate.kind === "client_inactive");
  assert.ok(episodeA);
  assert.ok(episodeB);
  assert.notEqual(episodeA.dedupeKey, episodeB.dedupeKey);
});

test("future-dated last workout is safely ignored", () => {
  const result = buildNotificationCandidates(OWNER, NOW, {
    ...emptyRows,
    inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-20T08:00:00.000Z"))],
  });
  assert.equal(result.candidates.some((candidate) => candidate.kind === "client_inactive"), false);
});

test("never-trained clients (absent from inactivityRows) produce no alert", () => {
  const result = buildNotificationCandidates(OWNER, NOW, { ...emptyRows, inactivityRows: [] });
  assert.equal(result.candidates.some((candidate) => candidate.kind === "client_inactive"), false);
});

test("inactivity candidates are scoped to the evaluated coach", () => {
  const result = buildNotificationCandidates(OWNER, NOW, {
    ...emptyRows,
    inactivityRows: [inactivityClient(20, "Maya", new Date("2026-08-08T08:00:00.000Z"))],
  });
  result.candidates.filter((candidate) => candidate.kind === "client_inactive").forEach((candidate) => {
    assert.equal(candidate.ownerId, OWNER);
  });
});
