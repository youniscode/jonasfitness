import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBodyMeasurementTrend,
  latestWeightForSync,
  measurementInputFrom,
  measurementNumberFrom,
  MEASUREMENT_NOTE_MAX,
  parseMeasurementDate,
  patchMeasurementInputFrom,
  publicBodyMeasurement,
  validateBodyMeasurement,
  validatePatchBodyMeasurement,
  type BodyMeasurement,
  type BodyMeasurementTrend,
  type PublicBodyMeasurement,
} from "../app/lib/body-measurements.ts";

// The route (app/api/body-measurements/route.ts) is a thin wire over the pure
// domain module: GET = ownership lookup + owner/client-scoped query +
// public-DTO mapping + trend; POST = measurementInputFrom → ownership lookup →
// validateBodyMeasurement → transactional insert + latestWeightForSync →
// clients.currentWeight sync. These tests exercise that exact logic in the
// same sequence with an in-memory store, so the security and sync contracts
// are verified without a live database (the repo's established test pattern).

const NOW = "2026-08-21T10:00:00.000Z";

type Store = {
  clients: { id: number; ownerId: string; currentWeight: number | null }[];
  measurements: BodyMeasurement[];
  nextId: number;
};

type GetOk = { status: 200; measurements: PublicBodyMeasurement[]; trend: BodyMeasurementTrend };
type GetResult = GetOk | { status: 404; error: string };

type PostResult =
  | { status: 201; measurement: PublicBodyMeasurement; currentWeight: number | null }
  | { status: 400 | 404; error: string };

function makeStore(ownerId = "coach-a", clientId = 7, currentWeight: number | null = 80): Store {
  return {
    clients: [{ id: clientId, ownerId, currentWeight }],
    measurements: [],
    nextId: 1,
  };
}

/** Mirrors GET in app/api/body-measurements/route.ts. */
function simulateGet(store: Store, clientId: number, ownerId: string): GetResult {
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, error: "Client not found." };
  const rows = store.measurements
    .filter((m) => m.clientId === clientId && m.ownerId === ownerId)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || b.id - a.id)
    .slice(0, 24);
  const measurements = rows.map(publicBodyMeasurement);
  return { status: 200, measurements, trend: buildBodyMeasurementTrend(measurements) };
}

/** Mirrors POST in app/api/body-measurements/route.ts (transactional steps in order). */
function simulatePost(store: Store, body: Record<string, unknown>, ownerId: string, now: string): PostResult {
  const parsed = measurementInputFrom(body, ownerId, now);
  if (!parsed.ok) return { status: 400, error: parsed.error };
  const { input, measuredAt } = parsed;
  const client = store.clients.find((c) => c.id === input.clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, error: "Client not found." };
  const validation = validateBodyMeasurement(input);
  if (!validation.ok) return { status: 400, error: validation.errors.map((e) => e.message).join(" ") };

  const row: BodyMeasurement = {
    id: store.nextId++,
    clientId: input.clientId,
    ownerId,
    measuredAt,
    weightKg: input.weightKg,
    bodyFatPercent: input.bodyFatPercent,
    leanMassKg: input.leanMassKg,
    waistCm: input.waistCm,
    chestCm: input.chestCm,
    hipsCm: input.hipsCm,
    armCm: input.armCm,
    thighCm: input.thighCm,
    source: input.source ?? "coach",
    notes: input.notes ?? "",
    createdAt: now,
  };
  store.measurements.push(row);

  let syncedWeight = client.currentWeight;
  if (typeof input.weightKg === "number") {
    syncedWeight = latestWeightForSync(store.measurements.filter((m) => m.clientId === input.clientId && m.ownerId === ownerId));
    client.currentWeight = syncedWeight;
  }
  return { status: 201, measurement: publicBodyMeasurement(row), currentWeight: syncedWeight };
}

/** Asserts success and narrows the result for type-safe property access. */
function expect201(result: PostResult): Extract<PostResult, { status: 201 }> {
  assert.equal(result.status, 201);
  if (result.status !== 201) throw new Error("expected 201");
  return result;
}

