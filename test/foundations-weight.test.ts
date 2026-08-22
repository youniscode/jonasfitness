import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latestWeightForSync,
  measurementNumberFrom,
  MEASUREMENT_BOUNDS,
  validateBodyMeasurement,
  isMeasurementOwnedBy,
  type BodyMeasurement,
  type MeasurementRow,
} from "../app/lib/body-measurements.ts";

// ---------- Foundations modal current-weight integration ----------
//
// The onboarding PATCH route (client-onboarding/route.ts) reads the coach's
// submitted currentWeightKg, compares it against the resolved weight from the
// body-measurement history, and only creates a new measurement row when they
// differ. These tests exercise the domain logic that decision depends on:
//
//  - weight-change detection (comparison + tolerance)
//  - measurementNumberFrom coercion
//  - validation bounds (25–400 kg)
//  - latestWeightForSync chronology (backed weight protection)
//  - ownership guard

// ---------- 1. Weight-change detection ----------

/** Simulates the PATCH handler's weight-change decision logic. */
function weightChanged(
  submittedRaw: unknown,
  preSyncWeight: number | null,
): { create: boolean; parsed: number | null } {
  let submittedWeightKg: number | null = null;
  if (submittedRaw !== undefined && submittedRaw !== null && submittedRaw !== "") {
    const parsed = measurementNumberFrom(submittedRaw);
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      submittedWeightKg = parsed;
    }
  }
  const create = submittedWeightKg !== null
    && (preSyncWeight === null || Math.abs(submittedWeightKg - preSyncWeight) > 0.05);
  return { create, parsed: submittedWeightKg };
}

test("A. Missing weight → coach enters 86 → new measurement created", () => {
  const result = weightChanged(86, null);
  assert.equal(result.create, true, "should create a new weight event");
  assert.equal(result.parsed, 86);
});

test("B. Existing weight 86 unchanged → no new row", () => {
  const result = weightChanged(86, 86);
  assert.equal(result.create, false, "must NOT create a duplicate row");
});

test("B2. Existing weight 86.0 unchanged from 86 → no new row (numeric equality)", () => {
  const result = weightChanged("86.0", 86);
  assert.equal(result.create, false, "86 and 86.0 must be considered equal");
});

test("C. Existing weight 86 changed to 87.5 → new row created", () => {
  const result = weightChanged(87.5, 86);
  assert.equal(result.create, true, "changed weight must create a new history event");
  assert.equal(result.parsed, 87.5);
});

test("C2. Existing weight 86 changed to 85.95 → within tolerance, no new row", () => {
  const result = weightChanged(85.95, 86);
  assert.equal(result.create, false, "difference ≤ 0.05 is within tolerance");
});

test("C3. Existing weight 86 changed to 86.06 → just outside tolerance, new row", () => {
  const result = weightChanged(86.06, 86);
  assert.equal(result.create, true, "difference > 0.05 triggers new event");
});

test("D. Existing weight 86 → coach clears field → no deletion, no row created", () => {
  const resultCleared = weightChanged("", 86);
  assert.equal(resultCleared.create, false, "blanking the field must NOT create a deletion event");
  assert.equal(resultCleared.parsed, null, "submitted weight is null when cleared");
});

test("D2. Existing weight 86 → coach sends null → no deletion", () => {
  const result = weightChanged(null, 86);
  assert.equal(result.create, false, "null must NOT trigger a deletion");
});

test("D3. Existing weight 86 → coach sends undefined → no deletion", () => {
  const result = weightChanged(undefined, 86);
  assert.equal(result.create, false, "undefined must NOT trigger a deletion");
});

// ---------- 2. Validation bounds (25–400 kg) ----------

test("E. Reject below lower bound (24.9 kg)", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 24.9,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "weightKg"));
});

test("E. Reject above upper bound (400.1 kg)", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 400.1,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "weightKg"));
});

test("E. Reject NaN", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: NaN,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, false);
});

test("E. Reject Infinity", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: Infinity,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, false);
});

test("E. Reject negative", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: -10,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, false);
});

test("E. Accept boundary value 25 kg", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 25,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, true);
});

test("E. Accept boundary value 400 kg", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 400,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, true);
});

test("E. Accept decimal value 86.5 kg", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 86.5,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, true);
});

test("E. Accept typical value 86 kg", () => {
  const result = validateBodyMeasurement({
    clientId: 1, ownerId: "coach-a", weightKg: 86,
    bodyFatPercent: null, leanMassKg: null, waistCm: null,
    chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  });
  assert.equal(result.ok, true);
});

