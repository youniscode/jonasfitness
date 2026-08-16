import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRescheduleConsultation,
  canTransitionConsultation,
  consultationStatuses,
  followUpActivity,
  overlappingConsultation,
} from "../app/lib/lead-follow-up.ts";
import {
  formatParisDateTime,
  formatParisShort,
  parisFromInput,
  parisInDays,
  parisInputValue,
} from "../app/lib/paris-time.ts";

// ---------- Consultation lifecycle ----------

test("consultation statuses are canonical", () => {
  assert.deepEqual([...consultationStatuses], ["scheduled", "completed", "cancelled", "no_show"]);
});

test("scheduled consultations can complete, cancel or no-show", () => {
  assert.equal(canTransitionConsultation("scheduled", "completed"), true);
  assert.equal(canTransitionConsultation("scheduled", "cancelled"), true);
  assert.equal(canTransitionConsultation("scheduled", "no_show"), true);
  assert.equal(canTransitionConsultation("scheduled", "scheduled"), true);
});

test("completed and no-show consultations are terminal", () => {
  assert.equal(canTransitionConsultation("completed", "completed"), true);
  assert.equal(canTransitionConsultation("completed", "scheduled"), false);
  assert.equal(canTransitionConsultation("completed", "cancelled"), false);
  assert.equal(canTransitionConsultation("no_show", "no_show"), true);
  assert.equal(canTransitionConsultation("no_show", "scheduled"), false);
  assert.equal(canTransitionConsultation("no_show", "completed"), false);
});

test("cancelled consultations can be reactivated", () => {
  assert.equal(canTransitionConsultation("cancelled", "scheduled"), true);
  assert.equal(canTransitionConsultation("cancelled", "cancelled"), true);
  assert.equal(canTransitionConsultation("cancelled", "completed"), false);
  assert.equal(canTransitionConsultation("cancelled", "no_show"), false);
});

test("only scheduled consultations can be rescheduled", () => {
  assert.equal(canRescheduleConsultation("scheduled"), true);
  assert.equal(canRescheduleConsultation("completed"), false);
  assert.equal(canRescheduleConsultation("no_show"), false);
  assert.equal(canRescheduleConsultation("cancelled"), false);
});

// ---------- Conflict / overlap detection ----------

const scheduled = [
  { id: 1, leadId: 10, startAt: new Date("2026-08-18T12:00:00.000Z"), durationMinutes: 30 },
  { id: 2, leadId: 11, startAt: new Date("2026-08-18T13:00:00.000Z"), durationMinutes: 30 },
];

test("overlapping slot is rejected", () => {
  const conflict = overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T12:15:00.000Z"), durationMinutes: 30 });
  assert.equal(conflict?.id, 1);
});

