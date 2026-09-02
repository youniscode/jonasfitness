import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const view = read("app", "progress", "(product)", "routines", "RoutinesView.tsx");
const routeId = read("app", "api", "progress", "routines", "[id]", "route.ts");
const routeList = read("app", "api", "progress", "routines", "route.ts");
const service = read("app", "lib", "progress-service.ts");
const schema = read("db", "schema.ts");
const text = read("app", "progress", "(product)", "progress-text.ts");
const css = read("app", "progress", "progress.css");
const shell = read("app", "progress", "(product)", "ProgressShell.tsx");

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

const tail = (src: string, from: string) => src.slice(src.indexOf(from));

// ---------------------------------------------------------------------------
// Edit: UI + rename path
// ---------------------------------------------------------------------------

test("each routine card exposes an Edit action that is not destructive", () => {
  assert.match(view, /className="progress-routine-card-actions">\s*<button className="progress-ghost" type="button" onClick=\{\(\) => startEdit\(routine\)\}>\{t\.edit\}<\/button>/, "Edit button with localized label, plain (non-danger) ghost style");
  assert.doesNotMatch(view, /className="progress-ghost danger"[^>]*startEdit/, "the destructive style is never applied to Edit");
});

test("Edit swaps the card for an inline rename form preserving the existing name and notes", () => {
  const editForm = slice(view, 'className="progress-routine-card progress-routine-card-editing"', "</form>");
  assert.match(editForm, /<label className="progress-routine-field">\{t\.routineName\}<input name="name" defaultValue=\{routine\.name\} maxLength=\{80\} autoFocus \/>/, "name field seeded from the routine and keeps the 80-char max length");
  assert.match(editForm, /<label className="progress-routine-field">\{t\.routineNotes\}<textarea name="notes" defaultValue=\{routine\.notes\} maxLength=\{1200\} rows=\{2\} \/>/, "notes field seeded from the routine");
  assert.match(editForm, /type="submit"[^>]*>\{busyId === routine\.id \? t\.saving : t\.save\}/, "Save submits the form");
  assert.match(editForm, /\{t\.cancel\}<\/button>/, "Cancel closes the editor");
});

test("rename succeeds through the owner-scoped PUT and updates the list in place (no duplicate)", () => {
  const saveEdit = slice(view, "async function saveEdit(", "async function remove(");
  assert.match(saveEdit, /const name = String\(form\.get\("name"\) \?\? ""\)\.trim\(\);/, "name is read and trimmed before the async boundary");
  assert.match(saveEdit, /method: "PUT"/, "rename uses PUT");
  assert.match(saveEdit, /`\/api\/progress\/routines\/\$\{routine\.id\}`/, "PUT targets the routine id endpoint");
  assert.match(saveEdit, /\[data\.routine, \.\.\.current\.filter\(\(item\) => item\.id !== routine\.id\)\]/, "the saved routine replaces the old entry - never appends a duplicate");
  assert.match(saveEdit, /\.sort\(\(a, b\) => b\.updatedAt\.localeCompare\(a\.updatedAt\)\)/, "list resorts so updatedAt ordering matches the server");
  assert.equal((saveEdit.match(/method: "PUT"/g) ?? []).length, 1, "exactly one PUT per rename");
});

test("empty rename is rejected on the client with the localized message", () => {
  const saveEdit = slice(view, "async function saveEdit(", "async function remove(");
  assert.match(saveEdit, /if \(!name\) \{ setError\(t\.routineNameRequired\); return; \}/, "empty trimmed name stops the save before any request");
});

test("empty rename is rejected server-side before any write", () => {
  const put = slice(routeId, "export async function PUT", "export async function DELETE");
  assert.match(put, /const name = validateRoutineName\(body\.name\);[\s\S]*?if \(!name\) return Response\.json\(\{ error: "Give the routine a name\." \}, \{ status: 400 \}\);/, "PUT validates the trimmed name and returns 400");
  assert.match(routeList, /validateRoutineName\(body\.name\)/, "POST uses the same name validation");
});

