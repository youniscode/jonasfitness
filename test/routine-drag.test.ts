import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const detail = read("app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx");
const text = read("app", "progress", "(product)", "progress-text.ts");
const css = read("app", "progress", "progress.css");
const exReorder = read("app", "api", "progress", "routines", "[id]", "exercises", "reorder", "route.ts");

function slice(src: string, from: string, to: string) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

const tail820 = slice(css, "@media(max-width:820px){", "@media(max-width:520px){");

// ---------------------------------------------------------------------------
// dragstart: usable state + payload (some engines refuse to start a drag with
// an empty dataTransfer, and the payload makes drops authoritative)
// ---------------------------------------------------------------------------

test("dragstart establishes the shared payload contract for exercises and sections", () => {
  assert.ok(detail.includes("function handleDragStart("), "a single shared drag starter exists");
  const starter = slice(detail, "function handleDragStart(", "// Inline-effect fetch");
  assert.ok(starter.includes('event.dataTransfer.effectAllowed = "move"'), "move effect allowed");
  assert.ok(starter.includes('event.dataTransfer.setData("text/plain", `${kind}:${id}`)'), "non-empty text/plain payload is set on every dragstart");
  assert.ok(starter.includes("setDragging({ kind, id })"), "React drag state still seeded for hover gate");
  const calls = (detail.match(/handleDragStart\(ev, "exercise", e\.id\)/g) ?? []).length;
  assert.equal(calls, 2, "both exercise handles (grouped and ungrouped rows) route through the starter");
  assert.ok(detail.includes('handleDragStart(e, "section", section.id)'), "section header drag routes through the starter");
});