/** Asserts success and narrows the result for type-safe property access. */
function expectOk(get: GetResult): GetOk {
  assert.equal(get.status, 200);
  if (get.status !== 200) throw new Error("expected 200");
  return get;
}

const weightBody = (overrides: Record<string, unknown> = {}) => ({ clientId: 7, measuredAt: "2026-08-20", weightKg: 79.5, ...overrides });

// ---------- 1. Owner isolation ----------

test("GET denies reading measurements for a client owned by another coach", () => {
  const store = makeStore();
  simulatePost(store, weightBody(), "coach-a", NOW);
  const denied = simulateGet(store, 7, "coach-b");
  assert.equal(denied.status, 404, "cross-owner GET must be denied");
});

test("POST denies adding measurements for another coach's client and writes nothing", () => {
  const store = makeStore();
  const denied = simulatePost(store, weightBody(), "coach-b", NOW);
  assert.equal(denied.status, 404, "cross-owner POST must be denied");
  assert.equal(store.measurements.length, 0, "no row may be inserted for a foreign client");
  assert.equal(store.clients[0].currentWeight, 80, "foreign client's weight must stay untouched");
});

test("ownerId supplied in the request body is ignored - the authenticated coach wins", () => {
  const store = makeStore();
  const result = simulatePost(store, { ...weightBody(), ownerId: "coach-b", clientId: 7 }, "coach-a", NOW);
  expect201(result);
  assert.equal(store.measurements[0].ownerId, "coach-a");
});

// ---------- 2. Insert + currentWeight sync ----------

test("valid measurement insert returns 201 and syncs currentWeight to the new latest weight", () => {
  const store = makeStore();
  const result = expect201(simulatePost(store, weightBody({ weightKg: 79.5 }), "coach-a", NOW));
  assert.equal(result.currentWeight, 79.5);
  assert.equal(store.clients[0].currentWeight, 79.5);
  assert.equal(store.measurements.length, 1);
});

test("backdated weight never corrupts currentWeight - 84kg in July must not overwrite 80kg in August", () => {
  const store = makeStore();
  const august = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  assert.equal(august.currentWeight, 80);
  const backdated = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-07-01", weightKg: 84 }, "coach-a", NOW));
  assert.equal(backdated.currentWeight, 80, "the roster currentWeight must stay 80 kg");
  assert.equal(store.clients[0].currentWeight, 80);
  assert.equal(store.measurements.length, 2, "history keeps both entries");
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  assert.equal(get.measurements[0].weightKg, 80, "newest-first ordering puts August first");
  assert.equal(get.measurements[1].weightKg, 84, "the backdated July entry is preserved in history");
});

test("weightless measurement leaves currentWeight unchanged", () => {
  const store = makeStore();
  const result = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: "", bodyFatPercent: 18.5 }, "coach-a", NOW));
  assert.equal(result.currentWeight, 80, "no weight on the row → no sync");
  assert.equal(store.clients[0].currentWeight, 80);
  assert.equal(store.measurements[0].weightKg, null);
});

test("same-timestamp weights resolve deterministically (later id wins, matching Phase 1A tie rule)", () => {
  const store = makeStore();
  simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80.5 }, "coach-a", NOW);
  const second = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 79.9 }, "coach-a", NOW));
  assert.equal(second.currentWeight, 79.9);
});

// ---------- 3. Validation ----------

test("invalid measurement is rejected", () => {
  const store = makeStore();
  const result = simulatePost(store, weightBody({ weightKg: -5 }), "coach-a", NOW);
  assert.equal(result.status, 400);
  assert.equal(store.measurements.length, 0);
});

test("empty measurement (notes only) is rejected", () => {
  const store = makeStore();
  const result = simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: "", notes: "client looked great" }, "coach-a", NOW);
  assert.equal(result.status, 400);
  assert.equal(store.measurements.length, 0);
});

test("derived lean mass is never persisted automatically", () => {
  const store = makeStore();
  const result = expect201(simulatePost(store, weightBody({ weightKg: 80, bodyFatPercent: 20 }), "coach-a", NOW));
  assert.equal(store.measurements[0].leanMassKg, null, "row stores only what was actually measured");
  assert.equal(store.measurements[0].bodyFatPercent, 20);
  assert.equal(result.measurement.leanMassKg, null);
});

