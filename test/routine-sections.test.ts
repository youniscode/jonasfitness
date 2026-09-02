import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const schema = read("db", "schema.ts");
const mechanics = read("app", "lib", "progress-mechanics.ts");
const service = read("app", "lib", "progress-service.ts");
const detail = read("app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx");
const sortable = read("app", "progress", "(product)", "routines", "[id]", "RoutineSortable.tsx");
const listView = read("app", "progress", "(product)", "routines", "RoutinesView.tsx");
const text = read("app", "progress", "(product)", "progress-text.ts");
const css = read("app", "progress", "progress.css");
const shell = read("app", "progress", "(product)", "ProgressShell.tsx");
const sectionPost = read("app", "api", "progress", "routines", "[id]", "sections", "route.ts");
const sectionIdRoute = read("app", "api", "progress", "routines", "[id]", "sections", "[sectionId]", "route.ts");
const sectionsReorder = read("app", "api", "progress", "routines", "[id]", "sections", "reorder", "route.ts");
const exPost = read("app", "api", "progress", "routines", "[id]", "exercises", "route.ts");
const exReorder = read("app", "api", "progress", "routines", "[id]", "exercises", "reorder", "route.ts");

const journal = JSON.parse(read("drizzle-neon", "meta", "_journal.json")) as { entries: { idx: number; tag: string }[] };
const sectionsMigration = journal.entries.find((entry) => entry.idx === 17);
assert.ok(sectionsMigration, "routine-sections migration is journal index 17");
const migration = read("drizzle-neon", `${sectionsMigration.tag}.sql`);

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

// ---------------------------------------------------------------------------
// Data model + migration
// ---------------------------------------------------------------------------

test("sections table is owner/routine scoped with position ordering and timestamps", () => {
  const sectionsTable = slice(schema, "export const trainingRoutineSections = pgTable", "export const trainingRoutineExercises = pgTable");
  assert.match(sectionsTable, /ownerId: text\("owner_id"\)\.notNull\(\)/, "sections carry a non-null owner");
  assert.match(sectionsTable, /routineId: integer\("routine_id"\)\.notNull\(\)\.references\(\(\) => trainingRoutines\.id, \{ onDelete: "cascade" \}\)/, "routine deletion cascades to its sections");
  assert.match(sectionsTable, /name: text\("name"\)\.notNull\(\)/, "section name is required");
  assert.match(sectionsTable, /position: integer\("position"\)\.notNull\(\)/, "section position is stored");
  assert.match(sectionsTable, /uniqueIndex\("training_routine_sections_routine_position_unique"\)\.on\(table\.routineId, table\.position\)/, "two sections cannot claim the same slot in a routine");
});

test("exercise section_id is nullable with ON DELETE set null (exercises survive section deletion)", () => {
  const exercisesTable = slice(schema, "export const trainingRoutineExercises = pgTable", "export const trainingWorkoutSessions");
  assert.match(exercisesTable, /sectionId: integer\("section_id"\)\.references\(\(\) => trainingRoutineSections\.id, \{ onDelete: "set null" \}\)/, "deleting a section nulls, never deletes, its exercises");
  assert.doesNotMatch(exercisesTable, /sectionId: integer\("section_id"\)\.notNull/, "section_id must stay nullable so ungrouped exercises are valid");
});

