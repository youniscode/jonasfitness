import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderedSections,
  canonicalExercises,
  membersOf,
  planMove,
  planSectionOrder,
  type PublicExercise,
  type Routine,
  type Section,
} from "../app/progress/(product)/routines/[id]/routineLayout.ts";

// ---------------------------------------------------------------------------
// Real computational tests against the pure layout engine (imported directly,
// no string assertions): the order math is executed, not guessed at.
// ---------------------------------------------------------------------------

function exercise(id: number, sectionId: number | null, position: number): PublicExercise {
  return { id, position, sectionId, exerciseId: `e${id}`, name: `E${id}`, nameFr: "", nameAr: "", sets: 3, targetRepMin: 10, targetRepMax: 12, targetRir: 2, weightUnit: "kg", notes: "" };
}

function fixture(overrides?: { sections?: Section[]; exercises?: PublicExercise[] }): Routine {
  return {
    id: 2,
    name: "Fixture",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sections: overrides?.sections ?? [
      { id: 1, name: "BACK", position: 1 },
      { id: 2, name: "TRICEPS", position: 2 },
    ],
    exercises: overrides?.exercises ?? [
      exercise(4, 1, 1), exercise(5, 1, 2), exercise(6, 2, 3), exercise(7, 2, 4), exercise(8, null, 5),
    ],
  };
}

const ids = (r: Routine) => canonicalExercises(r).map((e) => e.id);
type Placement = { exerciseId: number; sectionId: number | null };

/** Applies placements exactly like the reorder endpoint (dense positions +
 *  authoritative section membership), i.e. the server-confirmed reload. */
function applyPlacements(r: Routine, ps: Placement[]): Routine {
  return {
    ...r,
    exercises: r.exercises.map((e) => {
      const index = ps.findIndex((p) => p.exerciseId === e.id);
      return index === -1 ? e : { ...e, position: index + 1, sectionId: ps[index].sectionId };
    }),
  };
}

/**
 * Mirrors RoutineSortable.dropOnExercise 1:1 - the deterministic card drop:
 * same-section direction from canonical indexes (dragged below the target =>
 * inserted before it), cross-section card drops inserted immediately BEFORE
 * the target card with its section. The component's exact rule line
 * (`const before = sameSection ? draggedIndex > targetIndex : true;`) is
 * pinned separately by the source-contract suite, so a divergence between
 * this mirror and the component is caught. No pointer input anywhere.
 */
function cardDrop(r: Routine, draggedId: number, targetId: number): Placement[] {
  const full = canonicalExercises(r);
  const targetIndex = full.findIndex((e) => e.id === targetId);
  const draggedIndex = full.findIndex((e) => e.id === draggedId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedId === targetId) return [];
  const draggedSection = full[draggedIndex].sectionId ?? null;
  const targetSection = full[targetIndex].sectionId ?? null;
  const sameSection = draggedSection === targetSection;
  const before = sameSection ? draggedIndex > targetIndex : true;
  return planMove(r, draggedId, sameSection ? "same" : targetSection, before ? targetIndex : targetIndex + 1);
}

// --- Canonical order --------------------------------------------------------

test("canonical order: section blocks by section order, then ungrouped", () => {
  const r = fixture();
  assert.deepEqual(ids(r), [4, 5, 6, 7, 8]);
  assert.deepEqual(membersOf(r, 1).map((e) => e.id), [4, 5]);
  assert.deepEqual(membersOf(r, 2).map((e) => e.id), [6, 7]);
  assert.deepEqual(membersOf(r, null).map((e) => e.id), [8]);
  assert.deepEqual(orderedSections(r).map((s) => s.id), [1, 2]);
});

// --- NO-OP GUARD: the exact founder reproduction ----------------------------

test("NO-OP GUARD: TRICEPS [6,7], dragged 7 over 6 MUST produce [7,6], never the unchanged [6,7]", () => {
  const r = fixture();
  assert.deepEqual(ids(r), [4, 5, 6, 7, 8], "before: Overhead (6) above Triceps pressdown (7)");
  const result = cardDrop(r, 7, 6);
  assert.deepEqual(result.map((p) => p.exerciseId), [4, 5, 7, 6, 8], "request: [7,6] inside TRICEPS");
  assert.notDeepEqual(result.map((p) => p.exerciseId), [4, 5, 6, 7, 8], "the placements MUST differ from the current canonical order");
  // Membership and prescriptions untouched.
  assert.deepEqual(result.map((p) => p.sectionId), [1, 1, 2, 2, null]);
  // Server-confirmed reload renders exactly the requested order.
  assert.deepEqual(ids(applyPlacements(r, result)), [4, 5, 7, 6, 8]);
  assert.deepEqual(membersOf(applyPlacements(r, result), 2).map((e) => e.id), [7, 6], "DOM after reload: Triceps pressdown above Overhead");
});

test("drag it back: [7,6] -> [6,7] through the same deterministic rule", () => {
  const afterForward = applyPlacements(fixture(), cardDrop(fixture(), 7, 6));
  assert.deepEqual(ids(afterForward), [4, 5, 7, 6, 8]);
  const back = cardDrop(afterForward, 7, 6); // 7 now sits ABOVE 6 => lands AFTER it
  assert.deepEqual(back.map((p) => p.exerciseId), [4, 5, 6, 7, 8]);
  assert.deepEqual(ids(applyPlacements(afterForward, back)), [4, 5, 6, 7, 8]);
});