test("missing values remain missing - never converted to zero", () => {
  const store = makeStore();
  expect201(simulatePost(store, weightBody(), "coach-a", NOW));
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  assert.equal(get.measurements[0].bodyFatPercent, null);
  assert.equal(get.measurements[0].waistCm, null);
  assert.equal(get.trend.deltas.waistCm.change, null);
});

// ---------- 4. Dates ----------

test("future measurement dates are rejected", () => {
  const store = makeStore();
  const result = simulatePost(store, weightBody({ measuredAt: "2030-01-01" }), "coach-a", NOW);
  assert.equal(result.status, 400);
  assert.match(result.error, /future/);
});

test("malformed measurement dates are rejected", () => {
  const store = makeStore();
  assert.equal(simulatePost(store, weightBody({ measuredAt: "not-a-date" }), "coach-a", NOW).status, 400);
  assert.equal(simulatePost(store, weightBody({ measuredAt: "2026-13-45" }), "coach-a", NOW).status, 400);
});

test("date-only input normalizes to UTC noon (timezone-safe, no day shift)", () => {
  assert.deepEqual(parseMeasurementDate("2026-08-01", NOW), { ok: true, measuredAt: "2026-08-01T12:00:00.000Z" });
});

test("absent measurement date defaults to now", () => {
  assert.deepEqual(parseMeasurementDate(undefined, NOW), { ok: true, measuredAt: NOW });
  assert.deepEqual(parseMeasurementDate("", NOW), { ok: true, measuredAt: NOW });
});

test("full ISO timestamps pass through and today's date within tolerance is accepted", () => {
  assert.deepEqual(parseMeasurementDate("2026-08-20T08:30:00.000Z", NOW), { ok: true, measuredAt: "2026-08-20T08:30:00.000Z" });
  // "Today" picked from a west-of-UTC timezone can be a few hours ahead of the server clock - allowed.
  assert.equal(parseMeasurementDate("2026-08-21T22:00:00.000Z", NOW).ok, true);
  // Clearly-future (beyond the 24h tolerance) is rejected.
  assert.equal(parseMeasurementDate("2026-08-25T00:00:00.000Z", NOW).ok, false);
});

// ---------- 5. Number coercion / input assembly ----------

test("empty strings and null coerce to missing; parseable strings coerce to numbers; garbage stays NaN for validation", () => {
  assert.equal(measurementNumberFrom(""), null);
  assert.equal(measurementNumberFrom(null), null);
  assert.equal(measurementNumberFrom(undefined), null);
  assert.equal(measurementNumberFrom("82.4"), 82.4);
  assert.equal(measurementNumberFrom(82.4), 82.4);
  assert.ok(Number.isNaN(measurementNumberFrom("abc") as number), "unparseable input must surface as NaN, never silently dropped");
});

test("source is always forced to coach regardless of what the body claims", () => {
  for (const claimed of ["client", "progress_import", "garmin", "coach"]) {
    const parsed = measurementInputFrom({ clientId: 7, weightKg: 80, source: claimed }, "coach-a", NOW);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.input.source, "coach", `claimed source ${claimed} must be overridden`);
  }
});

test("measurementInputFrom validates clientId and caps notes", () => {
  assert.equal(measurementInputFrom({ weightKg: 80 }, "coach-a", NOW).ok, false);
  const longNotes = "x".repeat(MEASUREMENT_NOTE_MAX + 50);
  const parsed = measurementInputFrom({ clientId: 7, weightKg: 80, notes: `  ${longNotes}  ` }, "coach-a", NOW);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal((parsed.input.notes ?? "").length, MEASUREMENT_NOTE_MAX, "notes are trimmed and capped");
  }
});

// ---------- 6. latestWeightForSync ----------

