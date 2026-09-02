import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const detail = read("app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx");
const sortable = read("app", "progress", "(product)", "routines", "[id]", "RoutineSortable.tsx");
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
// Native HTML5 drag is fully removed: no dataTransfer, no DOM drag events,
// no draggable attributes, no webkit user-drag priming, no payload parser.
// ---------------------------------------------------------------------------

test("native HTML5 drag plumbing is gone (no draggable/dataTransfer/drop handlers)", () => {
  for (const [name, src] of [["RoutineDetail.tsx", detail], ["RoutineSortable.tsx", sortable]] as const) {
    assert.doesNotMatch(src, /dataTransfer/, `${name} never reads or writes dataTransfer`);
    // DndContext's own onDragStart/onDragOver/onDragEnd props are dnd-kit's
    // callback API; only native DOM elements must never carry drag props.
    assert.doesNotMatch(src, /<(?:span|div|button|section|main|form|label)[^>]*\bon(DragStart|DragOver|DragLeave|Drop)=/, `${name} puts no native DOM drag event props on elements`);
    assert.doesNotMatch(src, /\bdraggable\s*=/, `${name} sets no HTML draggable attribute`);
    assert.doesNotMatch(src, /\bDragEvent\b/, `${name} imports no React DragEvent type`);
    assert.doesNotMatch(src, /parseDragPayload|activeDrag/, `${name} no longer parses transfer payloads`);
  }
  assert.doesNotMatch(css, /-webkit-user-drag/, "webkit drag priming removed from the stylesheet");
});

test("the pointer-based dnd-kit surface is wired as the only reorder path", () => {
  assert.match(sortable, /from "@dnd-kit\/core"/, "dnd-kit core imported");
  assert.match(sortable, /DndContext/, "DndContext present");
  assert.match(sortable, /\bPointerSensor\b/, "PointerSensor present");
  assert.match(sortable, /from "@dnd-kit\/sortable"/, "dnd-kit sortable imported");
  assert.match(sortable, /\buseSortable\b/, "section heads are real sortable items");
  assert.match(sortable, /\bSortableContext\b/, "SortableContext wraps the section list");
  assert.match(sortable, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 8 \} \}\)/, "8px activation distance so clicks never accidentally drag, deliberate moves do");
});

test("drop targeting prefers the droppable under the pointer and only then falls back to area intersection", () => {
  assert.match(sortable, /\bpointerWithin\b/, "pointer-precision collision strategy imported");
  assert.match(sortable, /\brectIntersection\b/, "area-intersection fallback present for pointer gaps");
  const collision = slice(sortable, "const collisionDetection: CollisionDetection", "// --- Placement operations");
  assert.match(collision, /droppableContainers\.filter\(\(container\) => container\.id !== args\.active\.id\)/, "the active dragged item is removed from collision candidates first");
  assert.match(collision, /pointerWithin\(\{ \.\.\.args, droppableContainers: candidates \}\)/, "pointer position decides the drop target among the remaining droppables");
  assert.match(collision, /rectIntersection\(\{ \.\.\.args, droppableContainers: candidates \}\)/, "area intersection fallback also excludes the dragged item");
  assert.match(sortable, /collisionDetection=\{collisionDetection\}/, "the strategy is wired into DndContext");
});

test("the actively dragged exercise can never collide with itself (self-exclusion never breaks other cards)", () => {
  const collision = slice(sortable, "const collisionDetection: CollisionDetection", "// --- Placement operations");
  assert.ok(collision.includes("container.id !== args.active.id"), "self is always filtered from the candidate set");
  assert.equal((collision.match(/droppableContainers: candidates/g) ?? []).length, 2, "both pointerWithin and the gap fallback run against the active-excluded candidates");
  // Every other card stays droppable: the cards still register their droppable
  // with the same id as their draggable and the collision set is what changes.
  assert.equal((sortable.match(/useDroppable\(\{ id: `ex:\$\{e\.id\}`, data: cardDropData \}\)/g) ?? []).length, 1, "card droppables remain registered for every exercise");
});

test("the final drop is resolved from the DragEndEvent, never from async visual state", () => {
  const end = slice(sortable, "function handleDragEnd", "function handleDragCancel");
  assert.doesNotMatch(end, /overTarget\b/, "handleDragEnd never reads the async visual state");
  assert.match(end, /setOverTarget\(null\)/, "it only clears the visual indicator");
  assert.match(end, /if \(!over\) return;/, "only a genuinely absent over means drop outside");
  assert.match(end, /if \(overId === String\(active\.id\)\) return;/, "a drop onto the dragged item itself is the only other no-op");
  assert.match(end, /overData\.zone === "card"/, "card drops derive from event.over data");
  assert.match(end, /overData\.zone === "head"/, "section header drops derive from event.over data");
  assert.match(end, /overData\.zone === "ungrouped"/, "ungrouped drops derive from event.over data");
  assert.match(end, /pointerRef\.current\.y < rect\.top \+ rect\.height \/ 2/, "before/after derives from the final pointer Y against the event.over rect");
  assert.ok(end.includes('dropOnExercise(activeIdNum, Number(overId.split(":")[1]), before)'), "card drop forwards the event-derived target id and half");
  assert.ok(end.includes("dropIntoSection(activeIdNum, overData.sectionId ?? null)"), "header drops forward the event-derived section");
});

