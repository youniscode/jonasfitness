import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalRoutinePlacements } from "../app/lib/progress-mechanics.ts";

// ---------------------------------------------------------------------------
// ROOT-CAUSE REGRESSION: the previous reorderRoutineExercises wrote only
// section_id per placement and then re-derived the order from the PRE-REORDER
// position values (reindexRoutineOrder -> deriveRoutineExerciseOrder sorts by
// a.position - b.position). A same-section swap like [6,7] -> [7,6] therefore
// changed nothing and the client dropped silently snapped back. These tests
// pin the fixed contract: the request placement SEQUENCE itself must become
// the persisted dense position column.
//
// TEST-GAP NOTE (section 11): the Playwright suite drives a public harness
// whose MOCK server (app/dev/routine-sortable/page.tsx applyPlacements)
// applies the frontend placements to positions itself - exactly like a correct
// backend would - so the browser tests verified the request mapping but could
// not observe what the real backend persisted. That backend mapping is what
// this file pins: real math against the engine the service now calls, plus a
// source contract over the service write path.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const service = read("app", "lib", "progress-service.ts");

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

type Placement = { exerciseId: number; sectionId: number | null };
const withPositions = (placements: Placement[]) => placements.map((p, i) => ({ ...p, position: i + 1 }));

// ===========================================================================
// 1. PURE-MATH: canonical final order + dense position assignment
// ===========================================================================

// §6 fixture: a routine whose only exercises are the two TRICEPS rows.
const founderSections = [{ id: 2, position: 1 }];

test("FOUNDER REPRO: placements [7,6] (section 2) must persist as 7->position 1, 6->position 2", () => {
  const final = canonicalRoutinePlacements(founderSections, [
    { exerciseId: 7, sectionId: 2 },
    { exerciseId: 6, sectionId: 2 },
  ]);
  assert.deepEqual(final.map((p) => p.exerciseId), [7, 6], "order [7,6] is retained");
  assert.deepEqual(withPositions(final), [
    { exerciseId: 7, sectionId: 2, position: 1 },
    { exerciseId: 6, sectionId: 2, position: 2 },
  ]);
  assert.notDeepEqual(final.map((p) => p.exerciseId), [6, 7], "the old-position order [6,7] is NOT what gets written");
});

test("reverse proof: [6,7] persists as [6,7]", () => {
  const final = canonicalRoutinePlacements(founderSections, [
    { exerciseId: 6, sectionId: 2 },
    { exerciseId: 7, sectionId: 2 },
  ]);
  assert.deepEqual(final.map((p) => p.exerciseId), [6, 7]);
  assert.deepEqual(withPositions(final).map((p) => [p.exerciseId, p.position]), [[6, 1], [7, 2]]);
});

test("3-item reorder: request C,A,B -> positions C=1, A=2, B=3", () => {
  const final = canonicalRoutinePlacements([{ id: 1, position: 1 }], [
    { exerciseId: 3, sectionId: 1 },
    { exerciseId: 1, sectionId: 1 },
    { exerciseId: 2, sectionId: 1 },
  ]);
  assert.deepEqual(final.map((p) => p.exerciseId), [3, 1, 2]);
  assert.deepEqual(withPositions(final).map((p) => [p.exerciseId, p.position]), [[3, 1], [1, 2], [2, 3]]);
});

test("cross-section: 7 moved into BACK between 4 and 5 -> canonical [4,7,5,6] with dense 1..4", () => {
  const sections = [{ id: 1, position: 1 }, { id: 2, position: 2 }];
  const final = canonicalRoutinePlacements(sections, [
    { exerciseId: 4, sectionId: 1 },
    { exerciseId: 7, sectionId: 1 }, // membership changes to BACK
    { exerciseId: 5, sectionId: 1 },
    { exerciseId: 6, sectionId: 2 },
  ]);
  assert.deepEqual(final.map((p) => p.exerciseId), [4, 7, 5, 6]);
  assert.deepEqual(withPositions(final).map((p) => [p.exerciseId, p.sectionId, p.position]), [
    [4, 1, 1], [7, 1, 2], [5, 1, 3], [6, 2, 4],
  ]);
  // Requested within-section order preserved: BACK is 4,7,5 exactly as asked.
  assert.equal(final[1].exerciseId, 7, "requested relative position of the moved exercise is honored");
});

test("the server re-blocks a malformed client: sections by position, ungrouped last, requested order kept inside each section", () => {
  const sections = [{ id: 1, position: 1 }, { id: 2, position: 2 }];
  // Client interleaves blocks: 2,2,1,1,null.
  const interleaved = canonicalRoutinePlacements(sections, [
    { exerciseId: 7, sectionId: 2 },
    { exerciseId: 6, sectionId: 2 },
    { exerciseId: 4, sectionId: 1 },
    { exerciseId: 5, sectionId: 1 },
    { exerciseId: 8, sectionId: null },
  ]);
  assert.deepEqual(interleaved.map((p) => p.exerciseId), [4, 5, 7, 6, 8], "blocks are canonical, TRICEPS keeps [7,6] inside");
  // Ungrouped requested first still lands last.
  const ungroupedFirst = canonicalRoutinePlacements(sections, [
    { exerciseId: 8, sectionId: null },
    { exerciseId: 4, sectionId: 1 },
    { exerciseId: 6, sectionId: 2 },
    { exerciseId: 5, sectionId: 1 },
    { exerciseId: 7, sectionId: 2 },
  ]);
  assert.deepEqual(ungroupedFirst.map((p) => p.exerciseId), [4, 5, 6, 7, 8], "ungrouped always tails the routine");
});