test("migration 0017 is additive-only: creates sections table and adds the nullable column", () => {
  assert.ok(migration.includes('CREATE TABLE "training_routine_sections"'), "creates the sections table");
  assert.ok(migration.includes('ALTER TABLE "training_routine_exercises" ADD COLUMN "section_id" integer'), "adds the nullable section_id column");
  assert.ok(migration.includes('ON DELETE set null'), "FK nulls section_id on section deletion");
  assert.doesNotMatch(migration, /^\s*(DROP (TABLE|COLUMN|SCHEMA)|DELETE FROM|TRUNCATE)\b/mi, "no destructive operations");
  assert.doesNotMatch(migration, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
});

// ---------------------------------------------------------------------------
// Mechanics: derived order + name validation
// ---------------------------------------------------------------------------

test("deriveRoutineExerciseOrder groups section blocks by position then ungrouped, ordered inside by position", () => {
  const derive = slice(mechanics, "export function deriveRoutineExerciseOrder", "export type PublicSession");
  assert.match(derive, /const sortedSections = \[\.\.\.sections\]\.sort\(\(a, b\) => a\.position - b\.position\);/, "sections are ranked by stored position");
  assert.match(derive, /rank\.get\(a\.sectionId\) \?\? ungroupedRank/, "unknown/foreign section ids fall back to the ungrouped block");
  assert.match(derive, /rankA - rankB \|\| a\.position - b\.position/, "canonical compare is section rank then position");
  assert.match(derive, /\.map\(\(exercise\) => exercise\.id\)/, "returns the final dense id order");
  assert.ok(derive.includes("const ungroupedRank = sortedSections.length; // ungrouped is always the last block"), "ungrouped block ranks after every section");
});

test("validateSectionName trims, caps at 80 and rejects empty names (mirrors routine names)", () => {
  const valid = slice(mechanics, "export function validateSectionName", "/**\n * Deterministic total order");
  assert.match(valid, /PROGRESS_SECTION_NAME_MAX/, "name cap comes from the shared constant");
  assert.match(valid, /typeof value === "string" \? value\.trim\(\)/, "trims the input");
  assert.ok(mechanics.includes("export const PROGRESS_SECTION_NAME_MAX = 80;"), "80-char cap constant");
});

test("publicRoutine returns sections sorted by position with exercises, so a reload shows the same structure", () => {
  const pr = slice(mechanics, "export function publicRoutine", "export type PublicRoutineExerciseRow");
  assert.match(pr, /sections: \[\.\.\.sections\]\.sort\(\(a, b\) => a\.position - b\.position\)/, "sections sorted by position in the payload");
  assert.match(pr, /exercises: \[\.\.\.exercises\]\.sort\(\(a, b\) => a\.position - b\.position\)/, "exercises sorted by position in the payload");
});

// ---------------------------------------------------------------------------
// Service layer: section CRUD + security
// ---------------------------------------------------------------------------

test("createSection appends after the routine's last section inside an owner-scoped transaction", () => {
  const fn = slice(service, "export async function createSection", "export async function renameSection");
  assert.match(fn, /eq\(trainingRoutines\.id, routineId\), eq\(trainingRoutines\.ownerId, ownerId\)\)/, "routine ownership verified first");
  assert.match(fn, /position: \(maxRow\?\.max \?\? 0\) \+ 1/, "appends at max+1");
  assert.match(fn, /tx\.insert\(trainingRoutineSections\)\.values\(\{ routineId, ownerId, name: name\.trim\(\)\.slice\(0, 80\), position:/, "new section stores owner + trimmed name");
  assert.match(fn, /return routineLayout\(tx, ownerId, routineId\);/, "returns the full updated layout");
  assert.match(fn, /export async function createSection\(ownerId: string, routineId: number, name: string\)/, "owner always comes from the authenticated session parameter");
});

test("renameSection and deleteSection are scoped to (section, routine, owner)", () => {
  const rename = slice(service, "export async function renameSection", "export async function deleteSection");
  assert.match(rename, /eq\(trainingRoutineSections\.id, sectionId\), eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)/, "rename WHERE includes section + routine + owner");
  const del = slice(service, "export async function deleteSection", "export async function reorderSections");
  assert.match(del, /eq\(trainingRoutineSections\.id, sectionId\), eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)/, "delete WHERE includes section + routine + owner");
});

test("deleteSection moves its exercises to ungrouped (never deletes them) and reindexes the order", () => {
  const del = slice(service, "export async function deleteSection", "export async function reorderSections");
  assert.match(del, /set\(\{ sectionId: null \}\)/, "exercises become ungrouped");
  assert.match(del, /eq\(trainingRoutineExercises\.sectionId, sectionId\), eq\(trainingRoutineExercises\.routineId, routineId\), eq\(trainingRoutineExercises\.ownerId, ownerId\)\)/, "the nulling update is owner+routine scoped");
  assert.match(del, /await tx\.delete\(trainingRoutineSections\)/, "only the section row is deleted");
  assert.doesNotMatch(del, /tx\.delete\(trainingRoutineExercises\)|\.delete\(trainingRoutineExercises\)/, "exercise prescriptions are never deleted with a section");
  assert.match(del, /reindexRoutineOrder\(tx, ownerId, routineId\)/, "canonical positions re-derived afterwards");
  assert.doesNotMatch(del, /trainingWorkoutSessions/, "workout history is never touched");
});