test("back-to-back slots do not conflict", () => {
  assert.equal(overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T12:30:00.000Z"), durationMinutes: 30 }), undefined);
  // Exact same slot as an existing row does conflict.
  assert.equal(overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T13:00:00.000Z"), durationMinutes: 30 })?.id, 2);
});

test("non-overlapping slot is free", () => {
  assert.equal(overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T14:00:00.000Z"), durationMinutes: 60 }), undefined);
});

test("reschedule excludes the row being edited", () => {
  assert.equal(overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T12:00:00.000Z"), durationMinutes: 30, excludeId: 1 }), undefined);
  assert.equal(overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T12:00:00.000Z"), durationMinutes: 30, excludeId: 2 })?.id, 1);
});

test("cancelled/completed rows never block (they are not in the scheduled set)", () => {
  const conflict = overlappingConsultation(scheduled, { startAt: new Date("2026-08-18T13:30:00.000Z"), durationMinutes: 30 });
  assert.equal(conflict, undefined);
});

// ---------- Follow-up timeline wording ----------

test("follow-up activity titles distinguish schedule, change, clear and done", () => {
  const date = new Date("2026-08-20T10:00:00.000Z");
  const later = new Date("2026-08-22T10:00:00.000Z");
  assert.deepEqual(followUpActivity(null, date, undefined), { title: "Follow-up scheduled", detail: date.toISOString() });
  assert.deepEqual(followUpActivity(date, later, undefined), { title: "Follow-up rescheduled", detail: later.toISOString() });
  assert.deepEqual(followUpActivity(date, null, undefined), { title: "Follow-up cleared", detail: "" });
  assert.deepEqual(followUpActivity(date, null, "done"), { title: "Follow-up completed", detail: "" });
  assert.deepEqual(followUpActivity(date, null, "clear"), { title: "Follow-up cleared", detail: "" });
});

// ---------- Europe/Paris timezone helpers ----------

test("parisInputValue renders the Paris wall clock (CEST summer / CET winter)", () => {
  assert.equal(parisInputValue(new Date("2026-08-16T12:00:00.000Z")), "2026-08-16T14:00"); // UTC+2
  assert.equal(parisInputValue(new Date("2026-01-16T12:00:00.000Z")), "2026-01-16T13:00"); // UTC+1
  assert.equal(parisInputValue(new Date("2026-08-16T22:00:00.000Z")), "2026-08-17T00:00"); // Paris midnight rollover
});

test("parisFromInput converts a Paris wall clock back to a UTC instant", () => {
  assert.equal(parisFromInput("2026-08-16T14:00")?.toISOString(), "2026-08-16T12:00:00.000Z");
  assert.equal(parisFromInput("2026-01-16T13:00")?.toISOString(), "2026-01-16T12:00:00.000Z");
});

test("parisFromInput rejects malformed input", () => {
  assert.equal(parisFromInput("garbage"), null);
  assert.equal(parisFromInput("2026-08-16"), null);
  assert.equal(parisFromInput(""), null);
});

test("parisFromInput / parisInputValue round-trip on stable instants", () => {
  const instants = [
    "2026-08-16T10:00:00.000Z",
    "2026-08-16T22:59:00.000Z", // 00:59 next Paris day
    "2026-01-16T23:30:00.000Z",
    "2026-03-28T23:30:00.000Z", // just before spring-forward day
    "2026-10-24T23:30:00.000Z", // just before fall-back day
    "2026-03-29T00:00:00.000Z", // spring-forward day, pre-transition
  ];
  for (const iso of instants) {
    const date = new Date(iso);
    const restored = parisFromInput(parisInputValue(date));
    assert.ok(restored, `round-trip failed for ${iso}`);
    assert.equal(restored.getTime(), date.getTime(), `round-trip mismatch for ${iso}`);
  }
});

test("nonexistent spring-forward time snaps forward deterministically", () => {
  // 2026-03-29 02:00 CET jumps to 03:00 CEST, so 02:30 never occurs on the
  // Paris calendar. The closest later instant (02:30 CEST = 01:30 UTC) wins.
  const result = parisFromInput("2026-03-29T02:30");
  assert.ok(result);
  assert.equal(result.toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(parisInputValue(result), "2026-03-29T03:30");
});

test("ambiguous fall-back time resolves to the later (CET) instant", () => {
  // 2026-10-25 02:30 occurs twice (CEST then CET). The later instant wins,
  // deterministically — server and UI share the same function.
  const result = parisFromInput("2026-10-25T02:30");
  assert.ok(result);
  assert.equal(result.toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(parisInputValue(result), "2026-10-25T02:30");
});

test("parisInDays keeps the same Paris wall time across DST transitions", () => {
  // Summer (no transition): +1 day keeps 12:00 Paris = 10:00 UTC.
  assert.equal(parisInDays(new Date("2026-08-16T10:00:00.000Z"), 1).toISOString(), "2026-08-17T10:00:00.000Z");
  // Across spring-forward: 11:00 CET becomes 11:00 CEST (= 09:00 UTC).
  assert.equal(parisInDays(new Date("2026-03-28T10:00:00.000Z"), 1).toISOString(), "2026-03-29T09:00:00.000Z");
  // Across fall-back: 12:00 CEST becomes 12:00 CET (= 11:00 UTC).
  assert.equal(parisInDays(new Date("2026-10-24T10:00:00.000Z"), 1).toISOString(), "2026-10-25T11:00:00.000Z");
});

test("format helpers render Europe/Paris time, not UTC", () => {
  assert.ok(formatParisDateTime(new Date("2026-08-16T12:00:00.000Z")).includes("14:00"));
  assert.ok(formatParisShort(new Date("2026-01-16T12:00:00.000Z")).includes("13:00"));
});