test("the canonical helper is pure: neither argument is mutated", () => {
  const sections = [{ id: 2, position: 1 }];
  const placements: Placement[] = [
    { exerciseId: 7, sectionId: 2 },
    { exerciseId: 6, sectionId: 2 },
  ];
  const sectionsBefore = JSON.stringify(sections);
  const placementsBefore = JSON.stringify(placements);
  canonicalRoutinePlacements(sections, placements);
  assert.equal(JSON.stringify(sections), sectionsBefore);
  assert.equal(JSON.stringify(placements), placementsBefore);
});

// ===========================================================================
// 2. SOURCE CONTRACT: the service persists the requested sequence
// ===========================================================================

const reorder = slice(service, "export async function reorderRoutineExercises", "// --- Workout sessions");

test("REGRESSION AGAINST THE OLD BUG: positions are assigned from the requested placement sequence, never re-derived", () => {
  assert.match(reorder, /canonicalRoutinePlacements\(/, "the final layout is computed from the requested placements");
  assert.match(reorder, /\.set\(\{ sectionId: placement\.sectionId, position: index \+ 1 \}\)/, "phase 2 writes section_id AND the requested dense position together");
  assert.doesNotMatch(reorder, /reindexRoutineOrder\(/, "no re-derivation from pre-reorder positions afterwards");
  assert.doesNotMatch(reorder, /deriveRoutineExerciseOrder/, "order is never recomputed from existing position values");
  const writeAt = reorder.indexOf("position: index + 1");
  assert.ok(writeAt > reorder.indexOf("finalPlacements"), "the dense write happens after the canonical order is computed");
});

test("two-phase collision-safe write keeps the UNIQUE (routine_id, position) index intact", () => {
  assert.match(reorder, /set\(\{ position: sql`\$\{trainingRoutineExercises\.position\} \+ 100000` \}\)/, "phase 1: every owned exercise moves into a temporary non-conflicting range");
  const offset = reorder.indexOf("+ 100000");
  const dense = reorder.indexOf("position: index + 1");
  assert.ok(offset >= 0 && dense > offset, "the temporary offset phase runs before the dense 1..N pass");
  assert.equal((reorder.match(/\.set\(\{ position:/g) ?? []).length, 1, "exactly one position-offset write");
  assert.match(reorder, /\+ 100000` \}\)\s*\.where\(and\(eq\(trainingRoutineExercises\.routineId, routineId\), eq\(trainingRoutineExercises\.ownerId, ownerId\)\)\)/, "phase-1 offset is routine+owner scoped");
  assert.match(reorder, /\.set\(\{ sectionId: placement\.sectionId, position: index \+ 1 \}\)[\s\S]*?\.where\(and\(eq\(trainingRoutineExercises\.id, placement\.exerciseId\), eq\(trainingRoutineExercises\.routineId, routineId\), eq\(trainingRoutineExercises\.ownerId, ownerId\)\)\)/, "phase-2 writes are scoped by exerciseId + routineId + ownerId");
});

test("security/integrity surface is unchanged: full-set validation, owner scoping, transaction, untouched history/prescriptions", () => {
  assert.match(reorder, /eq\(trainingRoutines\.id, routineId\), eq\(trainingRoutines\.ownerId, ownerId\)\)\)\.limit\(1\);[\s\S]*?if \(!routine\) return null;/, "routine ownership verified inside the transaction");
  assert.match(reorder, /!Number\.isInteger\(placement\.exerciseId\) \|\| !existingIds\.has\(placement\.exerciseId\) \|\| seen\.has\(placement\.exerciseId\)\) return null;/, "duplicate/foreign exercise ids rejected");
  assert.match(reorder, /if \(placement\.sectionId !== null && !validSectionIds\.has\(placement\.sectionId\)\) return null;/, "foreign (cross-routine) sections rejected");
  assert.match(reorder, /if \(seen\.size !== existing\.length\) return null;/, "the list must describe the whole routine");
  assert.match(reorder, /return db\.transaction\(async \(tx\) => \{/, "the whole operation runs in one transaction");
  assert.match(reorder, /return routineLayout\(tx, ownerId, routineId\);/, "returns the freshly persisted layout for a reload");
  assert.doesNotMatch(reorder, /trainingWorkoutSessions/, "completed workout history is never touched");
  assert.doesNotMatch(reorder, /sets:|targetRepMin|targetRepMax|targetRir|notes:|weightUnit/, "prescriptions are never rewritten");
});

// The gap note lives in the file header comment; this test documents the
// mock's placement-application so the gap stays visible.

test("the harness mock models the CORRECT backend behavior, which is why the browser suite passed while production failed", () => {
  const harness = read("app", "dev", "routine-sortable", "page.tsx");
  assert.match(harness, /position: index \+ 1, sectionId: placements\[index\]\.sectionId/, "mock: requests become confirmed positions");
  assert.ok(reorder.includes(".set({ sectionId: placement.sectionId, position: index + 1 })"), "the real backend now persists the same mapping");
  assert.ok(reorder.includes("canonicalRoutinePlacements("), "plus the server-side canonical re-blocking the mock does not need");
});