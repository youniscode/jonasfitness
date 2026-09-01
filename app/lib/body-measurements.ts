/**
 * Body Composition Data Foundation (Nutrition Foundations V1 / Phase 1A).
 *
 * Deterministic, owner-scoped domain module for the historical
 * `client_body_measurements` ledger. This module is PURE: no DB access, no
 * network, no Date.now(), no randomness - it consumes already-fetched rows (or
 * plain inputs) and returns typed results, so every bound and derivation is
 * unit-testable with Node's built-in runner and identical inputs always produce
 * identical outputs.
 *
 * Boundaries:
 *  - MEASURED BODY DATA ONLY. Age, date of birth, sex, gender and the
 *    onboarding snapshot stay in `client_intakes.profile`; `clients.currentWeight`
 *    stays the denormalized latest-weight cache used by existing roster UI.
 *    This module never duplicates either. See `latestWeightKg` for the
 *    canonical ledger→cache sync source.
 *  - Not a medical record and not a dietitian. Values are validated against
 *    conservative physical bounds; lean mass derived from weight + body-fat %
 *    is explicitly ESTIMATED and never overwrites a measured value. No
 *    calorie/macro/BMR/TDEE logic lives here (that is a later phase).
 *  - DB access is deliberately absent. Any future API layer MUST scope every
 *    read/write by ownerId + clientId (see `isMeasurementOwnedBy`) - never by
 *    id alone.
 */