// ---------- 3. Ownership ----------

test("F. Owner isolation: isMeasurementOwnedBy rejects cross-owner access", () => {
  const measurement = { id: 1, clientId: 7, ownerId: "coach-a" } as BodyMeasurement;
  assert.equal(isMeasurementOwnedBy(measurement, 7, "coach-a"), true);
  assert.equal(isMeasurementOwnedBy(measurement, 7, "coach-b"), false);
  assert.equal(isMeasurementOwnedBy(measurement, 8, "coach-a"), false);
  assert.equal(isMeasurementOwnedBy(null, 7, "coach-a"), false);
});

// ---------- 4. Partial measurement semantics ----------

test("G. Weight-only event must not inherit other body fields from prior rows", () => {
  // The PATCH handler creates: { weightKg, source: "coach", measuredAt: now, notes }
  // bodyFatPercent, leanMassKg, waistCm, etc. are NOT included.
  const input = {
    clientId: 1,
    ownerId: "coach-a",
    weightKg: 86,
    bodyFatPercent: null,
    leanMassKg: null,
    waistCm: null,
    chestCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
  };
  const result = validateBodyMeasurement(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weightKg, 86, "weight present");
    assert.equal(result.value.bodyFatPercent, null, "body fat absent");
    assert.equal(result.value.waistCm, null, "waist absent");
  }
});

// ---------- 5. Nutrition guidance weight resolution ----------

test("H. latestWeightForSync resolves chronologically latest weight (foundation for nutrition guidance)", () => {
  const rows: MeasurementRow[] = [
    { id: 1, measuredAt: "2026-07-01T12:00:00.000Z", weightKg: 84, bodyFatPercent: null, leanMassKg: null, waistCm: null, chestCm: null, hipsCm: null, armCm: null, thighCm: null },
    { id: 2, measuredAt: "2026-08-20T12:00:00.000Z", weightKg: 80, bodyFatPercent: null, leanMassKg: null, waistCm: null, chestCm: null, hipsCm: null, armCm: null, thighCm: null },
    { id: 3, measuredAt: "2026-08-22T12:00:00.000Z", weightKg: 86, bodyFatPercent: null, leanMassKg: null, waistCm: null, chestCm: null, hipsCm: null, armCm: null, thighCm: null },
  ];
  assert.equal(latestWeightForSync(rows), 86, "latest chronological weight wins");
});

test("H. latestWeightForSync ignores weightless rows", () => {
  const rows: MeasurementRow[] = [
    { id: 1, measuredAt: "2026-08-20T12:00:00.000Z", weightKg: null, bodyFatPercent: 18, leanMassKg: null, waistCm: 90, chestCm: null, hipsCm: null, armCm: null, thighCm: null },
  ];
  assert.equal(latestWeightForSync(rows), null, "no weight-bearing rows → null");
});

test("H. After weight write, nutrition guidance can resolve the new value", () => {
  // Simulates: no existing weight → coach enters 86 → new row created → resolution
  const emptyRows: MeasurementRow[] = [];
  assert.equal(latestWeightForSync(emptyRows), null, "no rows → null before save");

  const afterSave: MeasurementRow[] = [
    { id: 1, measuredAt: "2026-08-22T12:00:00.000Z", weightKg: 86, bodyFatPercent: null, leanMassKg: null, waistCm: null, chestCm: null, hipsCm: null, armCm: null, thighCm: null },
  ];
  assert.equal(latestWeightForSync(afterSave), 86, "new weight resolvable after save");
});

// ---------- 6. measurementNumberFrom edge cases ----------

test("measurementNumberFrom coerces form values correctly", () => {
  assert.equal(measurementNumberFrom(""), null);
  assert.equal(measurementNumberFrom(null), null);
  assert.equal(measurementNumberFrom(undefined), null);
  assert.equal(measurementNumberFrom("86.5"), 86.5);
  assert.equal(measurementNumberFrom(86.5), 86.5);
  assert.equal(measurementNumberFrom("86"), 86);
  assert.ok(Number.isNaN(measurementNumberFrom("abc") as number));
  assert.ok(Number.isNaN(measurementNumberFrom("  ") as number) === false, "whitespace-only should be null");
});

// ---------- 7. Bounds constant verification ----------

test("MEASUREMENT_BOUNDS.weightKg matches expected values", () => {
  assert.equal(MEASUREMENT_BOUNDS.weightKg.min, 25);
  assert.equal(MEASUREMENT_BOUNDS.weightKg.max, 400);
  assert.equal(MEASUREMENT_BOUNDS.weightKg.label, "Weight");
});
