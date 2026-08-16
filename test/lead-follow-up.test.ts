import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTypes,
  consultationStatuses,
  consultationValues,
  followUpInactiveStatuses,
  isActivityType,
  isConsultationStatus,
  isFollowUpActive,
  optionalDate,
} from "../app/lib/lead-follow-up.ts";

const NOW = new Date("2026-08-16T10:00:00.000Z");

test("follow-up inactive statuses are the canonical client/lost set", () => {
  assert.deepEqual([...followUpInactiveStatuses], ["client", "lost"]);
});

test("isFollowUpActive requires a due date and a non-terminal status", () => {
  const past = new Date("2026-08-15T10:00:00.000Z");
  const future = new Date("2026-08-17T10:00:00.000Z");
  assert.equal(isFollowUpActive("new", past, NOW), true);
  assert.equal(isFollowUpActive("contacted", past, NOW), true);
  assert.equal(isFollowUpActive("qualified", past, NOW), true);
  assert.equal(isFollowUpActive("lost", past, NOW), false);
  assert.equal(isFollowUpActive("client", past, NOW), false);
  // "converted" is not a real status and is therefore never inactive-only.
  assert.equal(isFollowUpActive("converted", past, NOW), true);
  assert.equal(isFollowUpActive("new", future, NOW), false);
  assert.equal(isFollowUpActive("new", null, NOW), false);
});

test("optionalDate parses, nulls and rejects", () => {
  assert.ok(optionalDate("2026-08-16T10:00:00.000Z") instanceof Date);
  assert.equal(optionalDate(null), null);
  assert.equal(optionalDate(""), null);
  assert.equal(optionalDate("garbage"), undefined);
});

test("consultation statuses are constrained", () => {
  assert.deepEqual([...consultationStatuses], ["scheduled", "completed", "cancelled", "no_show"]);
  assert.equal(isConsultationStatus("completed"), true);
  assert.equal(isConsultationStatus("no_show"), true);
  assert.equal(isConsultationStatus("won"), false);
});

test("activity types are constrained", () => {
  assert.deepEqual([...activityTypes], ["note", "phone", "email", "whatsapp", "status", "follow_up", "consultation"]);
  assert.equal(isActivityType("note"), true);
  assert.equal(isActivityType("consultation"), true);
  assert.equal(isActivityType("bogus"), false);
});

test("consultationValues clamps duration and truncates notes", () => {
  const values = consultationValues({ startAt: "2026-08-20T10:00:00.000Z", durationMinutes: 999, notes: "n".repeat(2000) });
  assert.equal(values.durationMinutes, 120);
  assert.equal(values.notes.length, 800);
});