test("latestWeightForSync picks the chronologically latest weight-bearing row and ignores weightless rows", () => {
  const rows = [
    { id: 1, measuredAt: "2026-08-01T00:00:00.000Z", weightKg: 84 } as BodyMeasurement,
    { id: 2, measuredAt: "2026-08-10T00:00:00.000Z", weightKg: null } as BodyMeasurement,
    { id: 3, measuredAt: "2026-08-15T00:00:00.000Z", weightKg: 82.4 } as BodyMeasurement,
    { id: 4, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: null } as BodyMeasurement,
  ];
  assert.equal(latestWeightForSync(rows), 82.4);
  assert.equal(latestWeightForSync([]), null);
  assert.equal(latestWeightForSync([{ id: 1, measuredAt: "2026-08-01T00:00:00.000Z", weightKg: null } as BodyMeasurement]), null);
});

// ---------- 7. Public DTO / leak prevention ----------

test("publicBodyMeasurement strips ownerId, clientId and createdAt", () => {
  const row = {
    id: 5, clientId: 7, ownerId: "coach-a", measuredAt: "2026-08-20T12:00:00.000Z",
    weightKg: 79.5, bodyFatPercent: 18, leanMassKg: null, waistCm: 86, chestCm: null, hipsCm: null, armCm: null, thighCm: null,
    source: "coach", notes: "weigh-in", createdAt: "2026-08-20T12:00:00.000Z",
  } as BodyMeasurement;
  const dto = publicBodyMeasurement(row);
  assert.equal("ownerId" in dto, false);
  assert.equal("clientId" in dto, false);
  assert.equal("createdAt" in dto, false);
  assert.equal(dto.weightKg, 79.5);
  assert.equal(dto.source, "coach");
});

test("the GET payload - including the trend - never leaks ownerId or clientId", () => {
  const store = makeStore();
  simulatePost(store, weightBody({ weightKg: 80, bodyFatPercent: 20 }), "coach-a", NOW);
  simulatePost(store, { clientId: 7, measuredAt: "2026-08-15", weightKg: 79, bodyFatPercent: 19 }, "coach-a", NOW);
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  const json = JSON.stringify(get);
  assert.ok(!json.includes("ownerId"), "ownerId must never appear in the response");
  assert.ok(!json.includes("clientId"), "clientId must never appear in the response");
  assert.equal(get.trend.latest?.weightKg, 80, "the August 20 measurement is chronologically latest");
  assert.equal(get.trend.previous?.weightKg, 79);
  assert.equal(get.trend.deltas.weightKg.change, 1);
  assert.equal(get.trend.leanMass.source, "derived", "lean mass flagged as estimated when only weight + body fat exist");
});

// ---------- 8. PATCH simulation ----------

type PatchResult =
  | { status: 200; measurement: PublicBodyMeasurement; currentWeight: number | null }
  | { status: 400 | 404; error: string };

/** Mirrors PATCH in app/api/body-measurements/route.ts. */
function simulatePatch(store: Store, body: Record<string, unknown>, ownerId: string, now: string): PatchResult {
  const parsed = patchMeasurementInputFrom(body, ownerId, now);
  if (!parsed.ok) return { status: 400, error: parsed.error };
  const { input } = parsed;

  const validation = validatePatchBodyMeasurement({ ...input, ownerId });
  if (!validation.ok) return { status: 400, error: validation.errors.map((e) => e.message).join(" ") };

  const client = store.clients.find((c) => c.id === input.clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, error: "Client not found." };

  const idx = store.measurements.findIndex((m) => m.id === input.measurementId && m.clientId === input.clientId && m.ownerId === ownerId);
  if (idx < 0) return { status: 404, error: "Measurement not found." };

  store.measurements[idx] = {
    ...store.measurements[idx],
    measuredAt: parsed.measuredAt,
    weightKg: input.weightKg,
    bodyFatPercent: input.bodyFatPercent,
    leanMassKg: input.leanMassKg,
    waistCm: input.waistCm,
    chestCm: input.chestCm,
    hipsCm: input.hipsCm,
    armCm: input.armCm,
    thighCm: input.thighCm,
    notes: input.notes ?? "",
  };

  // Recompute currentWeight from all weight-bearing rows.
  const ownerMeasurements = store.measurements.filter((m) => m.clientId === input.clientId && m.ownerId === ownerId);
  client.currentWeight = latestWeightForSync(ownerMeasurements);

  return { status: 200, measurement: publicBodyMeasurement(store.measurements[idx]), currentWeight: client.currentWeight };
}