test("visual overTarget state is separate from the commit path (feedback-only)", () => {
  const over = slice(sortable, "/** Visual only: records", "function handleDragMove");
  assert.match(over, /Visual only/, "handleDragOver is documented as visual-only");
  assert.ok(over.includes("setOverTarget({ id: String(over.id), zone: overData.zone, before, top, height })"), "the visual indicator is fed from event.over + live pointer");
  assert.doesNotMatch(over, /dropOnExercise|dropIntoSection|dropSectionOn|onApplyPlacements|onReorderSections/, "handleDragOver never persists anything");
  const move = slice(sortable, "function handleDragMove", "function handleDragEnd");
  assert.doesNotMatch(move, /onApplyPlacements|onReorderSections|dropOnExercise/, "drag-move refresh never persists anything");
});

test("the insertion half (before/after) tracks the live pointer on every drag move", () => {
  assert.match(sortable, /onPointerMove=\{\(event\) => \{ pointerRef\.current = \{ x: event\.clientX, y: event\.clientY \}; \}\}/, "the wrapper records every pointermove into a ref");
  assert.ok(sortable.includes("onDragMove={handleDragMove}"), "DndContext recomputes on every drag move");
  const move = slice(sortable, "function handleDragMove", "function handleDragEnd");
  assert.match(move, /setOverTarget\(\(current\) => \{/, "drag move refreshes the recorded drop target");
  assert.match(move, /pointerRef\.current\.y < current\.top \+ current\.height \/ 2/, "before/after derived from the live pointer against the target rect");
  assert.match(move, /before === current\.before \? current : \{ \.\.\.current, before \}/, "state only updates when the half actually flips");
});

// ---------------------------------------------------------------------------
// Handle-only drag initiation: the card is the transformed node, but only the
// handle receives listeners, so sets/rep/RIR/selects/buttons stay interactive.
// ---------------------------------------------------------------------------

test("exercise handles are usable 32-44px targets with grab/grabbing cursors and no text selection", () => {
  const rule = slice(css, ".progress-drag-handle{", "}\n.progress-drag-handle:hover");
  assert.ok(rule.includes("user-select:none"), "glyph cannot be selected while dragging");
  assert.doesNotMatch(rule, /-webkit-user-drag/, "no webkit drag priming on the handle");
  assert.ok(rule.includes("touch-action:none"), "pointer-drag does not hijack scrolling gestures");
  assert.ok(rule.includes("cursor:grab"), "grab cursor on the handle");
  const width = Number(/(?:^|;)width:(\d+)px/.exec(rule)?.[1]);
  const height = Number(/(?:^|;)height:(\d+)px/.exec(rule)?.[1]);
  assert.ok(width >= 32 && width <= 44, `handle width ${width}px is a usable 32-44px target`);
  assert.ok(height >= 32 && height <= 44, `handle height ${height}px is a usable 32-44px target`);
  assert.match(css, /\.progress-drag-handle\.progress-grabbing,\.progress-section-grip\.progress-grabbing\{cursor:grabbing\}/, "grabbing cursor only while an actual drag is in progress");
  assert.match(css, /\.progress-exercise-card\.progress-dragging,\.progress-section-head\.progress-dragging\{position:relative;z-index:10;box-shadow:0 12px 28px/, "the lifted node casts a shadow during a drag");
});

test("the card is the transformed node but listeners live only on the handle span", () => {
  assert.equal((sortable.match(/\{\.\.\.listeners\}/g) ?? []).length, 2, "listeners are bound only on the exercise handle and the section grip");
  const card = slice(sortable, "const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable", "const { setNodeRef: setDropNodeRef }");
  assert.match(card, /id: `ex:\$\{e\.id\}`/, "exercise draggable id is exercise-scoped");
  assert.match(card, /data: exerciseDragData/, "draggable kind metadata");
  assert.match(sortable, /ref=\{\(node\) => \{ setNodeRef\(node\); setDropNodeRef\(node\); \}\}/, "the card node carries both drag and drop refs");
  assert.doesNotMatch(sortable, /className=\{[\s\S]{0,120}?\.\.\.listeners[\s\S]{0,80}?progress-exercise-card/, "the card container itself never receives drag listeners");
  const handle = slice(sortable, "progress-drag-handle", "⠿</span>");
  assert.match(handle, /\{\.\.\.attributes\}/, "draggable attributes on the handle");
  assert.match(handle, /\{\.\.\.listeners\}/, "pointer listeners on the handle");
  assert.match(handle, /aria-label=\{`\$\{t\.move\} \$\{e\.name\}`\}/, "accessible handle label names the exercise");
  assert.match(handle, /onKeyDown=\{\(ev\) => \{[\s\S]{0,200}?ArrowUp[\s\S]{0,200}?ArrowDown/, "keyboard users can reorder straight from the focused handle");
});

test("section heads are sortable only via the grip and only when there is something to order", () => {
  const head = slice(sortable, "const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable", "const targeted = overTarget?.zone === \"head\"");
  assert.match(head, /id: `sec:\$\{section\.id\}`/, "section draggable id is section-scoped");
  assert.match(head, /zone: "head", sectionId: section\.id/, "the head is simultaneously a drop target for exercises");
  assert.match(head, /disabled: busy \|\| total < 2/, "a lone section cannot be dragged");
  const gripMarkup = slice(sortable, "className={`progress-section-grip", ">⠿</span>");
  assert.match(gripMarkup, /\{\.\.\.listeners\}/, "only the grip starts a section drag");
  assert.match(gripMarkup, /aria-label=\{`\$\{t\.move\} \$\{section\.name\}`\}/, "grip label names the section");
});

// ---------------------------------------------------------------------------
// Drop routing: cards, section heads and the ungrouped head are droppable;
// a drop next to a card of another section changes membership, never a
// same-section reorder (the previously reported cross-section bug).
// ---------------------------------------------------------------------------

test("every exercise card and the ungrouped head register as drop targets", () => {
  const cardDrop = slice(sortable, "const { setNodeRef: setDropNodeRef } = useDroppable", "const targeted = overTarget?.zone === \"card\"");
  assert.match(cardDrop, /id: `ex:\$\{e\.id\}`/, "each card is a droppable");
  assert.match(cardDrop, /data: cardDropData/, "card drop zone metadata");
  assert.match(sortable, /useDroppable\(\{ id: "ungrouped", data: ungroupedDropData \}\)/, "ungrouped header is a droppable");
  const over = slice(sortable, "/** Visual only: records", "function handleDragMove");
  assert.match(over, /overData\.zone !== "card" && overData\.zone !== "head" && overData\.zone !== "ungrouped"/, "all drop zones recognised in the visual tracker");
  assert.match(over, /String\(over\.id\) === String\(active\.id\)[\s\S]{0,80}?setOverTarget\(null\)/, "self-drops are ignored visually");
});

test("a drop next to an exercise in ANOTHER section is a membership move, not a same-section reorder", () => {
  const drop = slice(sortable, "function dropOnExercise", "function dropIntoSection");
  assert.ok(drop.includes("const targetSection = full[targetIndex].sectionId ?? null;"), "target section read from the destination exercise");
  assert.match(drop, /const sameSection = \(dragged\.sectionId \?\? null\) === targetSection;/, "same-section only when memberships match");
  assert.match(drop, /planMove\(routine, draggedId, sameSection \? "same" : targetSection, before \? targetIndex : targetIndex \+ 1\)/, "cross-section card drops pass the real section id into the planner");
});

test("header drops and ungrouped drops route through the shared placement planner", () => {
  assert.match(sortable, /function dropIntoSection\(draggedId: number, sectionId: number \| null\) \{[\s\S]{0,120}?planMove\(routine, draggedId, sectionId, null\)/, "header/ungrouped drops append to the target block end");
  assert.match(sortable, /function planSectionOrder\(sections: Section\[\], draggedId: number, targetId: number, before: boolean\)/, "sections share a rest-insert order engine");
  const plan = slice(sortable, "function planSectionOrder", "// --- Exercise card");
  assert.match(plan, /before \? targetRestIndex : targetRestIndex \+ 1/, "section before/after uses the same insert math as exercises");
  assert.match(sortable, /dropSectionOn\(activeIdNum, overData\.sectionId, before\)/, "section drags persist via the shared orderedIds path");
});

// ---------------------------------------------------------------------------
// Fallbacks + persistence + error handling (unchanged contract)
// ---------------------------------------------------------------------------

test("fallback controls (arrows, Move-to-section select, section arrows) remain intact and independent of drag", () => {
  assert.match(sortable, /aria-label=\{t\.moveUp\} disabled=\{index === 0\} onClick=\{\(\) => onMove\(e, -1\)\}/, "move-up fallback present");
  assert.match(sortable, /aria-label=\{t\.moveDown\} disabled=\{index === groupLength - 1\} onClick=\{\(\) => onMove\(e, 1\)\}/, "move-down fallback present");
  assert.match(sortable, /onChange=\{\(ev\) => onMoveToSection\(e, ev\.target\.value === "" \? null : Number\(ev\.target\.value\)\)\}/, "Move-to-section select reachable on touch/keyboard");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} ↑`\}/, "section arrow up present");
  assert.match(sortable, /aria-label=\{`\$\{t\.move\} ↓`\}/, "section arrow down present");
  assert.match(sortable, /keyboard users can reorder straight from the focused handle|onKeyDown=\{\(ev\) => \{[\s\S]{0,40}?ArrowUp/, "focused handles offer keyboard reordering");
});

test("reorder requests replace state only with the server layout and fail with the localized error", () => {
  const apply = slice(detail, "async function applyPlacements(", "async function reorderSections(");
  const beforeFetch = apply.slice(0, apply.indexOf("await json"));
  assert.ok(!beforeFetch.includes("setRoutine("), "no optimistic local reorder - the old layout stays visible until the server confirms");
  assert.match(apply, /setRoutine\(data\.routine\)/, "state is replaced by the confirmed server layout");
  assert.match(apply, /`\/api\/progress\/routines\/\$\{routine\.id\}\/exercises\/reorder`/, "persists through the secure reorder endpoint");
  assert.match(apply, /catch \{ setError\(t\.reorderError\); \}/, "failures show the localized safe message, never raw details");
  assert.match(detail, /body: JSON\.stringify\(\{ placements \}\)/, "the placements model is sent");
  const sectionOrder = slice(detail, "async function reorderSections(", "// --- Sections");
  assert.match(sectionOrder, /`\/api\/progress\/routines\/\$\{routine\.id\}\/sections\/reorder`/, "section order persists via its own secure endpoint");
  assert.match(sectionOrder, /catch \{ setError\(t\.sectionReorderError\); \}/, "section reorder failures show the localized message");
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
  const ordering = slice(sortable, "function moveExerciseInGroup", "// --- Section order");
  assert.ok(!ordering.includes("persistExercise"), "reordering cannot edit prescription data");
  assert.ok(!ordering.includes("removeExercise") && !ordering.includes("onRemove"), "reordering cannot remove exercises");
  assert.ok(!ordering.includes("/workouts"), "reordering cannot start or rewrite workout history");
  assert.ok(!ordering.includes("PATCH"), "reordering only reorders");
  assert.ok(exReorder.includes("placements"), "reorder API accepts the placements model");
  assert.ok(exReorder.includes("guarded.ownerId"), "reorder stays owner-scoped server-side");
});

// ---------------------------------------------------------------------------
// Visual contract: insertion indicator, resting rows, mobile, RTL, em dashes
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
  assert.match(slice(css, "/* Resting exercise rows", "}\n.progress-drag-handle{") + ".", /opacity:1/, "resting rows are fully opaque");
  const dragover = css.split("\n").find((line) => line.includes(".progress-exercise-card.dragover") && line.includes("{"));
  assert.ok(dragover && !/opacity|filter|color:/.test(dragover ?? ""), "dragover only highlights, never fades or recolors");
  assert.match(css, /\.progress-exercise-card\.progress-dragging,\.progress-section-head\.progress-dragging\{[^}]*box-shadow/, "lift state is a shadow, never a fade");
  assert.ok((css.match(/[\w-]+:disabled/g) ?? []).length >= 3, "dimming is scoped exclusively to :disabled controls");
});

test("mobile hides only the mouse handles and keeps every accessible fallback", () => {
  assert.match(tail820, /\.progress-section-grip,\.progress-drag-handle\{display:none\}/, "mouse-only drag affordances hidden below 820px");
  assert.ok(sortable.includes("aria-label={t.moveUp}"), "move up survives on touch");
  assert.ok(sortable.includes("aria-label={t.moveDown}"), "move down survives on touch");
  assert.match(tail820, /\.progress-exercise-actions \.progress-move-to-section\{flex:1;min-width:120px\}/, "Move-to-section broadens on touch");
});

test("drag CSS stays RTL-safe and the touched files stay free of U+2014", () => {
  const dragCss = slice(css, "/* Routine sections + drag-and-drop */", "/* Logger */");
  assert.doesNotMatch(dragCss, /\b(left|right|float):/, "no physical positioning in the drag layout");
  assert.match(dragCss, /margin-inline-start:auto/, "RTL-aware inline-end alignment retained");
  assert.ok(!dragCss.includes("\u2014"), "no U+2014 in the drag CSS");
  assert.ok(!detail.includes("\u2014") && !sortable.includes("\u2014") && !text.includes("\u2014"), "no U+2014 in the component or dictionary");
});