import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const css = read("app", "progress", "progress.css");
const detail = read("app", "progress", "(product)", "routines", "[id]", "RoutineDetail.tsx");
const lines = css.split("\n");

// ---------------------------------------------------------------------------
// Resting rows must never be faded
// ---------------------------------------------------------------------------

const ROW_TOKENS = [".progress-exercise-card", ".progress-exercise-main", ".progress-exercise-title"] as const;

test("normal exercise rows never receive reduced opacity (no ghost/disabled look)", () => {
  for (const token of ROW_TOKENS) {
    const relevant = lines.filter((line) => line.includes(token));
    assert.ok(relevant.length >= 1, `expected a rule mentioning ${token}`);
    for (const line of relevant) {
      const opacities = line.match(/opacity:\s*[^;}]+/g) ?? [];
      for (const opacity of opacities) {
        assert.match(opacity, /opacity:\s*1$/, `${token} must stay fully opaque: ${line.trim()}`);
      }
      assert.doesNotMatch(line, /filter:|grayscale\(|saturate\(|brightness\(|contrast\(|mix-blend/, `${token} must never be filtered/washed: ${line.trim()}`);
    }
  }
});

test("resting rows keep full ink text color", () => {
  const guard = lines.find((line) => line.includes(".progress-exercise-title") && line.includes("opacity:1"));
  assert.ok(guard, "an explicit full-opacity guard exists for the primary row wrappers");
  assert.match(guard ?? "", /color:var\(--ink\)/, "the guard also pins row text to full-contrast ink");
});

test("drag/drop affordances never dim the row they belong to", () => {
  const dragover = lines.find((line) => line.includes(".progress-exercise-card.dragover"));
  assert.ok(dragover, "dragover rule exists");
  assert.doesNotMatch(dragover ?? "", /opacity|filter|color:/, "dragover only highlights - it never fades or recolors the row");
  assert.match(dragover ?? "", /box-shadow/, "dragover highlight uses a shadow ring");
  const handle = lines.find((line) => line.includes(".progress-drag-handle{"));
  assert.ok(handle, "drag handle rule exists");
  assert.doesNotMatch(handle ?? "", /opacity|filter/, "the drag handle is subtle via color only, never opacity");
});

// ---------------------------------------------------------------------------
// Only genuinely disabled controls may look disabled
// ---------------------------------------------------------------------------

test("any reduced opacity in the Progress stylesheet is scoped to :disabled (or keyframes)", () => {
  for (const line of lines) {
    if (line.includes("@keyframes") || line.includes("keyframes")) continue;
    const opacities = line.match(/opacity:\s*[^;}]+/g) ?? [];
    for (const opacity of opacities) {
      if (opacity.trim() === "opacity:1") continue;
      assert.ok(line.includes(":disabled"), `opacity < 1 requires a :disabled selector: ${line.trim()}`);
    }
  }
});

test("enabled controls inside exercise rows have full-contrast dark text", () => {
  const actionButton = lines.find((line) => line.startsWith(".progress-exercise-actions button{"));
  assert.ok(actionButton, "row action button rule exists");
  assert.match(actionButton ?? "", /color:#151712/, "enabled action buttons use near-black text");
  assert.doesNotMatch(actionButton ?? "", /opacity/, "enabled action buttons are never translucent");
  const moveSelect = lines.find((line) => line.startsWith(".progress-move-to-section select{"));
  assert.match(moveSelect ?? "", /color:#151712/, "Move to section select text is full contrast");
  assert.doesNotMatch(moveSelect ?? "", /opacity/, "Move to section select is only dimmed when disabled");
  const editInputs = lines.find((line) => line.includes(".progress-exercise-edit input") && line.includes(".progress-exercise-edit select"));
  assert.ok(editInputs, "shared input/select rule covers the row edit controls");
  assert.match(editInputs ?? "", /color:#151712/, "sets/rep/RIR controls use dark text on white");
  assert.doesNotMatch(editInputs ?? "", /opacity/, "row edit controls are only dimmed when disabled");
});

test("boundary-disabled arrows and busy controls get an explicit disabled state", () => {
  assert.match(css, /\.progress-exercise-actions button:disabled\{opacity:\.35;cursor:default\}/, "disabled arrows clearly dim");
  assert.match(css, /\.progress-move-to-section select:disabled\{opacity:\.5;cursor:default\}/, "busy Move to section select clearly dims");
});

// ---------------------------------------------------------------------------
// Readable secondary text + row definition inside sections
// ---------------------------------------------------------------------------

test("secondary text (labels, prescription, move-to-section) is comfortably readable", () => {
  const labelRule = lines.find((line) => line.startsWith(".progress-exercise-edit label{"));
  assert.match(labelRule ?? "", /font-weight:700/, "SETS/REP RANGE/RIR labels are weighted for readability");
  assert.doesNotMatch(labelRule ?? "", /color:#71756b/, "labels no longer use the washed-out gray");
  const prescription = lines.find((line) => line.startsWith(".progress-exercise-prescription{"));
  assert.match(prescription ?? "", /color:#[0-9a-f]{6}/, "prescription summary keeps a readable darker olive");
  assert.match(prescription ?? "", /font-weight:700/, "prescription summary stays weighted");
  assert.doesNotMatch(prescription ?? "", /opacity/, "prescription summary is never faded");
  const moveLabel = lines.find((line) => line.startsWith(".progress-move-to-section{"));
  assert.match(moveLabel ?? "", /font-weight:700/, "Move to section label is weighted for readability");
  assert.doesNotMatch(moveLabel ?? "", /color:#71756b/, "Move to section label no longer uses the washed-out gray");
});

test("rows keep clear definition inside a section (not near-invisible separators)", () => {
  const insideSection = lines.find((line) => line.startsWith(".progress-section .progress-exercise-card{"));
  assert.ok(insideSection, "section rows have their own rule");
  assert.match(insideSection ?? "", /border-bottom:1px solid/, "rows inside a section are separated");
  assert.doesNotMatch(insideSection ?? "", /#ecece5/, "separators are no longer near-invisible");
  assert.doesNotMatch(insideSection ?? "", /opacity|filter/, "row separation never relies on fading");
});

test("no whole-file filter/grayscale effects in the Progress stylesheet", () => {
  assert.doesNotMatch(css, /filter:|grayscale\(|saturate\(/, "no filter anywhere in progress.css");
});

test("the resting card markup carries no opacity or blanket disabled attribute", () => {
  assert.doesNotMatch(detail, /className="progress-exercise-card"[^>]*(disabled|opacity)/, "card containers are never disabled/faded");
  assert.equal((detail.match(/aria-label=\{t\.moveUp\}/g) ?? []).length, 2, "move up controls exist per row region");
  assert.equal((detail.match(/aria-label=\{t\.moveDown\}/g) ?? []).length, 2, "move down controls exist per row region");
});

// ---------------------------------------------------------------------------
// Section headers: normal state must be inked and fully opaque
// ---------------------------------------------------------------------------

test("section headers carry explicit ink so inheritance can never wash them out", () => {
  const headRule = lines.find((line) => line.startsWith(".progress-section-head{"));
  assert.ok(headRule, "section head base rule exists");
  assert.match(headRule ?? "", /color:var\(--ink\)/, "section head pins normal text to ink");
  assert.doesNotMatch(headRule ?? "", /opacity|filter:|grayscale\(/, "section head normal state is never faded");
  const nameRule = lines.find((line) => line.startsWith(".progress-section-head>strong{"));
  assert.ok(nameRule, "section name rule exists");
  assert.match(nameRule ?? "", /color:var\(--ink\);opacity:1/, "section name is explicit dark ink at full opacity");
  assert.doesNotMatch(nameRule ?? "", /filter:|grayscale\(/, "section name is never filtered");
});

test("enabled section actions (rename/arrows/delete arm) are dark, opaque and not faded", () => {
  const enabled = lines.find((line) => line.includes(".progress-section-actions .progress-ghost:not(.danger):not(:disabled)"));
  assert.ok(enabled, "explicit enabled-ghost contrast rule exists");
  assert.match(enabled ?? "", /color:#151712;opacity:1/, "enabled section actions are dark and fully opaque");
  const dangerEnabled = lines.find((line) => line.includes(".progress-section-actions .progress-ghost.danger:not(:disabled)"));
  assert.ok(dangerEnabled, "danger action keeps an explicit opaque enabled state");
  assert.doesNotMatch(dangerEnabled ?? "", /color:/, "the danger enabled state never restyles the destructive color");
});

test("danger section actions keep their destructive red styling", () => {
  const danger = lines.find((line) => line.startsWith(".progress-ghost.danger{"));
  assert.ok(danger, "global danger ghost rule exists");
  assert.match(danger ?? "", /color:#a23830/, "Delete section stays red");
  assert.match(danger ?? "", /border-color:#e0b9b3/, "Delete section keeps its destructive border tint");
});

test("disabled section reorder arrows remain visibly disabled", () => {
  const dimmed = lines.find((line) => line.startsWith(".progress-ghost:disabled{"));
  assert.ok(dimmed, "generic disabled ghost dimming exists");
  assert.match(dimmed ?? "", /opacity:\.45;cursor:default/, "disabled section arrows still dim like every disabled ghost");
  for (const line of lines) {
    if (!line.includes(".progress-ghost")) continue;
    const hasEnabledSelector = line.includes(":not(:disabled)");
    const dimsDisabled = /:disabled\{[^}]*opacity:\./.test(line) || /:disabled,\s*$/.test(line);
    if (hasEnabledSelector) {
      assert.doesNotMatch(line, /:disabled\{[^}]*opacity:1/, "no enabled rule may force disabled ghosts to full opacity");
    }
    void dimsDisabled;
  }
});

test("section rename input and confirmation controls stay readable and destructive copy stays secondary", () => {
  const renameInput = lines.find((line) => line.startsWith(".progress-section-rename input{"));
  assert.match(renameInput ?? "", /color:#151712/, "rename input text is dark on white");
  assert.doesNotMatch(renameInput ?? "", /opacity/, "rename input is never faded");
  const confirmStrong = lines.find((line) => line.startsWith(".progress-section-confirm strong{"));
  assert.ok(confirmStrong, "confirm title rule exists");
  assert.doesNotMatch(confirmStrong ?? "", /opacity|filter:/, "confirm title is never faded");
});

test("the ungrouped header is a deliberate muted label, never a faded control", () => {
  const ungrouped = lines.find((line) => line.startsWith(".progress-ungrouped-head>strong{"));
  assert.ok(ungrouped, "ungrouped header rule exists");
  assert.match(ungrouped ?? "", /color:#[0-9a-f]{6}/, "ungrouped label has an explicit color");
  assert.doesNotMatch(ungrouped ?? "", /opacity|filter:/, "ungrouped label is not faded or filtered");
});

test("no U+2014 em dash in the touched stylesheet", () => {
  assert.ok(!css.includes("\u2014"), "progress.css contains a forbidden U+2014 em dash");
});