test("reorderSections validates a complete, duplicate-free set of owned section ids before writing", () => {
  const fn = slice(service, "export async function reorderSections", "export async function addRoutineExercise");
  assert.match(fn, /if \(orderedSectionIds\.length !== existing\.length\) return null;/, "must list every section exactly");
  assert.match(fn, /!Number\.isInteger\(id\) \|\| !existingIds\.has\(id\) \|\| seen\.has\(id\)\) return null;/, "foreign/duplicate/non-integer ids rejected");
  assert.match(fn, /position: index \+ 1/, "positions rewritten densely");
  assert.match(fn, /reindexRoutineOrder\(tx, ownerId, routineId\)/, "exercise positions follow the new section order");
});

test("moving exercises later never rewrites completed workout history", () => {
  const reorderEx = slice(service, "export async function reorderRoutineExercises", "// --- Workout sessions");
  const sectionsFns = slice(service, "export async function createSection", "// --- Routine exercises");
  for (const [name, src] of [["reorderRoutineExercises", reorderEx], ["section CRUD", sectionsFns]] as const) {
    assert.doesNotMatch(src, /trainingWorkoutSessions/, `${name} never touches workout sessions`);
  }
});

test("reorderRoutineExercises accepts full placements, rejects cross-routine sections and requires the whole routine", () => {
  const fn = slice(service, "export async function reorderRoutineExercises", "// --- Workout sessions");
  assert.match(fn, /placements: RoutinePlacement\[\] = order\.map/, "normalises placements");
  assert.match(fn, /!Number\.isInteger\(placement\.exerciseId\) \|\| !existingIds\.has\(placement\.exerciseId\) \|\| seen\.has\(placement\.exerciseId\)\) return null;/, "exercise ids must be owned and unique");
  assert.match(fn, /if \(placement\.sectionId !== null && !validSectionIds\.has\(placement\.sectionId\)\) return null;/, "section ids are validated against THIS routine's sections (cross-routine assignment impossible)");
  assert.match(fn, /if \(seen\.size !== existing\.length\) return null;/, "the placement list must describe the whole routine");
  assert.match(fn, /set\(\{ sectionId: placement\.sectionId \}\)/, "section membership is persisted per placement");
  assert.match(fn, /reindexRoutineOrder\(tx, ownerId, routineId\)/, "dense positions rewritten after membership changes");
});

test("addRoutineExercise verifies the target section belongs to the same owner + routine", () => {
  const fn = slice(service, "export async function addRoutineExercise", "export async function updateRoutineExercise");
  assert.match(fn, /eq\(trainingRoutineSections\.id, sectionId\), eq\(trainingRoutineSections\.routineId, routineId\), eq\(trainingRoutineSections\.ownerId, ownerId\)\)/, "section ownership checked against owner + routine");
  assert.match(fn, /if \(!section\) return null;/, "foreign section aborts the transaction");
  assert.match(fn, /sectionId,/, "new prescription stores the section membership");
});

test("workout sessions start from the routine's stored exercise order (immutable snapshot)", () => {
  const start = slice(service, "export async function startWorkout", "export async function saveWorkout");
  assert.match(start, /eq\(trainingRoutineExercises\.routineId, routineId\), eq\(trainingRoutineExercises\.ownerId, ownerId\)\)\)\s*\.orderBy\(trainingRoutineExercises\.position\)/, "startWorkout reads prescriptions in canonical position order");
  assert.match(start, /buildWorkoutExercisesFromRoutine\(exerciseRows\.map\(toPrescription\), routine\.name, language\)/, "immutable snapshot built from the ordered prescriptions");
  assert.match(start, /exercises: exercisesJson/, "snapshot stored as JSON");
  assert.doesNotMatch(start, /trainingRoutineSections/, "snapshot does not depend on the current section structure");
});

