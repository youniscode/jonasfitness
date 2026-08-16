import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationCandidates, keyDate, parisDateKey } from "../app/lib/notification-evaluation.ts";
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
    { id: 102, name: "Converted", status: "converted", source: "Direct", nextFollowUpAt: new Date("2026-08-13T09:00:00.000Z") },
  ],
  progressRows: [
    { id: 1, clientId: 10, clientName: "Maya", weight: 64.2, energy: 7, adherence: 90, createdAt: new Date("2026-08-16T09:00:00.000Z") },
  ],
  workoutRows: [
    { id: 1, clientId: 10, clientName: "Maya", title: "Day 1", completedAt: new Date("2026-08-16T08:00:00.000Z"), completedSets: 12, totalVolume: 4800 },
  ],
};

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
    sessionRows: [], consultationRows: [], followUpRows: [], progressRows: [], workoutRows: [],
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

  // Lost and converted leads never produce follow-up reminders.
  assert.equal(activeFollowUps.length, 1);
  assert.equal(activeFollowUps[0].id, 100);

  // Every candidate belongs to the coach being evaluated.
  candidates.forEach((candidate) => assert.equal(candidate.ownerId, OWNER));
});
