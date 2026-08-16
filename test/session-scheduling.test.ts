import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attendancePending,
  canTransitionSession,
  creditDeltaForStatus,
  creditReasonForStatus,
  isSessionStatus,
  ledgerBalance,
  overlappingAppointment,
  planSessionCharge,
  sessionStatuses,
  sessionTransitions,
} from "../app/lib/session-scheduling.ts";

// ---------- Statuses + transitions ----------

test("session statuses are the four canonical attendance states", () => {
  assert.deepEqual(sessionStatuses, ["scheduled", "completed", "cancelled", "no_show"]);
  assert.equal(isSessionStatus("scheduled"), true);
  assert.equal(isSessionStatus("no_show"), true);
  assert.equal(isSessionStatus("attended"), false);
  assert.equal(isSessionStatus(undefined), false);
});

test("scheduled sessions can be completed, cancelled or no-showed", () => {
  assert.equal(canTransitionSession("scheduled", "completed"), true);
  assert.equal(canTransitionSession("scheduled", "cancelled"), true);
  assert.equal(canTransitionSession("scheduled", "no_show"), true);
});

test("completed and no-show are terminal", () => {
  assert.equal(canTransitionSession("completed", "cancelled"), false);
  assert.equal(canTransitionSession("completed", "no_show"), false);
  assert.equal(canTransitionSession("no_show", "completed"), false);
  assert.equal(canTransitionSession("no_show", "cancelled"), false);
});

test("cancelled may be reactivated back to scheduled", () => {
  assert.equal(canTransitionSession("cancelled", "scheduled"), true);
});

test("transition table is symmetric with the helper", () => {
  for (const from of sessionStatuses) {
    for (const to of sessionStatuses) {
      assert.equal(canTransitionSession(from, to), sessionTransitions[from].includes(to));
    }
  }
});

// ---------- Attendance pending ----------

test("a scheduled session whose end has passed is attendance pending", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(attendancePending("scheduled", new Date("2026-08-18T10:00:00.000Z"), 60, now), true);
});

test("a scheduled session still running or in the future is not pending", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(attendancePending("scheduled", new Date("2026-08-18T11:30:00.000Z"), 60, now), false);
  assert.equal(attendancePending("scheduled", new Date("2026-08-18T13:00:00.000Z"), 60, now), false);
});

test("only scheduled rows can be attendance pending", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(attendancePending("completed", new Date("2026-08-18T10:00:00.000Z"), 60, now), false);
  assert.equal(attendancePending("cancelled", new Date("2026-08-18T10:00:00.000Z"), 60, now), false);
  assert.equal(attendancePending("no_show", new Date("2026-08-18T10:00:00.000Z"), 60, now), false);
});

// ---------- Shared coach-availability overlap ----------

const active = [
  { id: 1, startAt: new Date("2026-08-18T10:00:00.000Z"), durationMinutes: 60 },
  { id: 2, startAt: new Date("2026-08-18T12:00:00.000Z"), durationMinutes: 30 },
];

test("overlapping slots conflict", () => {
  const conflict = overlappingAppointment(active, { startAt: new Date("2026-08-18T10:30:00.000Z"), durationMinutes: 60 });
  assert.equal(conflict?.id, 1);
});

test("back-to-back slots are allowed (one ends exactly when the next starts)", () => {
  assert.equal(overlappingAppointment(active, { startAt: new Date("2026-08-18T11:00:00.000Z"), durationMinutes: 60 }), undefined);
  assert.equal(overlappingAppointment(active, { startAt: new Date("2026-08-18T12:30:00.000Z"), durationMinutes: 30 }), undefined);
});

test("excludeId ignores the row being edited (reschedule)", () => {
  assert.equal(overlappingAppointment(active, { startAt: new Date("2026-08-18T10:30:00.000Z"), durationMinutes: 60, excludeId: 1 }), undefined);
  assert.equal(overlappingAppointment(active, { startAt: new Date("2026-08-18T10:30:00.000Z"), durationMinutes: 60, excludeId: 2 })?.id, 1);
});

// The helper is generic: consultations and PT sessions both hand their active
// rows here, so a scheduled session and an active consultation cannot overlap.
test("shared helper accepts both session and consultation rows", () => {
  const mixed = [
    { id: 1, startAt: new Date("2026-08-18T10:00:00.000Z"), durationMinutes: 60 }, // PT session
    { id: 2, startAt: new Date("2026-08-18T12:00:00.000Z"), durationMinutes: 45 }, // consultation
  ];
  assert.equal(overlappingAppointment(mixed, { startAt: new Date("2026-08-18T12:15:00.000Z"), durationMinutes: 30 })?.id, 2);
  assert.equal(overlappingAppointment(mixed, { startAt: new Date("2026-08-18T12:45:00.000Z"), durationMinutes: 30 }), undefined);
});

// ---------- Credit policy ----------

test("completed and no-show each consume exactly one credit; scheduled and cancelled consume zero", () => {
  assert.equal(creditDeltaForStatus("completed"), -1);
  assert.equal(creditDeltaForStatus("no_show"), -1);
  assert.equal(creditDeltaForStatus("scheduled"), 0);
  assert.equal(creditDeltaForStatus("cancelled"), 0);
});

test("credit reasons map to the consuming statuses only", () => {
  assert.equal(creditReasonForStatus("completed"), "session_completed");
  assert.equal(creditReasonForStatus("no_show"), "session_no_show");
  assert.equal(creditReasonForStatus("scheduled"), null);
  assert.equal(creditReasonForStatus("cancelled"), null);
});

// ---------- Idempotent charges ----------

test("completing a session plans exactly one debit", () => {
  const charge = planSessionCharge(7, "scheduled", "completed", []);
  assert.deepEqual(charge, { delta: -1, reason: "session_completed", relatedSessionId: 7 });
});

test("no-showing plans exactly one debit", () => {
  const charge = planSessionCharge(8, "scheduled", "no_show", []);
  assert.deepEqual(charge, { delta: -1, reason: "session_no_show", relatedSessionId: 8 });
});

test("cancelling consumes nothing", () => {
  assert.equal(planSessionCharge(9, "scheduled", "cancelled", []), null);
});

test("repeating completed or no-show never charges twice", () => {
  assert.equal(planSessionCharge(7, "completed", "completed", [{ reason: "session_completed" }]), null);
  assert.equal(planSessionCharge(8, "no_show", "no_show", [{ reason: "session_no_show" }]), null);
  // Even if the row is still scheduled but a charge already exists (retry), no second debit.
  assert.equal(planSessionCharge(7, "scheduled", "completed", [{ reason: "session_completed" }]), null);
});

test("an invalid transition never charges", () => {
  assert.equal(planSessionCharge(10, "completed", "cancelled", []), null);
  assert.equal(planSessionCharge(10, "no_show", "scheduled", []), null);
});

// ---------- Ledger balance ----------

test("balance is the sum of every ledger delta", () => {
  const ledger = [
    { delta: 10 },
    { delta: -1 },
    { delta: -1 },
    { delta: 2 },
  ];
  assert.equal(ledgerBalance(ledger), 10);
  assert.equal(ledgerBalance([]), 0);
});

test("an unrelated client's ledger is isolated from the balance", () => {
  const mine = [{ delta: 10 }, { delta: -1 }];
  const theirs = [{ delta: 20 }];
  assert.equal(ledgerBalance(mine), 9);
  assert.equal(ledgerBalance(theirs), 20);
});