test("listRoutines and getRoutine return sections with exercises (reload-safe structure)", () => {
  const list = slice(service, "export async function listRoutines", "export async function getRoutine");
  assert.match(list, /db\.select\(\)\.from\(trainingRoutineSections\)/, "sections loaded for list cards");
  assert.match(list, /sectionRows\.filter\(\(s\) => s\.routineId === routine\.id\)\.map\(\(row\) => \(\{ id: row\.id, name: row\.name, position: row\.position \}\)\)/, "list payload includes section summaries");
  assert.ok(service.includes("export async function getRoutine(ownerId: string, routineId: number) {\n  return routineLayout(getDb(), ownerId, routineId);\n}"), "detail delegates to the shared layout loader");
});

// ---------------------------------------------------------------------------
// API routes: security + validation
// ---------------------------------------------------------------------------

test("all section and reorder routes resolve the owner server-side and never read a client ownerId", () => {
  for (const [name, src] of [
    ["sections POST", sectionPost],
    ["sections PATCH/DELETE", sectionIdRoute],
    ["sections reorder", sectionsReorder],
    ["exercises POST", exPost],
    ["exercises reorder", exReorder],
  ] as const) {
    assert.match(src, /requireProgressApiOwner\(\)/, `${name} guards the session`);
    assert.doesNotMatch(src, /body\.ownerId/, `${name} never trusts a spoofed ownerId`);
  }
});

test("section create/rename validate a non-empty trimmed name (400) and unknown ids fail safe (404)", () => {
  assert.match(sectionPost, /if \(!name\) return Response\.json\(\{ error: "Give the section a name\." \}, \{ status: 400 \}\)/,
 "create rejects empty names");
  assert.match(sectionIdRoute, /if \(!name\) return Response\.json\(\{ error: "Give the section a name\." \}, \{ status: 400 \}\)/,
 "rename rejects empty names");
  assert.match(sectionPost, /if \(!Number\.isInteger\(routineId\)\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\)/,
 "bad routine id 404s before any write");
  assert.match(sectionIdRoute, /if \(!Number\.isInteger\(routineId\) \|\| !Number\.isInteger\(sectionId\)\) return Response\.json\(\{ error: "Section not found\." \}, \{ status: 404 \}\)/,
 "bad ids 404 before any write");
  assert.match(sectionPost, /if \(!result\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\)/,
 "unowned routine 404s on create");
  assert.match(sectionIdRoute, /if \(!result\) return Response\.json\(\{ error: "Section not found\." \}, \{ status: 404 \}\)/,
 "unowned/mismatched section 404s on rename and delete");
});

test("sections reorder requires a non-empty orderedIds body and delegates owner-scoped", () => {
  assert.match(sectionsReorder, /if \(!Array\.isArray\(body\.orderedIds\)\) return Response\.json\(\{ error: "Supply an ordered list of section ids\." \}, \{ status: 400 \}\)/,
 "missing orderedIds 400s");
  assert.match(sectionsReorder, /if \(!orderedIds\.length\) return Response\.json\(\{ error: "Supply at least one section id\." \}, \{ status: 400 \}\)/,
 "empty list 400s");
  assert.match(sectionsReorder, /reorderSections\(guarded\.ownerId, routineId, orderedIds\)/, "owner-scoped delegation");
});

test("exercise reorder keeps the placements shape and the legacy orderedIds shape, both owner-scoped", () => {
  assert.match(exReorder, /Array\.isArray\(body\.placements\)/, "placements body supported");
  assert.match(exReorder, /Array\.isArray\(body\.orderedIds\)/, "legacy orderedIds still supported");
  assert.match(exReorder, /reorderRoutineExercises\(guarded\.ownerId, routineId, placements\)/, "placements path is owner-scoped");
  assert.match(exReorder, /reorderRoutineExercises\(guarded\.ownerId, routineId, orderedIds\)/, "orderedIds path is owner-scoped");
  assert.match(exPost, /let sectionId: number \| null = null;[\s\S]*?addRoutineExercise\(guarded\.ownerId, routineId, prescription, languageOf\(body\.language\), sectionId\)/, "exercise POST forwards the section target with the owner");
});

