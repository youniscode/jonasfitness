import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBodyMeasurementTrend,
  DEFAULT_MEASUREMENT_SOURCE,
  estimateLeanMassKg,
  isMeasurementOwnedBy,
  latestMeasurement,
  latestWeightKg,
  measurementDeltas,
  MEASUREMENT_BOUNDS,
  MEASUREMENT_SOURCES,
  previousMeasurement,
  resolveLeanMass,
  sortMeasurementsByDate,
  validateBodyMeasurement,
  type BodyMeasurement,
  type BodyMeasurementInput,
} from "../app/lib/body-measurements.ts";

let counter = 0;
function measurement(overrides: Partial<BodyMeasurement> = {}): BodyMeasurement {
  counter += 1;
  return {
    id: counter,
    clientId: 7,
    ownerId: "coach-a",
    measuredAt: "2026-08-01T00:00:00.000Z",
    weightKg: null,
    bodyFatPercent: null,
    leanMassKg: null,
    waistCm: null,
    chestCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
    source: "coach",
    notes: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<BodyMeasurementInput> = {}): BodyMeasurementInput {
  return {
    clientId: 7,
    ownerId: "coach-a",
    weightKg: 84.5,
    bodyFatPercent: null,
    leanMassKg: null,
    waistCm: null,
    chestCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
    ...overrides,
  };
}

// ---------- 1. Validation: accepted shapes ----------

test("valid partial measurement (weight + waist) is accepted", () => {
  const result = validateBodyMeasurement(input({ weightKg: 84.5, waistCm: 92 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weightKg, 84.5);
    assert.equal(result.value.waistCm, 92);
  }
});

test("weight-only measurement is accepted", () => {
  const result = validateBodyMeasurement(input({ weightKg: 75.2 }));
  assert.equal(result.ok, true);
});

test("body-fat-only measurement is accepted (body fat stays optional, one real value suffices)", () => {
  const result = validateBodyMeasurement(input({ weightKg: null, bodyFatPercent: 18 }));
  assert.equal(result.ok, true);
});

test("unspecified source defaults to coach; notes are trimmed", () => {
  const result = validateBodyMeasurement(input({ source: undefined, notes: "  first weigh-in  " }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.source, DEFAULT_MEASUREMENT_SOURCE);
    assert.equal(result.value.notes, "first weigh-in");
  }
});

// ---------- 2. Validation: rejections ----------

test("empty measurement (notes only) is rejected", () => {
  const result = validateBodyMeasurement(input({ weightKg: null, notes: "client looked good" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.field === "measurements"), "at-least-one-measurement error present");
  }
});

test("NaN is rejected", () => {
  const result = validateBodyMeasurement(input({ weightKg: Number.NaN }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "weightKg"));
});

test("Infinity is rejected", () => {
  const result = validateBodyMeasurement(input({ weightKg: Number.POSITIVE_INFINITY }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "weightKg"));
});

test("negative values are rejected", () => {
  const result = validateBodyMeasurement(input({ weightKg: -5 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "weightKg"));
});

test("unreasonable body-fat is rejected (below and above bounds)", () => {
  assert.equal(validateBodyMeasurement(input({ weightKg: null, bodyFatPercent: 0.5 })).ok, false);
  assert.equal(validateBodyMeasurement(input({ weightKg: null, bodyFatPercent: 85 })).ok, false);
});

test("out-of-bounds measurements are rejected, never clamped", () => {
  const low = validateBodyMeasurement(input({ weightKg: MEASUREMENT_BOUNDS.weightKg.min - 1 }));
  const high = validateBodyMeasurement(input({ waistCm: MEASUREMENT_BOUNDS.waistCm.max + 1 }));
  assert.equal(low.ok, false);
  assert.equal(high.ok, false);
});

test("invalid source is rejected", () => {
  const result = validateBodyMeasurement(input({ source: "garmin" as never }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "source"));
});

test("missing or invalid owner/client identifiers are rejected", () => {
  assert.equal(validateBodyMeasurement(input({ ownerId: "  " })).ok, false);
  assert.equal(validateBodyMeasurement(input({ clientId: 0 })).ok, false);
});

// ---------- 3. Lean-mass derivation ----------

test("lean mass is derived deterministically from weight + body-fat %", () => {
  const derived = estimateLeanMassKg(80, 20);
  assert.deepEqual(derived, { leanMassKg: 64, estimated: true });
});

test("derived lean mass follows the 1-decimal rounding convention", () => {
  assert.equal(estimateLeanMassKg(83.4, 18.3)?.leanMassKg, 68.1);
});

test("lean-mass derivation returns null when either input is missing, non-finite or out of bounds", () => {
  assert.equal(estimateLeanMassKg(null, 20), null);
  assert.equal(estimateLeanMassKg(80, null), null);
  assert.equal(estimateLeanMassKg(Number.NaN, 20), null);
  assert.equal(estimateLeanMassKg(80, 99), null);
});

test("explicit measured leanMassKg wins over the estimated value", () => {
  const resolution = resolveLeanMass({ leanMassKg: 66.5, weightKg: 80, bodyFatPercent: 20 });
  assert.deepEqual(resolution, { leanMassKg: 66.5, estimated: false, source: "measured" });
});

test("lean mass is estimated (flagged) when only weight + body-fat % are available", () => {
  const resolution = resolveLeanMass({ leanMassKg: null, weightKg: 80, bodyFatPercent: 20 });
  assert.deepEqual(resolution, { leanMassKg: 64, estimated: true, source: "derived" });
});

test("lean mass stays missing when neither measured nor derivable", () => {
  assert.deepEqual(resolveLeanMass({ leanMassKg: null, weightKg: null, bodyFatPercent: null }), {
    leanMassKg: null,
    estimated: false,
    source: "missing",
  });
});

// ---------- 4. Latest / previous / deltas ----------

test("latest and previous resolution is chronological and idempotent on unsorted input", () => {
  const rows = [
    measurement({ id: 1, measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84 }),
    measurement({ id: 2, measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4 }),
    measurement({ id: 3, measuredAt: "2026-08-08T00:00:00.000Z", weightKg: 83.1 }),
  ];
  assert.equal(latestMeasurement(rows)?.id, 2);
  assert.equal(previousMeasurement(rows)?.id, 3);
  // Same rows in different input order produce the same chronological order.
  const reversed = [rows[2], rows[0], rows[1]];
  assert.deepEqual(sortMeasurementsByDate(reversed).map((r) => r.id), [1, 3, 2]);
});

test("chronological ties are broken by ascending id", () => {
  const rows = [
    measurement({ id: 10, measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 80 }),
    measurement({ id: 11, measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 79.5 }),
  ];
  assert.equal(latestMeasurement(rows)?.id, 11);
});

test("latest/previous are null for zero or one measurement", () => {
  assert.equal(latestMeasurement([]), null);
  assert.equal(previousMeasurement([]), null);
  const only = [measurement({ weightKg: 80 })];
  assert.equal(latestMeasurement(only)?.id, only[0].id);
  assert.equal(previousMeasurement(only), null);
});

test("weight, waist and body-fat deltas are calculated from latest − previous", () => {
  const latest = measurement({ measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4, waistCm: 90, bodyFatPercent: 18 });
  const previous = measurement({ measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84, waistCm: 92.5, bodyFatPercent: 19.5 });
  const deltas = measurementDeltas(latest, previous);
  assert.equal(deltas.weightKg.value, 82.4);
  assert.equal(deltas.weightKg.change, -1.6);
  assert.equal(deltas.waistCm.change, -2.5);
  assert.equal(deltas.bodyFatPercent.change, -1.5);
});

test("missing values are never treated as zero — the delta is null, not 0", () => {
  const latest = measurement({ measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4 });
  const previous = measurement({ measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84 });
  const deltas = measurementDeltas(latest, previous);
  assert.equal(deltas.waistCm.value, null);
  assert.equal(deltas.waistCm.change, null, "missing waist must stay missing");
  assert.equal(deltas.leanMassKg.change, null);
  // A real zero-change is only reported when BOTH sides carry a value.
  const same = measurementDeltas(latest, measurement({ measuredAt: "2026-08-14T00:00:00.000Z", weightKg: 82.4 }));
  assert.equal(same.weightKg.change, 0);
});

test("trend aggregates latest, previous, deltas and lean-mass resolution", () => {
  const trend = buildBodyMeasurementTrend([
    measurement({ measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 80, bodyFatPercent: 20 }),
    measurement({ measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 79, bodyFatPercent: 19 }),
  ]);
  assert.equal(trend.count, 2);
  assert.equal(trend.latest?.weightKg, 79);
  assert.equal(trend.previous?.weightKg, 80);
  assert.equal(trend.deltas.weightKg.change, -1);
  assert.deepEqual(trend.leanMass, { leanMassKg: 64, estimated: true, source: "derived" });
});

test("empty history produces an empty trend with no fabricated values", () => {
  const trend = buildBodyMeasurementTrend([]);
  assert.equal(trend.count, 0);
  assert.equal(trend.latest, null);
  assert.equal(trend.previous, null);
  assert.equal(trend.deltas.weightKg.value, null);
  assert.equal(trend.deltas.weightKg.change, null);
  assert.equal(trend.leanMass.source, "missing");
});

test("same inputs return the same trend (deterministic output)", () => {
  const rows = [
    measurement({ measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84, waistCm: 92 }),
    measurement({ measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4, waistCm: 90.5, bodyFatPercent: 18 }),
  ];
  assert.deepEqual(buildBodyMeasurementTrend(rows), buildBodyMeasurementTrend([...rows].reverse()));
});

// ---------- 5. Source vocabulary ----------

test("the canonical source vocabulary is coach | client | progress_import", () => {
  assert.deepEqual(MEASUREMENT_SOURCES, ["coach", "client", "progress_import"]);
  for (const source of MEASUREMENT_SOURCES) {
    assert.equal(validateBodyMeasurement(input({ source })).ok, true, `${source} is a valid source`);
  }
});

// ---------- 6. Owner isolation ----------

test("owner scoping rejects a measurement row for a different owner or client", () => {
  const row = measurement({ id: 5, clientId: 7, ownerId: "coach-a" });
  assert.equal(isMeasurementOwnedBy(row, 7, "coach-a"), true);
  assert.equal(isMeasurementOwnedBy(row, 7, "coach-b"), false, "different owner must be rejected");
  assert.equal(isMeasurementOwnedBy(row, 8, "coach-a"), false, "different client must be rejected");
  assert.equal(isMeasurementOwnedBy(null, 7, "coach-a"), false);
  assert.equal(isMeasurementOwnedBy(undefined, 7, "coach-a"), false);
});

// ---------- 7. Current-weight cache sync source ----------

test("latestWeightKg reports the ledger's latest weight for the currentWeight cache sync", () => {
  const rows = [
    measurement({ measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84 }),
    measurement({ measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4 }),
  ];
  assert.equal(latestWeightKg(rows), 82.4);
  assert.equal(latestWeightKg([]), null);
});