test("PATCH updates a single measurement row", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80, waistCm: 92 }, "coach-a", NOW));
  const patched = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: 80, waistCm: 90 }, "coach-a", NOW);
  assert.equal(patched.status, 200);
  if (patched.status === 200) {
    assert.equal(patched.measurement.waistCm, 90, "waist updated");
    assert.equal(patched.measurement.weightKg, 80, "weight unchanged");
  }
});

test("PATCH denies editing another coach's measurement", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  const denied = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: 79 }, "coach-b", NOW);
  assert.equal(denied.status, 404);
});

test("PATCH with invalid measurement id is rejected", () => {
  const store = makeStore();
  const result = simulatePatch(store, { clientId: 7, measurementId: 999, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW);
  assert.equal(result.status, 404);
});

test("PATCH with invalid values is rejected", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  const result = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: -5 }, "coach-a", NOW);
  assert.equal(result.status, 400);
});

test("PATCH recomputes currentWeight after editing the latest weight row", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  assert.equal(store.clients[0].currentWeight, 80);
  const patched = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: 85 }, "coach-a", NOW);
  assert.equal(patched.status, 200);
  if (patched.status === 200) assert.equal(patched.currentWeight, 85);
  assert.equal(store.clients[0].currentWeight, 85);
});

test("PATCH reverts currentWeight when latest weight is removed (falls back to prior)", () => {
  const store = makeStore();
  expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-07-01", weightKg: 84 }, "coach-a", NOW));
  const later = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80, bodyFatPercent: 18 }, "coach-a", NOW));
  assert.equal(store.clients[0].currentWeight, 80);
  // Remove weight from the latest row while keeping bodyFatPercent
  const patched = simulatePatch(store, { clientId: 7, measurementId: later.measurement.id, measuredAt: "2026-08-20", weightKg: "", bodyFatPercent: 18 }, "coach-a", NOW);
  assert.equal(patched.status, 200);
  if (patched.status === 200) assert.equal(patched.currentWeight, 84, "falls back to the July weight");
});

test("PATCH preserves all other historical rows untouched", () => {
  const store = makeStore();
  const first = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-07-01", weightKg: 84, waistCm: 92 }, "coach-a", NOW));
  const second = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80, waistCm: 90 }, "coach-a", NOW));
  // Edit only the second row
  simulatePatch(store, { clientId: 7, measurementId: second.measurement.id, measuredAt: "2026-08-20", weightKg: 80, waistCm: 88 }, "coach-a", NOW);
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  // First row unchanged
  const firstRow = get.measurements.find((m) => m.id === first.measurement.id);
  assert.equal(firstRow?.waistCm, 92, "first row waist preserved");
  assert.equal(firstRow?.weightKg, 84, "first row weight preserved");
});

test("PATCH with ownerId in body is ignored - authenticated coach wins", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  const patched = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: 79, ownerId: "coach-b" }, "coach-a", NOW);
  assert.equal(patched.status, 200);
});

test("PATCH with empty measurement (notes only) is rejected", () => {
  const store = makeStore();
  const post = expect201(simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 80 }, "coach-a", NOW));
  const result = simulatePatch(store, { clientId: 7, measurementId: post.measurement.id, measuredAt: "2026-08-20", weightKg: "", bodyFatPercent: "", waistCm: "", notes: "updated note" }, "coach-a", NOW);
  assert.equal(result.status, 400);
});

test("the GET trend includes latestComposition and perFieldDeltas", () => {
  const store = makeStore();
  simulatePost(store, { clientId: 7, measuredAt: "2026-08-20", weightKg: 86, bodyFatPercent: 16 }, "coach-a", NOW);
  simulatePost(store, { clientId: 7, measuredAt: "2026-08-21", waistCm: 90 }, "coach-a", NOW);
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  const lc = get.trend.latestComposition;
  assert.equal(lc.weightKg?.value, 86, "weight from first row");
  assert.equal(lc.waistCm?.value, 90, "waist from second row");
  assert.equal(lc.bodyFatPercent?.value, 16, "body fat from first row");
});
