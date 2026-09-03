import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const panel = readFileSync(join(ROOT, "app", "progress", "(product)", "routines", "[id]", "AddExercisePanel.tsx"), "utf8");
const detail = readFileSync(join(ROOT, "app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx"), "utf8");
const text = readFileSync(join(ROOT, "app", "progress", "(product)", "progress-text.ts"), "utf8");

// ---------------------------------------------------------------------------
// Catalogue instant add: tapping a result IS the add action
// ---------------------------------------------------------------------------

test("a catalogue result tap calls the add draft directly, with no intermediate selection step", () => {
  assert.match(panel, /onClick=\{\(\) => quickAdd\(exercise\)\}/, "tapping a result row fires the instant add");
  assert.match(panel, /function quickAdd\(exercise: ExerciseDefinition\)/, "quick add is a first-class handler");
  assert.doesNotMatch(panel, /setSelected|setQuery\(e\.name\)/, "no select-then-confirm intermediate state remains");
});

test("instant add uses the product defaults (3 sets, 8-12 reps, RIR 2, kg)", () => {
  assert.match(panel, /CATALOGUE_ADD_DEFAULTS = \{ sets: 3, targetRepMin: 8, targetRepMax: 12, targetRir: 2, weightUnit: "kg" as const \}/, "shared default prescription constant");
  const quick = panel.slice(panel.indexOf("function quickAdd("), panel.indexOf("function addCustom("));
  assert.match(quick, /\.\.\.CATALOGUE_ADD_DEFAULTS/, "catalogue payload spreads the defaults automatically");
});

test("instant add carries the catalogue identity and names into the existing exercise POST payload", () => {
  const quick = panel.slice(panel.indexOf("function quickAdd("), panel.indexOf("function addCustom("));
  assert.match(quick, /exerciseId: exercise\.id/, "catalogue id preserved");
  assert.match(quick, /name: exercise\.name,\s*nameFr: exercise\.nameFr,\s*nameAr: exercise\.nameAr/, "EN/FR/AR name snapshots sent");
  assert.match(quick, /language: lang/, "picker language forwarded to the server");
});

// ---------------------------------------------------------------------------
// Rapid multi-add: panel stays open, query clears, focus returns
// ---------------------------------------------------------------------------