// ---------------------------------------------------------------------------
// Routine detail UI
// ---------------------------------------------------------------------------

test("Add section form is always available, requires a trimmed name and caps at 80 chars", () => {
  assert.match(detail, /<form className="progress-add-section" onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void addSection\(\); \}\}>/, "Add section form present");
  assert.match(detail, /<label>\{t\.sectionName\}<input value=\{newSection\} maxLength=\{80\} onChange=\{\(event\) => setNewSection\(event\.target\.value\)\} placeholder=\{t\.addSection\} \/><\/label>/, "section name input with 80-char cap");
  assert.match(detail, /disabled=\{busy \|\| !newSection\.trim\(\)\}/, "empty names cannot be submitted");
  assert.ok(detail.includes("async function addSection("), "create handler exists");
  const add = slice(detail, "async function addSection(", "async function renameSection(");
  assert.match(add, /method: "POST"/, "sections POST used");
  assert.match(add, /`\/api\/progress\/routines\/\$\{routine\.id\}\/sections`/, "targets the sections endpoint");
});

test("each section header offers rename, reorder, delete actions and a count, with the destructive delete behind confirmation", () => {
  assert.match(sortable, /<strong>\{section\.name\}<\/strong>/, "section name rendered");
  assert.match(sortable, /<small>\{count\}<\/small>/, "member count chip");
  assert.match(sortable, /onStartRename=\{\(item\) => \{ setRenamingSectionId\(item\.id\); setSectionRename\(item\.name\); \}\}/, "Rename arms the inline editor");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} ↑`\} disabled=\{index === 0\}/, "move up with accessible label and boundary disable");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} ↓`\} disabled=\{index === total - 1\}/, "move down with accessible label and boundary disable");
  assert.match(sortable, /className="progress-ghost danger" type="button" onClick=\{\(\) => onRequestDelete\(section\)\}/, "delete uses danger styling and only arms confirmation");
  assert.match(sortable, /<button className="progress-ghost danger" type="button" disabled=\{busy\} onClick=\{\(\) => onDeleteConfirm\(section\)\}>/, "actual deletion only reachable from the confirm block");
  assert.equal((sortable.match(/onDeleteConfirm\(section\)/g) ?? []).length, 1, "destructive delete is reachable only from confirmation");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} \$\{section\.name\}`\}/, "section grip exposes an accessible drag label naming the section");
});

test("deleting a section shows an explicit confirm with localized title and body before any request", () => {
  const confirm = slice(sortable, "className=\"progress-section-confirm\"", "</div>");
  assert.ok(confirm.includes("<strong>{t.deleteSection}</strong>"), "confirm title");
  assert.ok(confirm.includes("<span>{t.deleteSectionBody}</span>"), "confirm body states exercises stay");
  assert.ok(confirm.includes("{t.cancel}"), "Cancel present");
  assert.ok(confirm.includes("{t.deleteSection}"), "confirm action label present");
});

test("rename section submits the inline editor and cancels on empty/blur without a request", () => {
  const renameFn = slice(detail, "async function renameSection(", "async function deleteSection(");
  assert.match(renameFn, /method: "PATCH"/, "rename uses PATCH");
  assert.match(renameFn, /`\/api\/progress\/routines\/\$\{routine\.id\}\/sections\/\$\{section\.id\}`/, "PATCH targets the section endpoint");
  assert.match(sortable, /if \(!sectionRename\.trim\(\)\) \{ setRenamingSectionId\(null\); return; \}/, "empty rename closes without a request");
  assert.match(sortable, /<form className="progress-section-rename" onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onRenameSave\(section\); \}\}>/, "inline rename form");
  assert.match(sortable, /<input value=\{sectionRename\} maxLength=\{80\} autoFocus onChange=\{\(event\) => onRenameChange\(event\.target\.value\)\} onBlur=\{\(\) => onRenameSave\(section\)\} aria-label=\{t\.sectionName\} \/>/, "rename input with cap, focus and blur-save");
});

test("every exercise card exposes accessible move up/down, a Move-to-section select and removal", () => {
  assert.match(sortable, /<button type="button" aria-label=\{t\.moveUp\} disabled=\{index === 0\} onClick=\{\(\) => onMove\(e, -1\)\}>↑<\/button>/, "move up accessible");
  assert.match(sortable, /<button type="button" aria-label=\{t\.moveDown\} disabled=\{index === groupLength - 1\} onClick=\{\(\) => onMove\(e, 1\)\}>↓<\/button>/, "move down accessible in sections");
  assert.ok(sortable.includes('className="progress-move-to-section"'), "move-to-section control present");
  assert.equal((detail.match(/<option value="">\{t\.ungrouped\}<\/option>/g) ?? []).length, 1, "add-exercise panel offers ungrouped");
  assert.equal((sortable.match(/<option value="">\{t\.ungrouped\}<\/option>/g) ?? []).length, 1, "the shared card template offers ungrouped for both grouped and tail rows");
  assert.match(sortable, /<select value=\{e\.sectionId === null \? "" : String\(e\.sectionId\)\} disabled=\{busy\} onChange=\{\(ev\) => onMoveToSection\(e, ev\.target\.value === "" \? null : Number\(ev\.target\.value\)\)\}>/, "cards keep a live membership select");
  assert.ok(sortable.includes("function moveExerciseToSection("), "membership change handler exists");
  const move = slice(sortable, "function moveExerciseToSection(", "function dropOnExercise(");
  assert.match(move, /planMove\(routine, e\.id, sectionId, null\)/, "move-to-section targets the chosen section end");
  assert.ok(sortable.includes("function planMove("), "pure placement planner exists");
});

test("desktop drag is pointer-based (dnd-kit) with the handle as the only drag initiator", () => {
  assert.match(sortable, /DndContext/, "dnd-kit DndContext present");
  assert.match(sortable, /useDraggable/, "pointer-based draggables in use");
  assert.match(sortable, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 8 \} \}\)/, "8px activation distance prevents accidental drags");
  assert.match(sortable, /className=\{`progress-drag-handle\$\{isDragging \? " progress-grabbing" : ""\}`\}/, "exercise handle is the draggable affordance");
  assert.equal((sortable.match(/\{\.\.\.listeners\}/g) ?? []).length, 2, "listeners are bound only on the exercise handle and the section grip");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} \$\{e\.name\}`\}/, "exercise handle carries an accessible label with the exercise name");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} \$\{section\.name\}`\}/, "section grip carries an accessible label with the section name");
  assert.match(sortable, /dropOnExercise\(activeIdNum, Number\(overId\.split\(":"\)\[1\]\), before\)/, "card drops route to the shared placement engine with before/after");
  assert.match(sortable, /dropIntoSection\(activeIdNum, overData\.sectionId \?\? null\)/, "dropping on a section header joins that section");
  assert.match(sortable, /dropIntoSection\(activeIdNum, null\)/, "dropping on the ungrouped header ungroups the exercise");
});

test("sections render as grouped blocks and exercises re-sort into their section under canonical order", () => {
  assert.match(sortable, /<div className="progress-section" key=\{section\.id\}>/, "section block per group");
  assert.ok(sortable.includes('"progress-section-head"'), "section header rendered");
  assert.match(sortable, /<div className="progress-exercise-order">\{String\(index \+ 1\)\.padStart\(2, "0"\)\}<\/div>/, "order badge inside each block is 1-based per block");
  assert.ok(sortable.includes("function canonicalExercises("), "canonical order helper exists");
  assert.ok(sortable.includes("function membersOf("), "membership helper exists");
  const canonical = slice(sortable, "function canonicalExercises(", "function membersOf(");
  assert.match(canonical, /sectionRank\(routine\.sections, a\.sectionId\) - sectionRank\(routine\.sections, b\.sectionId\) \|\| a\.position - b\.position/, "blocks ordered by section then position");
});

test("routines without any section still load and list their exercises (backward compatibility)", () => {
  assert.ok(sortable.includes("const ungroupedMembers = useMemo(() => membersOf(routine, null), [routine]);"), "ungrouped members derived from the routine");
  assert.match(sortable, /\(sections\.length > 0 \? ungroupedMembers\.length > 0 : totalExercises > 0\) &&/, "flat (no-section) routines render their exercises");
  assert.match(sortable, /sections\.length > 0 && <UngroupedHead/, "Ungrouped header only renders when sections exist");
  assert.match(sortable, /<strong>\{t\.ungrouped\}<\/strong>/, "ungrouped header label present");
  assert.match(sortable, /\{ungroupedMembers\.map\(\(e, i\) => \(/, "ungrouped members rendered");
  assert.match(sortable, /disabled=\{index === groupLength - 1\}/, "boundary uses the same member list length");
});

test("zero-exercise empty state says No exercises yet (never No routines yet)", () => {
  assert.match(sortable, /\{totalExercises === 0 && <div className="progress-empty"><strong>\{t\.noExercises\}<\/strong><span>\{t\.noExercisesHint\}<\/span><\/div>\}/, "sortable empty state uses the corrected copy keys");
  assert.doesNotMatch(sortable, /noRoutines|No routines yet\./, "the sortable surface never shows the routines-list empty copy");
  assert.doesNotMatch(detail, /noExercises: "No routines yet\."/, "the wrong string is not defined");
});

test("the routines LIST page still uses No routines yet only for its true empty state", () => {
  assert.match(listView, /\{t\.noRoutines\}/, "list empty state kept");
  assert.match(listView, /\{t\.noRoutinesHint\}/, "list hint kept");
});

test("reload preserves structure: the detail page renders from the server payload, not transient state", () => {
  const fetchEffect = slice(detail, "useEffect(() => {\n    let cancelled = false;", "return () => { cancelled = true; };");
  assert.match(fetchEffect, /`\/api\/progress\/routines\/\$\{id\}`/, "fetches the full routine layout");
  assert.ok(fetchEffect.includes("setRoutine(data?.routine ?? null)"), "server layout stored wholesale");
  assert.match(detail, /const sections = orderedSections\(routine\);/, "blocks derived from the fetched routine");
});

// ---------------------------------------------------------------------------
// Localization, RTL, mobile
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "addSection", "sectionName", "rename", "deleteSection", "deleteSectionBody",
  "move", "moveToSection", "ungrouped", "moveUp", "moveDown", "noExercises", "noExercisesHint", "done",
] as const;

test("section/reorder copy exists in FR, EN and AR with natural translations", () => {
  for (const key of REQUIRED_KEYS) {
    assert.equal((text.match(new RegExp(`\\b${key}: `, "g")) ?? []).length, 3, `key '${key}' present in all three locales`);
  }
  // EN exact strings.
  assert.ok(text.includes('addSection: "Add section"'), "EN Add section");
  assert.ok(text.includes('sectionName: "Section name"'), "EN Section name");
  assert.ok(text.includes('rename: "Rename"'), "EN Rename");
  assert.ok(text.includes('deleteSectionBody: "Exercises stay in this routine and become ungrouped."'), "EN section delete body");
  assert.ok(text.includes('ungrouped: "Ungrouped"'), "EN Ungrouped");
  assert.ok(text.includes('noExercises: "No exercises yet."'), "EN empty-state headline");
  assert.ok(text.includes('noExercisesHint: "Add your first exercise to build this routine."'), "EN empty-state hint");
  // FR natural equivalents.
  assert.ok(text.includes('addSection: "Ajouter une section"'), "FR Add section");
  assert.ok(text.includes('sectionName: "Nom de la section"'), "FR Section name");
  assert.ok(text.includes('deleteSection: "Supprimer la section"'), "FR Delete section");
  assert.ok(text.includes('deleteSectionBody: "Les exercices restent dans cette routine et deviennent sans section."'), "FR section delete body");
  assert.ok(text.includes('ungrouped: "Sans section"'), "FR Ungrouped");
  assert.ok(text.includes('moveToSection: "Déplacer vers la section"'), "FR Move to section");
  assert.ok(text.includes('moveUp: "Monter"'), "FR Move up");
  assert.ok(text.includes('moveDown: "Descendre"'), "FR Move down");
  assert.ok(text.includes('noExercises: "Aucun exercice encore."'), "FR empty-state headline");
  assert.ok(text.includes('noExercisesHint: "Ajoutez votre premier exercice pour construire cette routine."'), "FR empty-state hint");
  // AR natural equivalents.
  assert.ok(text.includes('addSection: "إضافة قسم"'), "AR Add section");
  assert.ok(text.includes('sectionName: "اسم القسم"'), "AR Section name");
  assert.ok(text.includes('deleteSection: "حذف القسم"'), "AR Delete section");
  assert.ok(text.includes('deleteSectionBody: "تبقى التمارين في هذا الروتين وتصبح بدون قسم."'), "AR section delete body");
  assert.ok(text.includes('ungrouped: "بدون قسم"'), "AR Ungrouped");
  assert.ok(text.includes('moveToSection: "نقل إلى قسم"'), "AR Move to section");
  assert.ok(text.includes('noExercises: "لا توجد تمارين بعد."'), "AR empty-state headline");
  assert.ok(text.includes('noExercisesHint: "أضف تمرينك الأول لبناء هذا الروتين."'), "AR empty-state hint");
});

test("the routine UI draws every section/reorder action from the dictionary (no hardcoded English labels)", () => {
  assert.doesNotMatch(detail + sortable, />Add section<|>Section name<|>Rename<|>Delete section<|>Move to section<|>Ungrouped<|>Move up<|>Move down<|>Done<|>Delete section\?<|>No exercises yet\.</, "labels come from t.* only");
  assert.match(detail, /\{t\.addSection\}/, "add section localized");
  assert.match(sortable, /\{t\.rename\}/, "rename localized");
  assert.match(sortable, /\{t\.deleteSection\}/, "delete localized");
  assert.match(sortable, /\{t\.moveToSection\}/, "move-to-section localized");
});

test("no U+2014 em dash anywhere in the edited files", () => {
  const files = [
    ["RoutineDetail.tsx", detail],
    ["RoutineSortable.tsx", sortable],
    ["RoutinesView.tsx", listView],
    ["progress-text.ts", text],
    ["progress.css", css],
    ["progress-service.ts", service],
    ["progress-mechanics.ts", mechanics],
    ["db/schema.ts", schema],
    ["migration 0017", migration],
  ] as const;
  for (const [name, src] of files) {
    assert.ok(!src.includes("\u2014"), `${name} contains a forbidden U+2014 em dash`);
  }
});

test("Arabic RTL mirrors the new layouts (shell dir toggle + logical margins only)", () => {
  assert.match(shell, /dir=\{rtl \? "rtl" : "ltr"\}/, "Progress shell toggles dir for Arabic");
  const sectionCss = slice(css, ".progress-section{", "/* Logger */");
  assert.doesNotMatch(sectionCss, /left:|right:|float:/, "section layouts use only logical/directional-free flex properties");
  assert.match(sectionCss, /margin-inline-start:auto/, "actions pinned to the inline end so RTL mirrors them");
});

test("mobile keeps accessible move controls and hides only the mouse drag handles", () => {
  const tablet = tail820(css);
  assert.match(tablet, /\.progress-section-grip,\.progress-drag-handle\{display:none\}/, "mouse drag handles hidden below 820px");
  assert.match(tablet, /\.progress-exercise-actions\{flex-direction:row;flex-wrap:wrap;align-items:center\}/, "action buttons wrap for touch");
  assert.match(tablet, /\.progress-exercise-actions \.progress-move-to-section\{flex:1;min-width:120px\}/, "move-to-section keeps touch width");
  assert.match(sortable, /aria-label=\{t\.moveUp\}/, "Move up accessible control present");
  assert.match(sortable, /aria-label=\{t\.moveDown\}/, "Move down accessible control present");
  const base = slice(css, ".progress-section-head{", ".progress-section-grip");
  assert.match(base, /min-width:0/, "section headers can shrink (no horizontal overflow)");
});

function tail820(src: string) {
  const start = src.indexOf("@media(max-width:820px){");
  assert.ok(start >= 0, "820px media block not found");
  const next = src.indexOf("@media(max-width:520px){");
  return src.slice(start, next);
}