test("exercises and their order survive a rename", () => {
  const updateMeta = slice(service, "export async function updateRoutineMeta", "export async function deleteRoutine");
  assert.match(updateMeta, /db\.select\(\)\.from\(trainingRoutineExercises\)[\s\S]*?\.orderBy\(trainingRoutineExercises\.position\)/, "exercises are re-read in position order after the update");
  assert.match(updateMeta, /return \{ routine: publicRoutine\(routine, exercises\.map\(publicRoutineExercise\)\) \};/, "the renamed routine is returned WITH its exercises");
  assert.doesNotMatch(updateMeta, /\.delete\(/, "rename never deletes exercises");
  const put = slice(routeId, "export async function PUT", "export async function DELETE");
  assert.match(put, /updateRoutineMeta\(guarded\.ownerId, routineId, name, typeof body\.notes === "string" \? body\.notes : ""\)/, "PUT preserves notes and passes no client owner");
});

test("historical workouts survive a rename (rename touches only the routine row)", () => {
  const updateMeta = slice(service, "export async function updateRoutineMeta", "export async function deleteRoutine");
  assert.doesNotMatch(updateMeta, /trainingWorkoutSessions/, "rename never touches workout sessions");
});

// ---------------------------------------------------------------------------
// Delete: UX + intended mutation path
// ---------------------------------------------------------------------------

test("each routine card exposes a Delete action that visually reads destructive", () => {
  assert.match(view, /className="progress-ghost danger" type="button"[^>]*onClick=\{\(\) => \{ setConfirmingId\(routine\.id\); setEditingId\(null\); \}\}>\{t\.delete\}<\/button>/, "Delete arms confirmation (never deletes directly) and uses the danger style");
});

test("delete requires an explicit confirmation with the localized title, body, Cancel and confirm actions", () => {
  const confirmBlock = view.slice(view.indexOf('className="progress-routine-confirm"'), view.indexOf("t.deleteRoutineConfirm}") + "t.deleteRoutineConfirm}".length);
  assert.ok(confirmBlock.includes("<strong>{t.deleteRoutineTitle}</strong>"), "confirmation title");
  assert.ok(confirmBlock.includes("<span>{t.deleteRoutineBody}</span>"), "confirmation body");
  assert.match(confirmBlock, /\{t\.cancel\}<\/button>/, "Cancel dismisses");
  assert.match(confirmBlock, /onClick=\{\(\) => void remove\(routine\)\}/, "confirm button calls the delete handler");
  assert.equal((view.match(/void remove\(routine\)/g) ?? []).length, 1, "the destructive mutation is reachable only from the confirmation button");
});

test("delete flows through the owner-scoped DELETE endpoint and clears the card from the list", () => {
  const removeFn = slice(view, "async function remove(", "async function create(");
  assert.match(removeFn, /method: "DELETE"/, "delete uses DELETE");
  assert.match(removeFn, /`\/api\/progress\/routines\/\$\{routine\.id\}`/, "DELETE targets the routine id endpoint");
  assert.match(removeFn, /setRoutines\(\(current\) => current\.filter\(\(item\) => item\.id !== routine\.id\)\)/, "the deleted routine is removed from the list");
  const del = tail(routeId, "export async function DELETE");
  assert.match(del, /deleteRoutine\(guarded\.ownerId, routineId\)/, "DELETE resolves the owner server-side");
  assert.match(del, /if \(!deleted\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\);\s*return Response\.json\(\{ ok: true \}\);/, "DELETE reports 404 when nothing was owned, ok otherwise");
});

test("routine exercise prescriptions are removed by the schema cascade on routine delete", () => {
  const exercisesTable = slice(schema, "export const trainingRoutineExercises = pgTable", "export const trainingWorkoutSessions");
  assert.match(exercisesTable, /routineId: integer\("routine_id"\)\.notNull\(\)\.references\(\(\) => trainingRoutines\.id, \{ onDelete: "cascade" \}\)/, "deleting a routine cascades to its exercise prescriptions");
});

test("historical workout sessions survive a routine delete via schema SET NULL", () => {
  const sessionsTable = slice(schema, "export const trainingWorkoutSessions = pgTable", "export const mealPlanAssignments");
  assert.match(sessionsTable, /routineId: integer\("routine_id"\)\.references\(\(\) => trainingRoutines\.id, \{ onDelete: "set null" \}\)/, "workout sessions keep their rows and drop only the routine reference");
  assert.doesNotMatch(sessionsTable, /onDelete: "cascade"/, "workout history is never cascade-deleted");
});

// ---------------------------------------------------------------------------
// Security / data integrity
// ---------------------------------------------------------------------------

test("edit and delete never trust a client-supplied ownerId", () => {
  assert.doesNotMatch(routeId, /body\.ownerId/, "no ownerId is read from the request body");
  assert.match(routeId, /requireProgressApiOwner/, "the owner is resolved server-side from the authenticated session");
  const put = slice(routeId, "export async function PUT", "export async function DELETE");
  assert.match(put, /updateRoutineMeta\(guarded\.ownerId, routineId, name,/, "edit filters by the authenticated owner");
  const del = tail(routeId, "export async function DELETE");
  assert.match(del, /deleteRoutine\(guarded\.ownerId, routineId\)/, "delete filters by the authenticated owner");
  const updateMeta = slice(service, "export async function updateRoutineMeta", "export async function deleteRoutine");
  assert.match(updateMeta, /eq\(trainingRoutines\.id, routineId\), eq\(trainingRoutines\.ownerId, ownerId\)\)/, "rename WHERE is owner-scoped");
  const deleteFn = slice(service, "export async function deleteRoutine", "export async function addRoutineExercise");
  assert.match(deleteFn, /eq\(trainingRoutines\.id, routineId\), eq\(trainingRoutines\.ownerId, ownerId\)\)/, "delete WHERE is owner-scoped");
});

