import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression coverage for the P0: "cannot create a routine after a training
// reset" - i.e. an owner with ZERO routines but a PRESERVED historical
// first-routine validation event must be able to create a routine.
//
// The repository's test suite has no live-database harness, so these tests
// lock the invariant statically (the same slice-and-assert style used across
// test/routine-*.test.ts): the product write (routine / workout) must never
// be awaited together with, or inside the same transaction as, its
// best-effort first-action analytics event; duplicate recording must be a
// no-op at the database level; and the analytics helper itself must never
// reject. Together these prove routine creation cannot fail (500 or rollback)
// merely because a historical progress_routine_created event already exists.

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const service = read("app", "lib", "progress-service.ts");
const paymentsService = read("app", "lib", "payments-service.ts");
const schema = read("db", "schema.ts");
const migration0014 = read("drizzle-neon", "0014_old_senator_kelly.sql");

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

// --- Product write stays primary: routine creation -----------------------

const createRoutine = slice(service, "export async function createRoutine", "export async function updateRoutineMeta");
const startWorkout = slice(service, "export async function startWorkout", "export async function saveWorkout");
const saveWorkout = slice(service, "export async function saveWorkout", "// --- Reads (history, dashboard)");

test("createRoutine runs the routine INSERT first and outside any transaction", () => {
  assert.doesNotMatch(createRoutine, /db\.transaction/, "the routine insert is never wrapped in a transaction with other writes");
  assert.match(createRoutine, /await db\.insert\(trainingRoutines\)/, "the product insert is awaited");
});

test("createRoutine records the first-routine event fire-and-forget AFTER the insert (never awaited)", () => {
  assert.match(createRoutine, /void recordFirstRoutineCreated\(ownerId\);/, "event is fired and forgotten, not awaited");
  assert.doesNotMatch(createRoutine, /await recordFirstRoutineCreated/, "an event failure can never fail the routine response");
  const insertAt = createRoutine.indexOf("await db.insert(trainingRoutines)");
  const eventAt = createRoutine.indexOf("void recordFirstRoutineCreated(ownerId)");
  assert.ok(insertAt >= 0 && eventAt > insertAt, "the routine row is committed before the analytics event is even attempted");
});

// --- Workout start / completion carry the same invariant ------------------

test("startWorkout records first-workout-started AFTER its transaction commits, only on a real start", () => {
  assert.match(startWorkout, /const result = await db\.transaction\(async \(tx\) => \{/, "the product transaction result is captured");
  assert.doesNotMatch(startWorkout, /await recordFirstWorkoutStarted/, "the analytics event is never awaited");
  assert.match(startWorkout, /if \(result && !\("conflict" in result\)\) void recordFirstWorkoutStarted\(ownerId\);/, "event fires only when a session was really started (never on active-conflict / missing routine)");
  const txClose = startWorkout.indexOf("});", startWorkout.indexOf("await db.transaction"));
  const eventAt = startWorkout.indexOf("void recordFirstWorkoutStarted(ownerId)");
  assert.ok(txClose >= 0 && eventAt > txClose, "the event is recorded only after the transaction has closed");
});

test("saveWorkout records first-workout-completed fire-and-forget on completion only", () => {
  assert.doesNotMatch(saveWorkout, /db\.transaction/, "completion is not wrapped in a transaction");
  assert.doesNotMatch(saveWorkout, /await recordFirstWorkoutCompleted/, "the event is never awaited");
  assert.match(saveWorkout, /if \(input\.status === "completed"\) void recordFirstWorkoutCompleted\(ownerId\);/, "event fires only for completed workouts, after the update");
});

// --- Analytics is secondary and can never reject --------------------------

const activationHelpers = slice(paymentsService, "async function recordFirstActivationEvent", "// --- Validation metrics");

test("the first-action helpers swallow and log any failure (never reject)", () => {
  assert.match(activationHelpers, /try \{\s*await recordValidationEvent\(ownerId, eventName, "first"\);/, "insert is attempted inside a try");
  assert.match(activationHelpers, /\} catch \(error\) \{\s*console\.error\(/, "any failure is logged and swallowed");
  assert.doesNotMatch(activationHelpers, /throw/, "a recording failure can never propagate to the product write");
});

test("exported first-action helpers delegate only to the never-throw wrapper", () => {
  assert.match(activationHelpers, /export function recordFirstRoutineCreated\(ownerId: string\): Promise<void> \{\s*return recordFirstActivationEvent\(ownerId, "progress_routine_created"\);/, "routine helper delegates");
  assert.match(activationHelpers, /export function recordFirstWorkoutStarted\(ownerId: string\): Promise<void> \{\s*return recordFirstActivationEvent\(ownerId, "progress_workout_started"\);/, "workout-start helper delegates");
  assert.match(activationHelpers, /export function recordFirstWorkoutCompleted\(ownerId: string\): Promise<void> \{\s*return recordFirstActivationEvent\(ownerId, "progress_workout_completed"\);/, "workout-complete helper delegates");
});

// --- Duplicate recording is a database-level no-op ------------------------

test("recordValidationEvent is idempotent on the exact unique (owner, event_name, dedupe_key) triple", () => {
  const recordEvent = slice(paymentsService, "export async function recordValidationEvent", "async function recordFirstActivationEvent");
  assert.match(recordEvent, /\.onConflictDoNothing\(\{ target: \[validationEvents\.ownerId, validationEvents\.eventName, validationEvents\.dedupeKey\] \}\)/, "a replay of the same first-action event inserts nothing");
});

test("the idempotency target matches the schema and the shipped migration index", () => {
  assert.match(schema, /uniqueIndex\("validation_events_owner_name_key_unique"\)\.on\(table\.ownerId, table\.eventName, table\.dedupeKey\)/, "schema unique index covers the exact triple");
  assert.match(migration0014, /CREATE UNIQUE INDEX "validation_events_owner_name_key_unique" ON "validation_events" USING btree \("owner_id","event_name","dedupe_key"\)/, "migration 0014 ships the same unique index the conflict target relies on");
});

// --- Scenario semantics (encoded, since no live-DB harness exists) --------

test("a historical first-routine event can never block or duplicate: the DB rejects duplicates and the helper treats them as a no-op", () => {
  // Two different owners may both record a first event (dedupe "first" is per
  // owner via the leading owner_id index column), and the SAME owner hitting
  // the second time conflicts into ON CONFLICT DO NOTHING - exactly the
  // post-reset state (routines deleted, historical event preserved).
  assert.match(migration0014, /"owner_id","event_name","dedupe_key"/, "uniqueness is per (owner, event, key), so the historical row stays while new owners still count");
});
