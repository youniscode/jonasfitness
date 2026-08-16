import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicClient,
  publicIntake,
  publicProgramme,
  publicProgressEntry,
  publicWorkout,
} from "../app/lib/client-dto.ts";

function assertNoOwnerId(value: unknown) {
  assert.equal(typeof value, "object");
  assert.equal(value === null, false);
  assert.equal("ownerId" in (value as object), false, `ownerId leaked in ${JSON.stringify(value)}`);
}

test("publicClient whitelists client-facing fields and omits ownerId", () => {
  const result = publicClient({ id: 1, name: "Alex", goal: "Build muscle", sessionsPerWeek: 4, currentWeight: 80 });
  assertNoOwnerId(result);
  assert.deepEqual(result, { id: 1, name: "Alex", goal: "Build muscle", sessionsPerWeek: 4, currentWeight: 80 });
});

test("publicProgramme omits ownerId", () => {
  const result = publicProgramme({ title: "Hypertrophy", goal: "Build muscle", sessionsPerWeek: 4, content: "{}" });
  assertNoOwnerId(result);
  assert.equal(result.title, "Hypertrophy");
});

test("publicProgressEntry omits ownerId", () => {
  const result = publicProgressEntry({
    id: 1,
    weight: 80,
    waist: null,
    chest: null,
    hips: null,
    arm: null,
    thigh: null,
    energy: 7,
    sleep: 6,
    adherence: 90,
    notes: "",
    photoData: "",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  assertNoOwnerId(result);
  assert.equal(result.id, 1);
});

test("publicWorkout omits ownerId", () => {
  const result = publicWorkout(
    { id: 9, title: "Push", notes: "", status: "active", startedAt: new Date(), completedAt: null },
    [],
  );
  assertNoOwnerId(result);
  assert.equal(result.id, 9);
});

test("publicIntake omits ownerId", () => {
  const result = publicIntake({
    preferredLanguage: "fr",
    trainingExperience: "Intermédiaire",
    availability: "Mon/Wed",
    equipment: "",
    goalsDetail: "Strength",
    trainingConsiderations: "",
    consentAt: new Date(),
    updatedAt: new Date(),
  });
  assertNoOwnerId(result);
  assert.equal(result.preferredLanguage, "fr");
});