// ---------- Canonical source vocabulary ----------
// Small fixed set - arbitrary strings are never accepted. Wearable sources
// (Strava / Garmin / Apple Health) are explicitly future work.
export const MEASUREMENT_SOURCES = ["coach", "client", "progress_import"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const DEFAULT_MEASUREMENT_SOURCE: MeasurementSource = "coach";

/** Numeric fields that can hold an actual measured value. Notes/source are not measurements. */
export const MEASURED_FIELDS = [
  "weightKg",
  "bodyFatPercent",
  "leanMassKg",
  "waistCm",
  "chestCm",
  "hipsCm",
  "armCm",
  "thighCm",
] as const;
export type MeasuredField = (typeof MEASURED_FIELDS)[number];

/** Deterministic rounding convention: 1 decimal place for all derived quantities. */
export const MEASUREMENT_ROUNDING_DECIMALS = 1;

// ---------- Public types ----------

export type BodyMeasurementValues = {
  weightKg: number | null;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  armCm: number | null;
  thighCm: number | null;
};

/** A stored row of the ledger (already-fetched from the DB). */
export type BodyMeasurement = BodyMeasurementValues & {
  id: number;
  clientId: number;
  ownerId: string;
  /** ISO timestamp of when the measurement was taken (may differ from createdAt). */
  measuredAt: string;
  source: MeasurementSource;
  notes: string;
  createdAt: string;
};

/** Everything needed to create a measurement row. `measuredAt`/`source`/`notes` are optional on input. */
export type BodyMeasurementInput = BodyMeasurementValues & {
  clientId: number;
  ownerId: string;
  measuredAt?: string;
  source?: MeasurementSource;
  notes?: string;
};

/**
 * Minimal structural row shape the chronological/trend helpers need. Both full
 * DB rows (`BodyMeasurement`) and the coach-facing public DTO satisfy it, so
 * trend logic runs identically on server rows and on browser-safe payloads
 * (which deliberately carry no ownerId/clientId - see `publicBodyMeasurement`).
 */
export type MeasurementRow = { id: number; measuredAt: string } & BodyMeasurementValues;

export type MeasurementError = { field: string; message: string };

export type MeasurementValidationResult =
  | { ok: true; value: BodyMeasurementInput }
  | { ok: false; errors: MeasurementError[] };

export type LeanMassEstimate = { leanMassKg: number; estimated: true };

export type LeanMassResolution =
  | { leanMassKg: number; estimated: false; source: "measured" }
  | { leanMassKg: number; estimated: true; source: "derived" }
  | { leanMassKg: null; estimated: false; source: "missing" };

export type MeasurementDelta = {
  /** Latest recorded value (raw, as stored). */
  value: number | null;
  /** latest − previous, rounded to 1 decimal. Null when either side is missing. */
  change: number | null;
};

export type MeasurementDeltas = Record<MeasuredField, MeasurementDelta>;

/**
 * A resolved per-field value with its provenance - which measurement row and
 * date it came from. The UI can show the value plus the source date when fields
 * originate from different rows.
 */
export type ResolvedFieldValue = {
  value: number;
  measuredAt: string;
  measurementId: number;
} | null;

export type LatestBodyComposition = Record<MeasuredField, ResolvedFieldValue>;

/**
 * Delta computed per-field by comparing the latest known value with the
 * previous known value for THAT SPECIFIC FIELD across the full history.
 * A waist-only row between two weight rows does not break the weight delta.
 */
export type PerFieldDelta = {
  value: number | null;
  change: number | null;
};

export type BodyMeasurementTrend = {
  count: number;
  latest: MeasurementRow | null;
  /** The measurement immediately before `latest` chronologically. */
  previous: MeasurementRow | null;
  deltas: MeasurementDeltas;
  /** Estimated lean mass from latest weight + body-fat %, or the measured value when present. */
  leanMass: LeanMassResolution;
  /** Per-field latest-known values resolved independently across all rows. */
  latestComposition: LatestBodyComposition;
  /** Per-field deltas: latest known − previous known for each specific field. */
  perFieldDeltas: Record<MeasuredField, PerFieldDelta>;
};

// ---------- Conservative validation bounds ----------
// Deliberately wide but physically impossible values are rejected (negative,
// near-zero, absurdly large, non-finite). Overlapping fields reuse the existing
// onboarding bounds (client_intakes.profile: weightKg 25–400, waistCm 40–250).
export const MEASUREMENT_BOUNDS: Record<MeasuredField, { min: number; max: number; label: string }> = {
  weightKg: { min: 25, max: 400, label: "Weight" },
  bodyFatPercent: { min: 3, max: 70, label: "Body fat" },
  leanMassKg: { min: 15, max: 250, label: "Lean mass" },
  waistCm: { min: 40, max: 250, label: "Waist" },
  chestCm: { min: 50, max: 250, label: "Chest" },
  hipsCm: { min: 50, max: 250, label: "Hips" },
  armCm: { min: 15, max: 80, label: "Arm" },
  thighCm: { min: 25, max: 120, label: "Thigh" },
};

// ---------- Helpers ----------

const round1 = (value: number) => Math.round(value * 10) / 10;

function isMissing(value: number | null | undefined): boolean {
  return value === null || value === undefined;
}

// ---------- A. Validation ----------

/**
 * Validates a measurement input against conservative physical bounds. Numbers
 * are never clamped: an invalid value is rejected with a structured error. A
 * row is only valid when at least one real measured value is present - notes
 * alone never count as a measurement. On success the returned value is a
 * normalized copy (notes trimmed, source defaulted to "coach").
 */
export function validateBodyMeasurement(input: BodyMeasurementInput): MeasurementValidationResult {
  const errors: MeasurementError[] = [];

  if (!Number.isInteger(input.clientId) || input.clientId <= 0) {
    errors.push({ field: "clientId", message: "clientId must be a positive integer." });
  }
  if (typeof input.ownerId !== "string" || input.ownerId.trim() === "") {
    errors.push({ field: "ownerId", message: "ownerId must be a non-empty string." });
  }

  let presentCount = 0;
  for (const field of MEASURED_FIELDS) {
    const value = input[field];
    if (isMissing(value)) continue;
    const bound = MEASUREMENT_BOUNDS[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ field, message: `${bound.label} must be a finite number.` });
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push({ field, message: `${bound.label} must be between ${bound.min} and ${bound.max}.` });
      continue;
    }
    presentCount += 1;
  }

  if (presentCount === 0) {
    errors.push({ field: "measurements", message: "At least one body measurement is required - notes alone do not count." });
  }

  let source: MeasurementSource = DEFAULT_MEASUREMENT_SOURCE;
  if (input.source !== undefined) {
    if ((MEASUREMENT_SOURCES as readonly string[]).includes(input.source)) {
      source = input.source;
    } else {
      errors.push({ field: "source", message: `source must be one of: ${MEASUREMENT_SOURCES.join(", ")}.` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...input,
      ownerId: input.ownerId.trim(),
      notes: (input.notes ?? "").trim(),
      source,
    },
  };
}

// ---------- F. Derived lean mass (ESTIMATED, deterministic) ----------

/**
 * leanMassKg = weightKg × (1 − bodyFatPercent / 100), rounded to 1 decimal.
 * Returns null when either input is missing, non-finite or out of bounds.
 * Always flagged `estimated: true` - this is a deterministic estimate, never a
 * measurement. Body-fat % is NEVER derived from BMI or visual assumptions.
 */
export function estimateLeanMassKg(
  weightKg: number | null | undefined,
  bodyFatPercent: number | null | undefined,
): LeanMassEstimate | null {
  if (isMissing(weightKg) || isMissing(bodyFatPercent)) return null;
  if (typeof weightKg !== "number" || !Number.isFinite(weightKg)) return null;
  if (typeof bodyFatPercent !== "number" || !Number.isFinite(bodyFatPercent)) return null;
  if (weightKg < MEASUREMENT_BOUNDS.weightKg.min || weightKg > MEASUREMENT_BOUNDS.weightKg.max) return null;
  if (bodyFatPercent < MEASUREMENT_BOUNDS.bodyFatPercent.min || bodyFatPercent > MEASUREMENT_BOUNDS.bodyFatPercent.max) return null;
  return { leanMassKg: round1(weightKg * (1 - bodyFatPercent / 100)), estimated: true };
}

/**
 * Resolves the lean mass for a measurement: an explicitly measured leanMassKg
 * always wins; otherwise a deterministic estimate is derived from weight +
 * body-fat % when both are available; otherwise the result is missing.
 */
export function resolveLeanMass(
  values: Pick<BodyMeasurementValues, "leanMassKg" | "weightKg" | "bodyFatPercent"> | null | undefined,
): LeanMassResolution {
  if (!values) return { leanMassKg: null, estimated: false, source: "missing" };
  if (typeof values.leanMassKg === "number" && Number.isFinite(values.leanMassKg)) {
    return { leanMassKg: values.leanMassKg, estimated: false, source: "measured" };
  }
  const derived = estimateLeanMassKg(values.weightKg, values.bodyFatPercent);
  if (derived) return { ...derived, source: "derived" };
  return { leanMassKg: null, estimated: false, source: "missing" };
}

// ---------- B/C/E. Chronological resolution + trend ----------

/**
 * Deterministic chronological order: ascending measuredAt, ties broken by
 * ascending id (ids are monotonically assigned at creation). Input order never
 * matters; the same rows always produce the same ordering.
 */
export function sortMeasurementsByDate(measurements: readonly MeasurementRow[]): MeasurementRow[] {
  return [...measurements].sort((a, b) => {
    const byDate = new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime();
    return byDate !== 0 ? byDate : a.id - b.id;
  });
}

/** The most recent measurement (null when there are none). */
export function latestMeasurement(measurements: readonly MeasurementRow[]): MeasurementRow | null {
  const sorted = sortMeasurementsByDate(measurements);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** The measurement immediately before the latest (null unless ≥ 2 rows). */
export function previousMeasurement(measurements: readonly MeasurementRow[]): MeasurementRow | null {
  const sorted = sortMeasurementsByDate(measurements);
  return sorted.length > 1 ? sorted[sorted.length - 2] : null;
}

/**
 * Per-field latest value + latest − previous delta. Missing values stay
 * missing: `change` is null when either side is absent and is never coerced
 * to zero. Only `value` is a raw stored number; `change` is the derived,
 * rounded quantity.
 */
export function measurementDeltas(
  latest: MeasurementRow | null,
  previous: MeasurementRow | null,
): MeasurementDeltas {
  const deltas = {} as MeasurementDeltas;
  for (const field of MEASURED_FIELDS) {
    const current = latest ? latest[field] : null;
    const prior = previous ? previous[field] : null;
    deltas[field] = {
      value: typeof current === "number" ? current : null,
      change: typeof current === "number" && typeof prior === "number" ? round1(current - prior) : null,
    };
  }
  return deltas;
}

/**
 * Full deterministic trend from an unsorted row set: latest, previous,
 * per-field deltas and the lean-mass resolution for the latest measurement.
 */
export function buildBodyMeasurementTrend(measurements: readonly MeasurementRow[]): BodyMeasurementTrend {
  const latest = latestMeasurement(measurements);
  const previous = previousMeasurement(measurements);
  return {
    count: measurements.length,
    latest,
    previous,
    deltas: measurementDeltas(latest, previous),
    leanMass: resolveLeanMass(latest),
    latestComposition: resolveLatestBodyComposition(measurements),
    perFieldDeltas: perFieldDeltasForHistory(measurements),
  };
}

// ---------- G. Owner isolation ----------

export type MeasurementOwner = Pick<BodyMeasurement, "id" | "clientId" | "ownerId">;

/**
 * Pure owner-scope predicate (mirrors `isClientOwnedBy`). Every DB read/write
 * of a measurement row MUST be scoped by ownerId + clientId - never by id
 * alone. This predicate is the reusable guard for the future API layer.
 */
export function isMeasurementOwnedBy(
  measurement: MeasurementOwner | null | undefined,
  clientId: number,
  ownerId: string,
): boolean {
  return Boolean(measurement && measurement.clientId === clientId && measurement.ownerId === ownerId);
}

// ---------- I. Per-field latest composition ----------

/**
 * Resolves the latest known non-null value for EACH measured field
 * independently across all history rows. This prevents a partial measurement
 * from visually erasing previously known values.
 *
 * Chronological ordering: measuredAt ascending, id ascending for ties.
 * Walks rows oldest-to-newest; last non-null wins per field.
 * Returns per-field provenance (measurementId + measuredAt) for UI display.
 */
export function resolveLatestBodyComposition(
  measurements: readonly MeasurementRow[],
): LatestBodyComposition {
  const sorted = sortMeasurementsByDate(measurements);
  const result: LatestBodyComposition = {
    weightKg: null, bodyFatPercent: null, leanMassKg: null,
    waistCm: null, chestCm: null, hipsCm: null, armCm: null, thighCm: null,
  };
  for (const row of sorted) {
    for (const field of MEASURED_FIELDS) {
      if (typeof row[field] === "number") {
        result[field] = { value: row[field] as number, measuredAt: row.measuredAt, measurementId: row.id };
      }
    }
  }
  return result;
}

/**
 * Per-field delta: compares the latest known value for each field against the
 * previous known value for THAT SAME field. A waist-only entry between two
 * weight entries does not break the weight delta - it simply contributes to
 * the waist delta independently.
 *
 * Uses the same sorted-chronological walk as resolveLatestBodyComposition,
 * but tracks the two most recent non-null values per field.
 */
export function perFieldDeltasForHistory(
  measurements: readonly MeasurementRow[],
): Record<MeasuredField, PerFieldDelta> {
  const sorted = sortMeasurementsByDate(measurements);
  const previousValues: Partial<Record<MeasuredField, number>> = {};
  const latestValues: Partial<Record<MeasuredField, number>> = {};
  for (const row of sorted) {
    for (const field of MEASURED_FIELDS) {
      if (typeof row[field] === "number") {
        if (latestValues[field] !== undefined) {
          // Already have a "latest" for this field; shift it to "previous".
          previousValues[field] = latestValues[field];
        }
        latestValues[field] = row[field] as number;
      }
    }
  }
  const deltas = {} as Record<MeasuredField, PerFieldDelta>;
  for (const field of MEASURED_FIELDS) {
    const current = latestValues[field];
    const prior = previousValues[field];
    deltas[field] = {
      value: typeof current === "number" ? current : null,
      change: typeof current === "number" && typeof prior === "number" ? round1(current - prior) : null,
    };
  }
  return deltas;
}

// ---------- H. Current-weight cache sync source ----------

/**
 * The ledger is the canonical historical source; `clients.currentWeight` is
 * only a denormalized latest-weight cache used by existing roster UI. This is
 * the reusable sync source: when the future API inserts a measurement
 * containing weightKg, it should read `latestWeightKg` from the client's rows
 * and update `clients.currentWeight` in the same transaction. This module
 * never writes - it only reports the value to sync. No second independent
 * "latest weight" authority exists.
 */
export function latestWeightKg(measurements: readonly MeasurementRow[]): number | null {
  const latest = latestMeasurement(measurements);
  return latest && typeof latest.weightKg === "number" ? latest.weightKg : null;
}

// ---------- Route support (pure + testable, used by the API layer) ----------

/** Bounded history returned to the dashboard (newest-first). */
export const MEASUREMENT_HISTORY_LIMIT = 24;
/** Notes are trimmed and length-capped like every other free-text field in the repo. */
export const MEASUREMENT_NOTE_MAX = 1000;
/**
 * A measurement is rejected when dated more than 24h in the future. The small
 * tolerance absorbs timezone day-boundary artifacts (a coach west of UTC
 * picking "today" at their local midnight can be up to ~12h ahead of the
 * server clock) while still catching clearly-future typo dates.
 */
export const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export type MeasurementDateResult = { ok: true; measuredAt: string } | { ok: false; error: string };

export type PublicBodyMeasurement = {
  id: number;
  measuredAt: string;
} & BodyMeasurementValues & {
  source: MeasurementSource;
  notes: string;
};

/**
 * Coach-facing DTO. Deliberately excludes ownerId, clientId and createdAt:
 * the browser never needs them, and ownerId must never leak to responses.
 */
export function publicBodyMeasurement(row: BodyMeasurement): PublicBodyMeasurement {
  return {
    id: row.id,
    measuredAt: row.measuredAt,
    weightKg: row.weightKg,
    bodyFatPercent: row.bodyFatPercent,
    leanMassKg: row.leanMassKg,
    waistCm: row.waistCm,
    chestCm: row.chestCm,
    hipsCm: row.hipsCm,
    armCm: row.armCm,
    thighCm: row.thighCm,
    source: row.source,
    notes: row.notes,
  };
}

/**
 * Safe measurement-date parsing. Accepts a date-only "YYYY-MM-DD" (normalized
 * to UTC noon so a calendar-date choice can never shift a day across timezones)
 * or a full ISO timestamp. Absent values default to "now". Malformed dates and
 * clearly-future dates are rejected - never silently clamped.
 */
export function parseMeasurementDate(value: unknown, now: string): MeasurementDateResult {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: true, measuredAt: now };
  let measuredAt: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    measuredAt = new Date(`${raw}T12:00:00.000Z`);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw)) {
    measuredAt = new Date(raw);
  } else {
    return { ok: false, error: "Measurement date is not valid." };
  }
  if (Number.isNaN(measuredAt.getTime())) return { ok: false, error: "Measurement date is not valid." };
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) return { ok: false, error: "Measurement date is not valid." };
  if (measuredAt.getTime() > nowMs + FUTURE_DATE_TOLERANCE_MS) {
    return { ok: false, error: "Measurement date cannot be in the future." };
  }
  return { ok: true, measuredAt: measuredAt.toISOString() };
}

