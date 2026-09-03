import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bodyweightInputFrom,
  bodyweightPatchFrom,
  buildBodyweightTrend,
  fromCanonicalKg,
  isBodyweightOwnedBy,
  KG_PER_LB,
  latestBodyweight,
  parseBodyweightDate,
  previousBodyweight,
  publicBodyweightEntry,
  sortBodyweightByDate,
  toCanonicalKg,
  validateBodyweightNumber,
} from "../app/lib/bodyweight.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const NOW = "2026-09-10T12:00:00.000Z";

function entry(id: number, measuredAt: string, weightKg: number) {
  return { id, measuredAt, weightKg };
}

// ---------- kg / lb conversion ----------

test("kg entry is stored directly at 1 decimal", () => {
  assert.equal(toCanonicalKg(80, "kg"), 80);
  assert.equal(toCanonicalKg(80.25, "kg"), 80.3, "rounded to 1 decimal");
});

test("lb entry converts to canonical kg with the exact factor", () => {
  assert.equal(toCanonicalKg(200, "lb"), Math.round(200 * KG_PER_LB * 10) / 10);
  assert.equal(toCanonicalKg(200, "lb"), 90.7, "200 lb = 90.718... kg -> 90.7");
  assert.equal(fromCanonicalKg(90.7, "lb"), 200, "display round-trips to the entered unit");
  assert.equal(fromCanonicalKg(80, "kg"), 80);
});

// ---------- bounds ----------

test("bounds reuse the 25-400 kg coaching range in both source units", () => {
  assert.equal(validateBodyweightNumber("24", "kg").ok, false, "below kg min rejected");
  assert.equal(validateBodyweightNumber("401", "kg").ok, false, "above kg max rejected");
  assert.equal(validateBodyweightNumber("80", "kg").ok, true);
  assert.equal(validateBodyweightNumber("", "kg").ok, false, "empty rejected");
  assert.equal(validateBodyweightNumber("abc", "kg").ok, false, "non-numeric rejected");
  assert.equal(validateBodyweightNumber("0", "kg").ok, false, "zero rejected");
  // lb bounds are the exact kg bounds converted (55.1 - 881.8).
  const lbMin = validateBodyweightNumber("55", "lb");
  assert.equal(lbMin.ok, false, "55 lb (~24.9 kg) below the 25 kg floor");
  const lbOk = validateBodyweightNumber("200", "lb");
  assert.ok(lbOk.ok);
  if (lbOk.ok) assert.equal(lbOk.weightKg, 90.7);
  assert.equal(validateBodyweightNumber("900", "lb").ok, false, "900 lb far above the ceiling");
});

// ---------- date parsing ----------

test("date-only input is parsed to UTC noon; malformed and future rejected", () => {
  assert.equal(parseBodyweightDate("2026-09-05", NOW).ok, true);
  const parsed = parseBodyweightDate("2026-09-05", NOW);
  if (parsed.ok) assert.equal(parsed.measuredAt, "2026-09-05T12:00:00.000Z");
  assert.equal(parseBodyweightDate("", NOW).ok, true, "absent date defaults to now");
  assert.equal(parseBodyweightDate("not-a-date", NOW).ok, false);
  assert.equal(parseBodyweightDate("2027-01-01", NOW).ok, false, "future date rejected");
});

// ---------- bodyweightInputFrom: never trusts the client ----------

test("input parsing ignores any client-supplied ownerId and coerces unit", () => {
  const result = bodyweightInputFrom({ weight: "200", unit: "lb", measuredAt: "2026-09-05", ownerId: "attacker-123" }, NOW);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.weightKg, 90.7, "lb converted to canonical kg");
    assert.equal(result.measuredAt, "2026-09-05T12:00:00.000Z");
    assert.equal(result.unit, "lb");
  }
  const noUnit = bodyweightInputFrom({ weight: "80", measuredAt: "2026-09-05" }, NOW);
  assert.ok(noUnit.ok);
  if (noUnit.ok) assert.equal(noUnit.weightKg, 80, "absent unit defaults to kg");
  const bad = bodyweightInputFrom({ weight: "9999", unit: "kg", measuredAt: "2026-09-05" }, NOW);
  assert.equal(bad.ok, false);
  const future = bodyweightInputFrom({ weight: "80", unit: "kg", measuredAt: "2027-06-01" }, NOW);
  assert.equal(future.ok, false);
});

test("patch parsing requires a positive integer id", () => {
  const ok = bodyweightPatchFrom({ id: "5", weight: "80", unit: "kg", measuredAt: "2026-09-05" }, NOW);
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.id, 5);
  assert.equal(bodyweightPatchFrom({ weight: "80", unit: "kg", measuredAt: "2026-09-05" }, NOW).ok, false, "missing id rejected");
  assert.equal(bodyweightPatchFrom({ id: "-2", weight: "80", unit: "kg", measuredAt: "2026-09-05" }, NOW).ok, false, "non-positive id rejected");
});

// ---------- chronology, latest, previous, delta ----------

test("entries sort chronologically with id tiebreak; latest/previous derived", () => {
  const rows = [
    entry(3, "2026-09-05T12:00:00.000Z", 80),
    entry(1, "2026-08-20T12:00:00.000Z", 82),
    entry(2, "2026-09-05T12:00:00.000Z", 80.5),
  ];
  const sorted = sortBodyweightByDate(rows);
  assert.deepEqual(sorted.map((r) => r.id), [1, 2, 3], "same-day ties break by ascending id");
  assert.equal(latestBodyweight(rows)?.id, 3);
  assert.equal(previousBodyweight(rows)?.id, 2);
  assert.equal(buildBodyweightTrend(rows).changeKg, -0.5, "80 - 80.5 = -0.5 kg vs the chronologically previous entry");
});

test("delta is null with fewer than two entries", () => {
  assert.equal(buildBodyweightTrend([entry(1, "2026-09-05T12:00:00.000Z", 80)]).changeKg, null);
  assert.equal(buildBodyweightTrend([]).latest, null);
  assert.equal(buildBodyweightTrend([]).previous, null);
});

test("trend exposes chronological points for charting", () => {
  const trend = buildBodyweightTrend([
    entry(1, "2026-08-20T12:00:00.000Z", 82),
    entry(2, "2026-09-05T12:00:00.000Z", 80),
  ]);
  assert.deepEqual(trend.points.map((p) => p.weightKg), [82, 80], "oldest first");
});

// ---------- owner isolation + DTO ----------

test("owner-scope predicate rejects foreign owners and null rows", () => {
  assert.equal(isBodyweightOwnedBy({ id: 1, ownerId: "user-a" }, "user-a"), true);
  assert.equal(isBodyweightOwnedBy({ id: 1, ownerId: "user-b" }, "user-a"), false);
  assert.equal(isBodyweightOwnedBy(null, "user-a"), false);
});

test("public DTO never leaks ownerId or timestamps", () => {
  const row = {
    id: 7,
    ownerId: "user-secret",
    measuredAt: new Date("2026-09-05T12:00:00.000Z"),
    weightKg: 80.5,
    createdAt: new Date("2026-09-05T12:30:00.000Z"),
    updatedAt: new Date("2026-09-05T12:30:00.000Z"),
  };
  const dto = publicBodyweightEntry(row);
  assert.deepEqual(Object.keys(dto).sort(), ["id", "measuredAt", "weightKg"]);
  assert.equal((dto as Record<string, unknown>).ownerId, undefined);
});

test("bodyweight module file stays free of U+2014 em dashes", () => {
  assert.ok(!read("app/lib/bodyweight.ts").includes("\u2014"));
});