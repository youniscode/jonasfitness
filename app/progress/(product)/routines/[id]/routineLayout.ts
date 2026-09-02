// Pure routine layout math used by RoutineSortable (drag/drop, arrows,
// Move-to-section) and by the unit suite. Deliberately free of React and of
// pointer/timing state so the order engine can be reasoned about - and tested
// - as pure functions.
//
// The routine keeps one dense (routine-global) exercise position sequence; a
// section is a pure grouping layer over it. Canonical order: section blocks
// by section.position, then each member by position, then ungrouped.

export type PublicExercise = { id: number; position: number; sectionId: number | null; exerciseId: string; name: string; nameFr: string; nameAr: string; sets: number; targetRepMin: number; targetRepMax: number; targetRir: number; weightUnit: string; notes: string };
export type Section = { id: number; name: string; position: number };
export type Routine = { id: number; name: string; notes: string; createdAt: string; updatedAt: string; sections: Section[]; exercises: PublicExercise[] };
export type Placement = { exerciseId: number; sectionId: number | null };

/** Sections in header (position) order. */
export function orderedSections(routine: Routine): Section[] {
  return [...routine.sections].sort((a, b) => a.position - b.position);
}

/** Rank of a section (0..n-1); the ungrouped block always ranks last (n). */
function sectionRank(sections: Section[], sectionId: number | null): number {
  if (sectionId === null) return sections.length;
  const index = [...sections].sort((a, b) => a.position - b.position).findIndex((section) => section.id === sectionId);
  return index === -1 ? sections.length : index;
}

/** Canonical flat exercise order: section blocks by section order, then ungrouped. */
export function canonicalExercises(routine: Routine): PublicExercise[] {
  return [...routine.exercises].sort((a, b) =>
    sectionRank(routine.sections, a.sectionId) - sectionRank(routine.sections, b.sectionId) || a.position - b.position);
}

export function membersOf(routine: Routine, sectionId: number | null): PublicExercise[] {
  return canonicalExercises(routine).filter((exercise) => (exercise.sectionId ?? null) === sectionId);
}

/**
 * New placements after moving `draggedId`. `targetSection`:
 *  - "same" keeps membership (pure reorder),
 *  - a section id (or null) moves the exercise into that section/ungrouped at
 *    the end of the block (section/ungrouped header drops, Move-to-section),
 * plus `insertAt`: canonical index (of the full list) after which ordering
 * applies for within-list drops. When `insertAt` is used with a real section
 * target, the dragged exercise takes that section's id: dropping next to an
 * exercise of another section is a membership move, never a same-section
 * reorder. Returns the full final placements payload.
 *
 * Deterministic drop contract (used by the sortable drag end): same-section
 * card drops pass `before ? targetIndex : targetIndex + 1` where `before`
 * comes from the CANONICAL INDEXES (dragged below target => before it, above
 * => after it) - never from the pointer's release Y. Cross-section card drops
 * always pass `targetIndex` (insert immediately before the target card).
 */
export function planMove(
  routine: Routine,
  draggedId: number,
  targetSection: number | "same" | null,
  insertAt: number | null,
): Placement[] {
  const full = canonicalExercises(routine);
  const dragged = full.find((exercise) => exercise.id === draggedId);
  if (!dragged) return [];
  const rest = full.filter((exercise) => exercise.id !== draggedId);
  let finalIds: number[] = [];
  if (insertAt === null) {
    const groups: number[][] = orderedSections(routine).map(() => []);
    groups.push([]); // ungrouped tail block
    for (const exercise of rest) groups[sectionRank(routine.sections, exercise.sectionId)].push(exercise.id);
    const target = targetSection === "same" ? dragged.sectionId : targetSection;
    groups[sectionRank(routine.sections, target)].push(dragged.id);
    finalIds = groups.flat();
  } else {
    const restIds = rest.map((exercise) => exercise.id);
    const originalIndex = full.findIndex((exercise) => exercise.id === draggedId);
    let index = insertAt;
    if (originalIndex !== -1 && originalIndex < index) index -= 1;
    finalIds = [...restIds.slice(0, index), dragged.id, ...restIds.slice(index)];
  }
  const placementSection = targetSection === "same"
    ? dragged.sectionId
    : targetSection;
  return finalIds.map((id) => ({ exerciseId: id, sectionId: id === draggedId ? placementSection : (full.find((exercise) => exercise.id === id)?.sectionId ?? null) }));
}

/** Insert a dragged section before/after the target, using the same rest-insert
 *  math as planMove so sections and exercises share one order engine. Callers
 *  derive `before` deterministically from the section indexes (dragged below
 *  the target => before it, above => after it). */
export function planSectionOrder(sections: Section[], draggedId: number, targetId: number, before: boolean): number[] | null {
  const rest = sections.filter((section) => section.id !== draggedId);
  const targetRestIndex = rest.findIndex((section) => section.id === targetId);
  if (targetRestIndex === -1) return null;
  const insertAt = before ? targetRestIndex : targetRestIndex + 1;
  const dragged = sections.find((section) => section.id === draggedId);
  if (!dragged) return null;
  const next: Section[] = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
  return next.map((section) => section.id);
}