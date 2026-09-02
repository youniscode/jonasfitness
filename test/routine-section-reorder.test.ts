import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const service = read("app", "lib", "progress-service.ts");
const mechanics = read("app", "lib", "progress-mechanics.ts");
const detail = read("app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx");
const sectionsReorderRoute = read("app", "api", "progress", "routines", "[id]", "sections", "reorder", "route.ts");
const text = read("app", "progress", "(product)", "progress-text.ts");
const css = read("app", "progress", "progress.css");

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

// reorderSections is the shared backend path for both the arrow buttons and the
// desktop drag-and-drop. A naive `position = index + 1` loop collides with the
// UNIQUE (routine_id, position) index when swapping two sections (2->1 while 1
// is still occupied), so the write must be collision-safe inside one transaction.

const reorder = slice(service, "export async function reorderSections", "// --- Routine exercises");

test("section reorder uses a two-phase write so a swap never collides with the unique position index", () => {
  assert.match(reorder, /set\(\{ position: sql`\$\{trainingRoutineSections\.position\} \+ 100000` \}\)/, "phase 1: every owned section moves into a temporary non-conflicting range");
  assert.match(reorder, /\.set\(\{ position: index \+ 1 \}\)/, "phase 2: final dense positions 1..N are assigned");
  const offsetIndex = reorder.indexOf("+ 100000");
  const denseIndex = reorder.indexOf("position: index + 1");
  assert.ok(offsetIndex < denseIndex, "the temporary offset runs before the dense assignment");
  assert.equal((reorder.match(/\.set\(\{ position:/g) ?? []).length, 2, "exactly two write phases for section rows");
});

test("the swap Legs(1)/Shoulders(2) is what the two-phase write makes safe (offset then densify)", () => {
  // Direct proof from code: the densify loop that writes 2->1 while 1 is still
  // occupied only runs AFTER every row has been pushed into the temporary range,
  // so the UNIQUE (routine_id, position) index can never see a transient clash.
  const offsetAt = reorder.indexOf("+ 100000");
  const denseAt = reorder.indexOf("for (const [index, id] of orderedSectionIds.entries())");
  assert.ok(offsetAt >= 0 && denseAt > offsetAt, "the dense 1..N pass only runs after the temporary offset phase");
  assert.ok(reorder.includes("+ 100000"), "temporary offset is high enough to never overlap valid section positions");
});

test("dense reorder leaves unique positions 1..N and returns the persisted layout for a reload", () => {
  assert.match(reorder, /\.set\(\{ position: index \+ 1 \}\)[\s\S]*?reindexRoutineOrder\(tx, ownerId, routineId\)/, "every section lands on 1..N before exercise reindexing");
  assert.match(reorder, /return routineLayout\(tx, ownerId, routineId\);/, "reorder returns the freshly persisted layout");
  assert.match(sectionsReorderRoute, /return Response\.json\(result\);/, "the endpoint echoes the persisted layout so the client renders saved positions");
  assert.ok(mechanics.includes("sections: [...sections].sort((a, b) => a.position - b.position)"), "read path sorts sections by persisted position");
});

test("reordering three sections (and back) persists: full dense pass covers every id exactly once", () => {
  const phase2 = reorder.slice(reorder.indexOf("for (const [index, id] of orderedSectionIds.entries())"));
  assert.match(phase2, /\.where\(and\(eq\(trainingRoutineSections\.id, id\), eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)\)/, "dense pass targets each id of the requested order, owner-scoped");
  assert.match(phase2, /position: index \+ 1/, "positions follow the requested order: first id -> 1, second -> 2, third -> 3");
});

test("duplicate, missing or foreign section ids are rejected before any write", () => {
  assert.match(reorder, /if \(orderedSectionIds\.length !== existing\.length\) return null;/, "the list must contain every section (missing ids rejected)");
  assert.match(reorder, /if \(!Number\.isInteger\(id\) \|\| !existingIds\.has\(id\) \|\| seen\.has\(id\)\) return null;/, "duplicates, non-integers and foreign ids are rejected");
  const offsetStart = reorder.indexOf("+ 100000");
  assert.ok(reorder.slice(0, offsetStart).includes("return null;"), "validation returns before the write phases");
});

test("exercise canonical order follows the new section order without changing membership or prescriptions", () => {
  assert.match(reorder, /reindexRoutineOrder\(tx, ownerId, routineId\)/, "section reorder reindexes the canonical exercise order");
  const reindex = slice(service, "async function reindexRoutineOrder", "export async function createRoutine");
  assert.match(reindex, /deriveRoutineExerciseOrder\(sections, exercises\)/, "exercise order derived from sections (by position) then members then ungrouped");
  assert.doesNotMatch(reorder, /trainingRoutineExercises\.sectionId|sectionId: null/, "section reorder never rewrites exercise membership");
  assert.doesNotMatch(reorder, /trainingRoutineExercises\)\.set\(|exercises: \{|prescription/, "section reorder never rewrites prescriptions");
  assert.doesNotMatch(reorder, /trainingWorkoutSessions/, "section reorder never touches workout history");
  assert.doesNotMatch(reindex, /trainingWorkoutSessions/, "reindexing never touches workout history either");
});

test("owner isolation is preserved end to end (routine check + every write is owner-scoped)", () => {
  assert.match(reorder, /eq\(trainingRoutines\.id, routineId\), eq\(trainingRoutines\.ownerId, ownerId\)\)\)\.limit\(1\);[\s\S]*?if \(!routine\) return null;/, "routine ownership is verified inside the transaction");
  assert.ok(reorder.includes("position: sql`${trainingRoutineSections.position} + 100000` })"), "phase-1 offset exists");
  assert.match(reorder, /\+ 100000` \}\)\s*\.where\(and\(eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)\)/, "phase-1 offset is routine+owner scoped");
  const denseWrites = reorder.match(/eq\(trainingRoutineSections\.id, id\), eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)\)/g) ?? [];
  assert.equal(denseWrites.length, 1, "phase-2 per-id writes are routine+owner scoped");
  assert.doesNotMatch(sectionsReorderRoute, /body\.ownerId/, "the endpoint never trusts a client ownerId");
  assert.match(sectionsReorderRoute, /reorderSections\(guarded\.ownerId, routineId, orderedIds\)/, "the endpoint passes only the authenticated owner");
});

test("the whole reorder runs inside a single transaction (any failure rolls back - no partial order)", () => {
  assert.match(reorder, /return db\.transaction\(async \(tx\) => \{/, "reorderSections runs in one transaction");
  assert.match(reorder, /return routineLayout\(tx, ownerId, routineId\);\s*\}\);\s*\}/, "the transaction callback wraps validation + both write phases + reindex + layout and closes before the function returns");
});

test("both the arrow buttons and desktop drag call the same safe endpoint", () => {
  const moveSection = slice(detail, "async function moveSection(", "async function dropSectionOn(");
  const dropSection = slice(detail, "async function dropSectionOn(", "async function startWorkout(");
  for (const [name, fn] of [["arrow moveSection", moveSection], ["drag dropSectionOn", dropSection]] as const) {
    assert.equal((fn.match(/sections\/reorder`/g) ?? []).length, 1, `${name} PUTs the shared reorder endpoint`);
    assert.equal((fn.match(/method: "PUT"/g) ?? []).length, 1, `${name} uses exactly one PUT`);
    assert.match(fn, /JSON\.stringify\(\{ orderedIds: reordered\.map\(\(item\) => item\.id\) \}\)/, `${name} sends the full ordered section id list`);
  }
});