test("drop handlers resolve the dragged item from the event payload with state as fallback", () => {
  assert.ok(detail.includes("function parseDragPayload("), "payload parser exists");
  assert.match(slice(detail, "function parseDragPayload(", "function activeDrag("), /\/\^\(section\|exercise\):\(\\d\+\)\$\//, "payload format is section|exercise:<id>");
  assert.ok(detail.includes("function activeDrag("), "payload-first resolver exists");
  const resolver = slice(detail, "function activeDrag(", "Sections in header order");
  assert.ok(resolver.includes('event.dataTransfer.getData("text/plain")'), "reads the authoritative dataTransfer payload");
  assert.ok(resolver.includes("return fallback;"), "falls back to React drag state when data is protected/unreadable");
  const payloadGates = (detail.match(/const payload = activeDrag\(/g) ?? []).length;
  assert.ok(payloadGates >= 4, "all drop sites (section head, ungrouped head, both card lists) resolve the payload");
});

// ---------------------------------------------------------------------------
// draggable target: only the handle is draggable, never the whole card
// ---------------------------------------------------------------------------

test("the drag handle is the only draggable element; cards stay interactive", () => {
  assert.equal((detail.match(/draggable\s*$/gm) ?? []).length, 2, "exactly the two exercise handle spans are draggable");
  assert.ok(detail.includes("draggable={sections.length > 1}"), "section headers are draggable only when there is something to order");
  const cardBranches = (detail.match(/className=\{dragOverId\?\.startsWith\(/g) ?? []).length;
  assert.equal(cardBranches, 2, "both card lists render through the drag-state className branch");
  assert.doesNotMatch(detail, /className=\{dragOverId\?\.startsWith\([\s\S]{0,400}?draggable/, "the card branch never makes the card itself draggable, so fields remain clickable");
});

test("the handle suppresses text selection and exposes grab cursors and a 32-44px target", () => {
  const rule = slice(css, ".progress-drag-handle{", "}\n.progress-drag-handle:hover");
  assert.ok(rule.includes("user-select:none"), "glyph cannot be selected while dragging");
  assert.ok(rule.includes("-webkit-user-drag:element"), "webkit drag priming present");
  assert.ok(rule.includes("touch-action:none"), "touch gesture does not hijack scrolling on the handle");
  assert.ok(rule.includes("cursor:grab"), "grab cursor on the handle");
  const width = Number(/(?:^|;)width:(\d+)px/.exec(rule)?.[1]);
  const height = Number(/(?:^|;)height:(\d+)px/.exec(rule)?.[1]);
  assert.ok(width >= 32 && width <= 44, `handle width ${width}px is a usable 32-44px target`);
  assert.ok(height >= 32 && height <= 44, `handle height ${height}px is a usable 32-44px target`);
  assert.match(slice(css, ".progress-drag-handle:active{", "}"), /cursor:grabbing/, "grabbing cursor while actively dragging");
  assert.match(slice(css, ".progress-drag-handle:hover{", "}"), /color:#10120e/, "hover darkens the handle so it reads as interactive");
});

// ---------------------------------------------------------------------------
// drop wiring: same-section insertion, cross-section membership, ungrouped
// ---------------------------------------------------------------------------

test("same-section drop computes before/after and funnels into the shared reorder path", () => {
  assert.match(detail, /void dropExercise\(payload\.id, e\.id, ev\.clientY < rect\.top \+ rect\.height \/ 2\)/, "drop classifies before/after by cursor position");
  const dropFn = slice(detail, "async function dropExercise(", "async function dropIntoSection(");
  assert.match(dropFn, /planMove\(routine, draggedId, "same", before \? targetIndex : targetIndex \+ 1\)/, "before/after maps to canonical insertion index");
  assert.ok(dropFn.includes("if (draggedId === targetExerciseId) return;"), "self-drop is a no-op");
  assert.ok(dropFn.includes("await applyPlacements("), "same-section drop persists through the shared placement endpoint");
});

test("cross-section and ungrouped drops move membership to the target block end", () => {
  assert.match(detail, /void dropIntoSection\(payload\.id, section\.id\)/, "dropping on a section header joins that section");
  assert.match(detail, /void dropIntoSection\(payload\.id, null\)/, "dropping on the ungrouped header ungroups the exercise");
  const dropInto = slice(detail, "async function dropIntoSection(", "// --- Sections");
  assert.match(dropInto, /planMove\(routine, draggedId, sectionId, null\)/, "membership change targets the chosen block end");
});

test("section drag-and-drop still flows through the same reorder endpoint as the arrows", () => {
  const dropSection = slice(detail, "async function dropSectionOn(", "async function startWorkout");
  assert.match(dropSection, /reordered\.splice\(/, "drag computes the same swapped ordering as the arrows");
  assert.match(dropSection, /`\/api\/progress\/routines\/\$\{routine\.id\}\/sections\/reorder`/, "section drag persists via the shared sections reorder endpoint");
  assert.match(slice(detail, "async function moveSection(", "async function dropSectionOn("), /`\/api\/progress\/routines\/\$\{routine\.id\}\/sections\/reorder`/, "arrow reorder uses the identical endpoint");
});

test("fallback controls (arrows + Move to section) remain intact and independent of drag", () => {
  assert.match(detail, /aria-label=\{t\.moveUp\} disabled=\{index === 0\} onClick=\{\(\) => void moveExerciseInGroup\(e, -1\)\}/, "move-up fallback present");
  assert.match(detail, /aria-label=\{t\.moveDown\} disabled=\{index === group\.length - 1\} onClick=\{\(\) => void moveExerciseInGroup\(e, 1\)\}/, "move-down fallback present");
  const moveGroup = slice(detail, "async function moveExerciseInGroup(", "async function moveExerciseToSection(");
  assert.ok(moveGroup.includes("await applyPlacements(planMove(routine, e.id, \"same\""), "arrows share the placement planner");
  assert.match(detail, /onChange=\{\(ev\) => void moveExerciseToSection\(e, ev\.target\.value === "" \? null : Number\(ev\.target\.value\)\)\}/, "Move-to-section select reachable on touch/keyboard");
});

// ---------------------------------------------------------------------------
// persistence + error handling: the server response is the only source of truth
// ---------------------------------------------------------------------------

test("reorder requests replace state only with the server layout and fail with the localized error", () => {
  const apply = slice(detail, "async function applyPlacements(", "async function moveExerciseInGroup(");
  const beforeFetch = apply.slice(0, apply.indexOf("await json"));
  assert.ok(!beforeFetch.includes("setRoutine("), "no optimistic local reorder - the old layout stays visible until the server confirms");
  assert.match(apply, /setRoutine\(data\.routine\)/, "state is replaced by the confirmed server layout");
  assert.match(apply, /`\/api\/progress\/routines\/\$\{routine\.id\}\/exercises\/reorder`/, "persists through the secure reorder endpoint");
  assert.match(apply, /catch \{ setError\(t\.reorderError\); \}/, "failures show the localized safe message, never raw details");
  assert.ok((detail.match(/exercises\/reorder/g) ?? []).length >= 1, "drag paths use the reorder endpoint");
  assert.match(detail, /body: JSON\.stringify\(\{ placements \}\)/, "the placements model is sent");
});

test("reorderError is localized in EN/FR/AR and never leaks server details", () => {
  const en = slice(text, "en: {", "fr: {");
  const fr = slice(text, "fr: {", "ar: {");
  const ar = slice(text, "ar: {", "} as const;");
  for (const locale of [en, fr, ar]) assert.match(locale, /reorderError:/, "reorder error key present in every locale");
  const values = [en, fr, ar].map((locale) => /reorderError: "([^"]+)"/.exec(locale)?.[1] ?? "");
  assert.equal(new Set(values).size, 3, "the three locales use distinct translations");
  assert.ok(values.every((value) => !/\b(SQL|database|constraint|violation|ingest)\b/i.test(value)), "copy never exposes database internals");
});

test("drag/drop never touches prescriptions, workouts or the exercise PATCH path", () => {
  const ordering = slice(detail, "// --- Ordering + section membership", "// --- Sections");
  assert.ok(!ordering.includes("persistExercise"), "reordering cannot edit prescription data");
  assert.ok(!ordering.includes("removeExercise"), "reordering cannot remove exercises");
  assert.ok(!ordering.includes("/workouts"), "reordering cannot start or rewrite workout history");
  assert.ok(!ordering.includes("PATCH"), "reordering only PUTs the reorder endpoint");
  assert.ok(exReorder.includes("placements"), "reorder API accepts the placements model");
  assert.ok(exReorder.includes("guarded.ownerId"), "reorder stays owner-scoped server-side");
});

// ---------------------------------------------------------------------------
// visual contract: insertion indicator, resting rows, mobile, RTL, em dashes
// ---------------------------------------------------------------------------

test("dragover keeps the row ring and adds a precise before/after insertion line", () => {
  const line = slice(css, ".progress-exercise-card.drop-before::before", "/* Resting exercise rows");
  assert.match(line, /content:""/, "insertion line is a styled pseudo-element, not content");
  assert.match(line, /inset-inline:0/, "line spans the full inline width using logical properties");
  assert.match(line, /background:var\(--lime\)/, "insertion uses the brand lime");
  assert.ok(line.includes("top:-2px") && line.includes("bottom:-2px"), "before/after bars sit above/below the hovered row");
  const ring = slice(css, ".progress-section-head.dragover", "}\n.progress-section-rename");
  assert.match(ring, /box-shadow:inset 0 0 0 2px var\(--lime\)/, "accepting targets keep the lime ring");
});

test("drag visuals never fade normal content and only disabled controls dim", () => {
  assert.match(slice(css, "/* Resting exercise rows", "}\n.progress-drag-handle{" ) + ".", /opacity:1/, "resting rows are fully opaque");
  const dragover = css.split("\n").find((line) => line.includes(".progress-exercise-card.dragover") && line.includes("{"));
  assert.ok(dragover && !/opacity|filter|color:/.test(dragover), "dragover only highlights, never fades or recolors");
  assert.ok((css.match(/[\w-]+:disabled/g) ?? []).length >= 3, "dimming is scoped exclusively to :disabled controls");
});

test("mobile hides only the mouse handles and keeps every accessible fallback", () => {
  assert.match(tail820, /\.progress-section-grip,\.progress-drag-handle\{display:none\}/, "mouse-only drag affordances hidden below 820px");
  assert.ok(detail.includes('aria-label={t.moveUp}'), "move up survives on touch");
  assert.ok(detail.includes('aria-label={t.moveDown}'), "move down survives on touch");
  assert.match(tail820, /\.progress-exercise-actions \.progress-move-to-section\{flex:1;min-width:120px\}/, "Move-to-section broadens on touch");
});

test("drag CSS stays RTL-safe and the touched files stay free of U+2014", () => {
  const dragCss = slice(css, "/* Routine sections + drag-and-drop */", "/* Logger */");
  assert.doesNotMatch(dragCss, /\b(left|right|float):/, "no physical positioning in the drag layout");
  assert.match(dragCss, /margin-inline-start:auto/, "RTL-aware inline-end alignment retained");
  assert.ok(!dragCss.includes("\u2014"), "no U+2014 in the drag CSS");
  assert.ok(!detail.includes("\u2014") && !text.includes("\u2014"), "no U+2014 in the component or dictionary");
});