/**
 * Coerces a raw form/JSON value into a measurement number. Empty strings, null
 * and undefined become null (missing - an optional field left blank). Anything
 * else becomes Number(value); unparseable non-empty input yields NaN which
 * `validateBodyMeasurement` rejects explicitly - invalid numbers are never
 * silently dropped or clamped.
 */
export function measurementNumberFrom(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return typeof value === "number" ? value : Number(value);
}

export type MeasurementInputResult =
  | { ok: true; input: BodyMeasurementInput; measuredAt: string }
  | { ok: false; error: string };

/**
 * Assembles a validated-shape measurement input from an untrusted request body.
 * `ownerId` and `source` are NEVER read from the body: ownerId comes from the
 * authenticated coach, and source is always forced server-side to "coach" for
 * this UI. Date parsing is safe (see `parseMeasurementDate`); numbers are
 * coerced (see `measurementNumberFrom`) and then authority-checked by
 * `validateBodyMeasurement` in the route.
 */
export function measurementInputFrom(
  body: Record<string, unknown>,
  ownerId: string,
  now: string,
): MeasurementInputResult {
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client." };
  const date = parseMeasurementDate(body.measuredAt, now);
  if (!date.ok) return { ok: false, error: date.error };
  return {
    ok: true,
    input: {
      clientId,
      ownerId,
      weightKg: measurementNumberFrom(body.weightKg),
      bodyFatPercent: measurementNumberFrom(body.bodyFatPercent),
      leanMassKg: measurementNumberFrom(body.leanMassKg),
      waistCm: measurementNumberFrom(body.waistCm),
      chestCm: measurementNumberFrom(body.chestCm),
      hipsCm: measurementNumberFrom(body.hipsCm),
      armCm: measurementNumberFrom(body.armCm),
      thighCm: measurementNumberFrom(body.thighCm),
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, MEASUREMENT_NOTE_MAX) : "",
      source: "coach",
    },
    measuredAt: date.measuredAt,
  };
}