test("a successful instant add keeps the picker open, clears the search and refocuses it", () => {
  const success = panel.slice(panel.indexOf("function quickAdd("), panel.indexOf("function addCustom("));
  assert.match(success, /setQuery\(""\)/, "query cleared for the next search");
  assert.match(success, /setAddedName\(exerciseDisplayName\(exercise, lang\)\)/, "subtle confirmation feedback set");
  assert.match(success, /searchRef\.current\?\.focus\(\)/, "search input refocused for rapid multi-add");
  assert.doesNotMatch(success, /onClose\(/, "success never closes the picker (rapid multi-add)");
  assert.doesNotMatch(success, /setQuery\(""\).*onClose/, "query reset is not followed by closing the panel");
});

test("the transient confirmation never bleeds into the next search", () => {
  assert.match(panel, /window\.setTimeout\(\(\) => setAddedName\(""\), 1600\)/, "feedback auto-clears");
});

// ---------------------------------------------------------------------------
// Double-tap protection
// ---------------------------------------------------------------------------

test("duplicate creation requests are impossible while one add is in flight", () => {
  assert.match(panel, /inFlightRef\.current\) return Promise\.resolve\(\);\s*inFlightRef\.current = true;/, "synchronous ref guard short-circuits a second submit in the same tick");
  assert.match(panel, /finally\(\(\) => \{ inFlightRef\.current = false; setPending\(false\);/, "in-flight flag always restored");
  assert.match(panel, /disabled=\{pending\}/, "result rows are disabled while pending");
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

test("a failed add keeps the search usable, shows no phantom row and surfaces localized copy", () => {
  const failure = panel.slice(panel.indexOf("function quickAdd("), panel.indexOf("function addCustom("));
  const catchBlock = failure.slice(failure.indexOf(".catch("), failure.indexOf("function addCustom("));
  assert.match(catchBlock, /searchRef\.current\?\.focus\(\)/, "user can retry immediately");
  assert.doesNotMatch(catchBlock, /setQuery\(""\)/, "failed add never clears the query the user typed");
  assert.match(panel, /messageOf\(issue\) \|\| t\.error/, "server message shown when useful, localized generic otherwise");
  assert.doesNotMatch(panel, /setPanelError\("error"\)/, "literal \"error\" never rendered directly");
});

// ---------------------------------------------------------------------------
// Custom exercise progressive disclosure
// ---------------------------------------------------------------------------

test("the custom exercise form is hidden by default behind a disclosure control", () => {
  assert.match(panel, /const \[showCustom, setShowCustom\] = useState\(false\)/, "custom form starts closed");
  assert.match(panel, /!showCustom \? \(/, "disclosure row rendered while custom is closed");
  assert.match(panel, /setShowCustom\(true\)/, "Create custom exercise reveals the form");
  assert.match(panel, /progress-custom-form/, "custom form block present once revealed");
});

test("only the custom path shows the explicit configuration form + Add confirmation", () => {
  const customForm = panel.slice(panel.indexOf("progress-custom-form"), panel.indexOf("</div>\n  );\n}"));
  assert.match(customForm, /t\.workingSets/, "sets control in the custom form");
  assert.match(customForm, /t\.repRange/, "rep-range control in the custom form");
  assert.match(customForm, /t\.targetRir/, "RIR control in the custom form");
  assert.match(customForm, /disabled=\{pending \|\| !customName\.trim\(\)\} onClick=\{addCustom\}/, "custom Add confirmation only fires with a name");
});

// ---------------------------------------------------------------------------
// Keyboard + a11y + localized copy plumbing
// ---------------------------------------------------------------------------

test("the search field supports arrow navigation and Enter to add the highlighted result", () => {
  assert.match(panel, /event\.key === "ArrowDown"/, "ArrowDown moves the highlight");
  assert.match(panel, /event\.key === "ArrowUp"/, "ArrowUp moves the highlight");
  assert.match(panel, /event\.key === "Enter"\) \{ event\.preventDefault\(\); quickAdd\(matches\[highlighted\]\)/, "Enter adds the highlighted result");
  assert.match(panel, /event\.key === "Escape"\) \{ onClose\(\); return; \}/, "Escape closes the picker");
});

test("results and feedback carry real accessibility semantics", () => {
  assert.match(panel, /role="status"/, "confirmation announced politely");
  assert.match(panel, /role="alert"/, "errors announced as alerts");
  assert.match(panel, /aria-busy=\{pending\}/, "pending state communicated to assistive tech");
});

test("no hardcoded customer copy in the component: every label comes from the dictionary", () => {
  for (const key of ["searchCatalogue", "cantFind", "createCustom", "customExerciseName", "added", "moveToSection"]) {
    assert.match(panel, new RegExp(`t\\.${key}`, "g"), `copy key t.${key} referenced`);
  }
});

test("the new picker copy exists in FR, EN and AR with no leftover orCustom key", () => {
  for (const key of ["searchCatalogue", "cantFind", "createCustom", "customExerciseName", "customExercise", "added"]) {
    assert.equal((text.match(new RegExp(`${key}: `, "g")) ?? []).length, 3, `key '${key}' present in all three locales`);
  }
  assert.doesNotMatch(text, /orCustom: /, "the old always-visible custom field copy is gone");
});

// ---------------------------------------------------------------------------
// RoutineDetail wiring: same POST endpoint, confirmed-server-response cards
// ---------------------------------------------------------------------------

test("RoutineDetail mounts the shared panel against the existing exercise POST", () => {
  assert.match(detail, /import AddExercisePanel, \{ type AddExerciseDraft \} from "\.\/AddExercisePanel"/, "panel imported");
  assert.match(detail, /<AddExercisePanel/, "panel mounted when open");
  assert.match(detail, /onAdd=\{addDraft\}/, "panel posts through the routine's own draft handler");
  assert.match(detail, /defaultSectionId=\{sections\.length > 0 \? sections\[0\]\.id : null\}/, "first section (or ungrouped) is the default landing spot");
});

test("the draft handler uses the single existing routine-exercise POST and replaces the routine from the confirmed response", () => {
  const draft = detail.slice(detail.indexOf("async function addDraft("), detail.indexOf("async function removeExercise("));
  assert.match(draft, /`\/api\/progress\/routines\/\$\{routine\.id\}\/exercises`, \{ method: "POST"/, "one POST to the routine-exercise endpoint");
  assert.match(draft, /JSON\.stringify\(draft\)/, "panel draft serialized as-is");
  assert.match(draft, /setRoutine\(data\.routine\)/, "routine replaced from the server-confirmed response");
  assert.match(draft, /if \(!routine\) throw new Error\(t\.notFound\)/, "no routine => explicit failure, never a silent add");
  assert.equal((draft.match(/method: "POST"/g) ?? []).length, 1, "the addDraft handler owns exactly one POST (the exercise add)");
});

test("old form-filling catalogue UI is fully removed from RoutineDetail", () => {
  assert.doesNotMatch(detail, /exerciseSearchText|builtInExercises/, "matching moved into the catalogue search module");
  assert.doesNotMatch(detail, /setSelected|addSectionId|repMin|setRepMin|setRir|setUnit|setSaving/, "no leftover add-form configuration state");
  assert.doesNotMatch(detail, /progress-catalogue-results|progress-add-form/, "result list and config grid live only in the panel");
});
