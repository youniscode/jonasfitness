/**
 * Pure Bodyweight domain for the self-service "Jonas Fitness Progress" log.
 *
 * A manual, owner-scoped measurement record. Canonical storage is KG only -
 * the entry UI converts lb at the API boundary (lb x 0.45359237), so the
 * ledger holds no unit column and mixed-unit entries never mix raw values.
 * All functions are deterministic and consume already-fetched rows, so every
 * bound, conversion and delta is unit-testable with Node's built-in runner.
 *
 * Deliberately a sibling of the coach/client-scoped body-measurements module,
 * not a consumer of it: this ledger is scoped to the athlete's own Clerk
 * ownerId with a single weight field. The shared date-parsing helper is
 * reused so calendar-date semantics stay identical across the product.
 * No BMI, no body-fat %, no medical interpretation, no target-weight
 * coaching: a plain measurement record.
 */

import { parseMeasurementDate } from "./body-measurements.ts";

/** Canonical lb -> kg (exact factor) and its inverse for display. */
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;

/** Conservative physical bounds, reused from the coaching weight bounds
 *  (25-400 kg) so the two measurement surfaces agree. */
export const BODYWEIGHT_KG_MIN = 25;
export const BODYWEIGHT_KG_MAX = 400;

/** Deterministic rounding: 1 decimal place for stored + derived values. */
export const BODYWEIGHT_DECIMALS = 1;

/** History cap returned to the page (newest first). */
export const BODYWEIGHT_HISTORY_LIMIT = 200;

export type BodyweightUnit = "kg" | "lb";

/** A stored row of the ledger (already-fetched from the DB; timestamps may be
 *  Date objects from the driver or ISO strings from a DTO). */
export type BodyweightEntry = {
  id: number;
  ownerId: string;
  measuredAt: Date | string;
  weightKg: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Minimal structural row the chronological/trend helpers need. */
export type BodyweightRow = { id: number; measuredAt: string; weightKg: number };

export type BodyweightError = { field: string; message: string };
export type BodyweightValidationResult = { ok: true; weightKg: number } | { ok: false; errors: BodyweightError[] };

export type BodyweightTrend = {
  count: number;
  latest: BodyweightRow | null;
  previous: BodyweightRow | null;
  /** latest − previous in canonical kg (rounded), null unless both exist. */
  changeKg: number | null;
  /** Chronological points (ascending measuredAt) for charting. */
  points: BodyweightRow[];
};

const round1 = (value: number) => Math.round(value * 10) / 10;

// ---------- Unit conversion (boundary + display) ----------

/** Converts an entered value to canonical kg (rounded 1 decimal). */
export function toCanonicalKg(value: number, unit: BodyweightUnit): number {
  return round1(unit === "lb" ? value * KG_PER_LB : value);
}

/** Converts a canonical kg value into a display unit (rounded 1 decimal). */
export function fromCanonicalKg(weightKg: number, unit: BodyweightUnit): number {
  return round1(unit === "lb" ? weightKg * LB_PER_KG : weightKg);
}

/** Source-unit bounds equivalent to 25-400 kg, for friendly input errors. */
export const BODYWEIGHT_LB_BOUNDS = {
  min: round1(BODYWEIGHT_KG_MIN * LB_PER_KG),
  max: round1(BODYWEIGHT_KG_MAX * LB_PER_KG),
};

/** Validates an entered value in its SOURCE unit against the kg bounds. */
export function validateBodyweightNumber(value: unknown, unit: BodyweightUnit): BodyweightValidationResult {
  let weight: number;
  if (typeof value === "string") {
    if (value.trim() === "") return { ok: false, errors: [{ field: "weight", message: "Enter a weight." }] };
    weight = Number(value);
  } else if (typeof value === "number") {
    weight = value;
  } else {
    return { ok: false, errors: [{ field: "weight", message: "Enter a weight." }] };
  }
  if (!Number.isFinite(weight) || weight <= 0) {
    return { ok: false, errors: [{ field: "weight", message: "Enter a weight." }] };
  }
  const bounds = unit === "lb" ? BODYWEIGHT_LB_BOUNDS : { min: BODYWEIGHT_KG_MIN, max: BODYWEIGHT_KG_MAX };
  if (weight < bounds.min || weight > bounds.max) {
    return { ok: false, errors: [{ field: "weight", message: `Weight must be between ${bounds.min} and ${bounds.max} ${unit}.` }] };
  }
  return { ok: true, weightKg: toCanonicalKg(weight, unit) };
}

// ---------- Date parsing (shared calendar semantics) ----------

/** Accepts "YYYY-MM-DD" (UTC noon) or a full ISO instant; rejects future. */
export function parseBodyweightDate(value: unknown, now: string): { ok: true; measuredAt: string } | { ok: false; error: string } {
  return parseMeasurementDate(value, now);
}

/**
 * Assembles a validated { weightKg, measuredAt } pair from an untrusted
 * request body. `ownerId` is NEVER read from the body - the route resolves it
 * from the authenticated session. Unit defaults to kg when absent.
 */
export function bodyweightInputFrom(body: Record<string, unknown>, now: string):
  | { ok: true; weightKg: number; measuredAt: string; unit: BodyweightUnit }
  | { ok: false; error: string } {
  const unit: BodyweightUnit = body.unit === "lb" ? "lb" : "kg";
  const validated = validateBodyweightNumber(body.weight, unit);
  if (!validated.ok) return { ok: false, error: validated.errors[0].message };
  const date = parseBodyweightDate(body.measuredAt, now);
  if (!date.ok) return { ok: false, error: date.error };
  return { ok: true, weightKg: validated.weightKg, measuredAt: date.measuredAt, unit };
}

/** PATCH variant: id must be a positive integer, weight/date validated same. */
export function bodyweightPatchFrom(body: Record<string, unknown>, now: string):
  | { ok: true; id: number; weightKg: number; measuredAt: string }
  | { ok: false; error: string } {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "Invalid entry id." };
  const unit: BodyweightUnit = body.unit === "lb" ? "lb" : "kg";
  const validated = validateBodyweightNumber(body.weight, unit);
  if (!validated.ok) return { ok: false, error: validated.errors[0].message };
  const date = parseBodyweightDate(body.measuredAt, now);
  if (!date.ok) return { ok: false, error: date.error };
  return { ok: true, id, weightKg: validated.weightKg, measuredAt: date.measuredAt };
}