/**
 * The value to synchronize `clients.currentWeight` to after a measurement
 * insert: the chronologically latest measurement that CONTAINS a weight,
 * among all of the owner/client's rows. A backdated entry can therefore never
 * overwrite a newer weight - ordering is the same deterministic
 * measuredAt-then-id rule as everywhere else in this module.
 */
export function latestWeightForSync(measurements: readonly MeasurementRow[]): number | null {
  const weighted = sortMeasurementsByDate(measurements).filter((row) => typeof row.weightKg === "number");
  const latest = weighted.length > 0 ? weighted[weighted.length - 1] : null;
  return latest ? latest.weightKg : null;
}

// ---------- PATCH input (editing an existing measurement) ----------

export type PatchMeasurementInput = {
  clientId: number;
  measurementId: number;
  measuredAt: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string;
};

export type PatchMeasurementInputResult =
  | { ok: true; input: PatchMeasurementInput; measuredAt: string }
  | { ok: false; error: string };

/**
 * Assembles a validated-shape PATCH input from an untrusted request body.
 * The browser may send measurementId + clientId + editable fields.
 * ownerId and source are NEVER read from the body.
 */
export function patchMeasurementInputFrom(
  body: Record<string, unknown>,
  ownerId: string,
  now: string,
): PatchMeasurementInputResult {
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client." };
  const measurementId = Number(body.measurementId);
  if (!Number.isInteger(measurementId) || measurementId < 1) return { ok: false, error: "Invalid measurement id." };
  const date = parseMeasurementDate(body.measuredAt, now);
  if (!date.ok) return { ok: false, error: date.error };
  return {
    ok: true,
    input: {
      clientId,
      measurementId,
      measuredAt: date.measuredAt,
      weightKg: measurementNumberFrom(body.weightKg),
      bodyFatPercent: measurementNumberFrom(body.bodyFatPercent),
      leanMassKg: measurementNumberFrom(body.leanMassKg),
      waistCm: measurementNumberFrom(body.waistCm),
      chestCm: measurementNumberFrom(body.chestCm),
      hipsCm: measurementNumberFrom(body.hipsCm),
      armCm: measurementNumberFrom(body.armCm),
      thighCm: measurementNumberFrom(body.thighCm),
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, MEASUREMENT_NOTE_MAX) : "",
    },
    measuredAt: date.measuredAt,
  };
}