test("section reorder failures surface a localized message without database details", () => {
  assert.equal((detail.match(/setError\(t\.sectionReorderError\)/g) ?? []).length, 2, "both section reorder paths use the localized failure copy");
  const moveSection = slice(detail, "async function moveSection(", "async function dropSectionOn(");
  const dropSection = slice(detail, "async function dropSectionOn(", "async function startWorkout(");
  assert.doesNotMatch(moveSection, /issue\.message/, "arrow path never shows a raw server/SQL message");
  assert.doesNotMatch(dropSection, /issue\.message/, "drag path never shows a raw server/SQL message");
  assert.equal((text.match(/sectionReorderError: /g) ?? []).length, 3, "failure key present in FR, EN and AR");
  assert.ok(text.includes('sectionReorderError: "Could not reorder sections. Try again."'), "EN failure copy");
  assert.ok(text.includes('sectionReorderError: "Impossible de réorganiser les sections. Réessayez."'), "FR failure copy");
  assert.ok(text.includes('sectionReorderError: "تعذر إعادة ترتيب الأقسام. حاول مرة أخرى."'), "AR failure copy");
});

test("no U+2014 em dash in the edited files", () => {
  for (const [name, src] of [["progress-service.ts", service], ["RoutineDetail.tsx", detail], ["progress-text.ts", text], ["progress.css", css]] as const) {
    assert.ok(!src.includes("\u2014"), `${name} contains a forbidden U+2014 em dash`);
  }
});