test("three exercises in one section reorder deterministically in both directions", () => {
  const r = fixture({
    sections: [{ id: 1, name: "ONE", position: 1 }],
    exercises: [exercise(1, 1, 1), exercise(2, 1, 2), exercise(3, 1, 3)],
  });
  assert.deepEqual(ids(r), [1, 2, 3]);
  assert.deepEqual(cardDrop(r, 3, 1).map((p) => p.exerciseId), [3, 1, 2], "drag 3 above 1");
  assert.deepEqual(cardDrop(r, 1, 3).map((p) => p.exerciseId), [2, 3, 1], "drag 1 below 3");
});

// --- Cross-section card drops ------------------------------------------------

test("cross-section card drop inserts BEFORE the target card and changes membership", () => {
  const r = fixture();
  const result = cardDrop(r, 7, 5); // Triceps pressdown onto Seated cable row (BACK)
  assert.deepEqual(result.map((p) => p.exerciseId), [4, 7, 5, 6, 8]);
  assert.equal(result.find((p) => p.exerciseId === 7)?.sectionId, 1, "7 joins BACK");
  assert.equal(result.find((p) => p.exerciseId === 6)?.sectionId, 2, "6 stays TRICEPS");
  assert.equal(result.find((p) => p.exerciseId === 8)?.sectionId, null, "ungrouped stays ungrouped");
});

test("cross-section drop in the other direction (earlier section onto a later-section card)", () => {
  const r = fixture();
  const result = cardDrop(r, 4, 6); // Straight-arm pulldown (BACK) onto Overhead (TRICEPS)
  assert.deepEqual(result.map((p) => p.exerciseId), [5, 4, 6, 7, 8]);
  assert.equal(result.find((p) => p.exerciseId === 4)?.sectionId, 2, "4 joins TRICEPS immediately before the target card");
});

// --- Header drops --------------------------------------------------------------

test("section header and ungrouped header drops append to the block end", () => {
  const r = fixture();
  const intoSection = planMove(r, 8, 1, null);
  assert.deepEqual(intoSection.map((p) => p.exerciseId), [4, 5, 8, 6, 7]);
  assert.equal(intoSection.find((p) => p.exerciseId === 8)?.sectionId, 1);
  const ungrouped = planMove(r, 4, null, null);
  assert.deepEqual(ungrouped.map((p) => p.exerciseId), [5, 6, 7, 8, 4]);
  assert.equal(ungrouped.find((p) => p.exerciseId === 4)?.sectionId, null);
});

// --- Section order ---------------------------------------------------------------

test("section order: swaps, three-block moves, deterministic before/after, safe failures", () => {
  const s1: Section = { id: 1, name: "A", position: 1 };
  const s2: Section = { id: 2, name: "B", position: 2 };
  const s3: Section = { id: 3, name: "C", position: 3 };
  assert.deepEqual(planSectionOrder([s1, s2], 2, 1, true), [2, 1], "B dragged above A");
  assert.deepEqual(planSectionOrder([s2, s1], 2, 1, false), [1, 2], "B (now above) dragged below A again");
  assert.deepEqual(planSectionOrder([s1, s2, s3], 3, 1, true), [3, 1, 2], "C dragged above A");
  assert.deepEqual(planSectionOrder([s1, s2, s3], 1, 3, false), [2, 3, 1], "A dragged below C");
  assert.equal(planSectionOrder([s1, s2], 1, 999, true), null, "unknown target fails safely");
  assert.equal(planSectionOrder([s1, s2], 999, 1, true), null, "unknown dragged fails safely");
});

// --- Safety and purity -------------------------------------------------------------

test("unknown and self drops are safe no-ops", () => {
  const r = fixture();
  assert.deepEqual(cardDrop(r, 999, 6), [], "unknown dragged id");
  assert.deepEqual(cardDrop(r, 7, 999), [], "unknown target id");
  assert.deepEqual(cardDrop(r, 7, 7), [], "self drop");
  assert.deepEqual(planMove(r, 999, "same", 0), [], "planMove rejects unknown dragged");
});

test("planMove and planSectionOrder never mutate their inputs", () => {
  const r = fixture();
  const before = JSON.stringify(r);
  planMove(r, 7, "same", 0);
  planMove(r, 7, 1, 1);
  planSectionOrder(r.sections, 2, 1, true);
  assert.equal(JSON.stringify(r), before);
});

test("prescriptions survive every placement: only exerciseId/sectionId are ever rewritten", () => {
  const r = fixture();
  const before = r.exercises.map((e) => ({ id: e.id, sets: e.sets, targetRepMin: e.targetRepMin, targetRepMax: e.targetRepMax, targetRir: e.targetRir }));
  for (const ps of [cardDrop(r, 7, 6), cardDrop(r, 7, 5), planMove(r, 4, null, null)]) {
    for (const p of ps) assert.deepEqual(Object.keys(p).sort(), ["exerciseId", "sectionId"]);
  }
  const after = applyPlacements(r, cardDrop(r, 7, 5)).exercises.map((e) => ({ id: e.id, sets: e.sets, targetRepMin: e.targetRepMin, targetRepMax: e.targetRepMax, targetRir: e.targetRir }));
  assert.deepEqual(after, before);
});