/**
 * Validates a PATCH measurement body. Uses the same validation as POST for the
 * measured fields (bounds, finiteness, at-least-one), but clientId comes from
 * the parsed body and ownerId from the authenticated coach.
 */
export function validatePatchBodyMeasurement(
  input: PatchMeasurementInput & { ownerId: string },
): MeasurementValidationResult {
  const errors: MeasurementError[] = [];

  if (!Number.isInteger(input.clientId) || input.clientId <= 0) {
    errors.push({ field: "clientId", message: "clientId must be a positive integer." });
  }
  if (!Number.isInteger(input.measurementId) || input.measurementId <= 0) {
    errors.push({ field: "measurementId", message: "measurementId must be a positive integer." });
  }
  if (typeof input.ownerId !== "string" || input.ownerId.trim() === "") {
    errors.push({ field: "ownerId", message: "ownerId must be a non-empty string." });
  }

  let presentCount = 0;
  for (const field of MEASURED_FIELDS) {
    const value = input[field];
    if (isMissing(value)) continue;
    const bound = MEASUREMENT_BOUNDS[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ field, message: `${bound.label} must be a finite number.` });
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push({ field, message: `${bound.label} must be between ${bound.min} and ${bound.max}.` });
      continue;
    }
    presentCount += 1;
  }

  if (presentCount === 0) {
    errors.push({ field: "measurements", message: "At least one body measurement is required - notes alone do not count." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      clientId: input.clientId,
      ownerId: input.ownerId.trim(),
      weightKg: input.weightKg,
      bodyFatPercent: input.bodyFatPercent,
      leanMassKg: input.leanMassKg,
      waistCm: input.waistCm,
      chestCm: input.chestCm,
      hipsCm: input.hipsCm,
      armCm: input.armCm,
      thighCm: input.thighCm,
      notes: (input.notes ?? "").trim(),
      source: "coach",
      measuredAt: input.measuredAt,
    },
  };
}