test("nonexistent or foreign routines fail safe with 404 on edit and delete", () => {
  assert.match(routeId, /Number\.isInteger\(routineId\)\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\);/, "non-numeric ids return 404 before any query");
  const put = slice(routeId, "export async function PUT", "export async function DELETE");
  assert.match(put, /if \(!result\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\);/, "PUT 404s when no owned routine matches");
  const del = tail(routeId, "export async function DELETE");
  assert.match(del, /if \(!deleted\) return Response\.json\(\{ error: "Routine not found\." \}, \{ status: 404 \}\);/, "DELETE 404s when no owned routine matches");
});

test("failure surfaces through the page error alert (user-visible error state)", () => {
  assert.match(view, /<p className="progress-error" role="alert">\{error\}<\/p>/, "existing accessible error region");
  const saveEdit = slice(view, "async function saveEdit(", "async function remove(");
  const removeFn = slice(view, "async function remove(", "async function create(");
  assert.match(saveEdit, /setError\(issue instanceof Error \? issue\.message : t\.error\)/, "rename failures reach the page alert");
  assert.match(removeFn, /setError\(issue instanceof Error \? issue\.message : t\.error\)/, "delete failures reach the page alert");
});

// ---------------------------------------------------------------------------
// Localization, RTL, mobile
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = ["edit", "cancel", "delete", "routineName", "routineNameRequired", "deleteRoutineTitle", "deleteRoutineBody", "deleteRoutineConfirm"] as const;

test("edit/delete copy exists in FR, EN and AR with natural translations", () => {
  for (const key of REQUIRED_KEYS) {
    assert.equal((text.match(new RegExp(`${key}: `, "g")) ?? []).length, 3, `key '${key}' present in all three locales`);
  }
  assert.ok(text.includes('edit: "Edit"'), "EN Edit");
  assert.ok(text.includes('cancel: "Cancel"'), "EN Cancel");
  assert.ok(text.includes('delete: "Delete"'), "EN Delete");
  assert.ok(text.includes('routineNameRequired: "Give the routine a name."'), "EN empty-name error");
  assert.ok(text.includes('deleteRoutineTitle: "Delete routine?"'), "EN confirmation title");
  assert.ok(text.includes("deleteRoutineBody: \"This removes the routine template. Your completed workout history will remain.\""), "EN confirmation body");
  assert.ok(text.includes('deleteRoutineConfirm: "Delete routine"'), "EN confirm button");
  assert.ok(text.includes('edit: "Modifier"'), "FR Edit");
  assert.ok(text.includes('cancel: "Annuler"'), "FR Cancel");
  assert.ok(text.includes('delete: "Supprimer"'), "FR Delete");
  assert.ok(text.includes('deleteRoutineTitle: "Supprimer cette routine ?"'), "FR confirmation title");
  assert.ok(text.includes('edit: "تعديل"'), "AR Edit");
  assert.ok(text.includes('cancel: "إلغاء"'), "AR Cancel");
  assert.ok(text.includes('delete: "حذف"'), "AR Delete");
  assert.ok(text.includes('deleteRoutineTitle: "حذف هذا الروتين؟"'), "AR confirmation title");
});

test("the routine list UI draws all actions from the dictionary (no hardcoded English labels)", () => {
  assert.doesNotMatch(view, />Edit<|>Delete<|>Delete routine<|>Delete routine\?<|>Save</, "actions use t.* labels only");
  assert.match(view, /\{t\.edit\}/, "Edit label localized");
  assert.match(view, /\{t\.delete\}/, "Delete label localized");
  assert.match(view, /:\s*t\.deleteRoutineConfirm\}/, "confirm label localized");
});

test("no U+2014 em dash anywhere in the edited files", () => {
  for (const [name, src] of [["RoutinesView.tsx", view], ["progress-text.ts", text], ["progress.css", css], ["route.ts", routeId]] as const) {
    assert.ok(!src.includes("\u2014"), `${name} contains a forbidden U+2014 em dash`);
  }
});

test("actions are plain flex layouts so Arabic RTL mirrors them (shell sets dir per locale)", () => {
  assert.match(shell, /dir=\{rtl \? "rtl" : "ltr"\}/, "Progress shell toggles dir for Arabic");
  const routineCss = slice(css, ".progress-routine-card{", ".progress-routine-head");
  assert.doesNotMatch(routineCss, /left:|right:|float:|position:absolute/, "card/actions layout is directional-free flex (auto-mirrors under RTL)");
});

test("mobile actions stay usable and cannot overflow horizontally", () => {
  const mobile = tail(css, "@media(max-width:520px){");
  assert.match(mobile, /\.progress-routine-card\{flex-wrap:wrap\}/, "card wraps on small screens");
  assert.match(mobile, /\.progress-routine-card-actions\{width:100%;justify-content:flex-end\}/, "actions take their own full row");
  assert.match(mobile, /\.progress-routine-card-actions \.progress-ghost\{flex:1;padding:12px 10px\}/, "touch-sized full-width buttons");
  assert.match(css, /\.progress-routine-card-main\{[^}]*min-width:0/, "card main content can shrink so nothing forces overflow");
});