// ---------- Chronological resolution + trend ----------

/** Deterministic ascending order: measuredAt, ties broken by id. */
export function sortBodyweightByDate(rows: readonly BodyweightRow[]): BodyweightRow[] {
  return [...rows].sort((a, b) => {
    const byDate = new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime();
    return byDate !== 0 ? byDate : a.id - b.id;
  });
}

/** The most recent measurement (null when there are none). */
export function latestBodyweight(rows: readonly BodyweightRow[]): BodyweightRow | null {
  const sorted = sortBodyweightByDate(rows);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** The measurement immediately before the latest (null unless >= 2 rows). */
export function previousBodyweight(rows: readonly BodyweightRow[]): BodyweightRow | null {
  const sorted = sortBodyweightByDate(rows);
  return sorted.length > 1 ? sorted[sorted.length - 2] : null;
}

/** Full deterministic trend: latest, previous, kg delta and chart points. */
export function buildBodyweightTrend(rows: readonly BodyweightRow[]): BodyweightTrend {
  const latest = latestBodyweight(rows);
  const previous = previousBodyweight(rows);
  return {
    count: rows.length,
    latest,
    previous,
    changeKg: latest && previous ? round1(latest.weightKg - previous.weightKg) : null,
    points: sortBodyweightByDate(rows),
  };
}

// ---------- Owner isolation + DTO ----------

/** Pure owner-scope predicate: every DB read/write filters by ownerId + id. */
export function isBodyweightOwnedBy(entry: { id: number; ownerId: string } | null | undefined, ownerId: string): boolean {
  return Boolean(entry && entry.ownerId === ownerId);
}

/** Browser DTO: deliberately excludes ownerId and timestamps. */
export type PublicBodyweightEntry = { id: number; measuredAt: string; weightKg: number };

export function publicBodyweightEntry(row: BodyweightEntry): PublicBodyweightEntry {
  return { id: row.id, measuredAt: new Date(row.measuredAt).toISOString(), weightKg: row.weightKg };
}