import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const PANEL = "app/progress/(product)/bodyweight/BodyweightPanel.tsx";
const CSS = "app/progress/progress.css";

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// ---------- Zero-entry state reuses the single add form ----------

test("zero-entry state shows the empty message followed immediately by the shared add form", () => {
  const source = read(PANEL);
  // The empty branch composes the copy card and the shared panel inside the
  // new wrapper, so the first measurement can be added without scrolling to a
  // second, disconnected form.
  assert.ok(source.includes('<div className="progress-bw-empty">'), "zero-entry wrapper class exists");
  assert.ok(source.includes('<div className="progress-empty"><strong>{t.noEntries}</strong><span>{t.noEntriesHint}</span></div>'), "empty copy card is unchanged");
  assert.equal(count(source, "{addEntryPanel}"), 2, "the shared add panel is rendered in BOTH the zero-entry and the populated branches");
});

test("the add-entry form is ONE implementation, not duplicated for the empty state", () => {
  const source = read(PANEL);
  assert.equal(count(source, 'className="progress-bw-form"'), 1, "add fields exist exactly once in source");
  assert.equal(count(source, 'className="progress-bw-unit"'), 1, "unit toggle exists exactly once in source");
  assert.equal(count(source, 'className="progress-bw-edit"'), 1, "the edit path is a separate markup (populated only)");
  // One submit handler drives whichever branch is on screen - no second form
  // implementation, no duplicated validation for the empty state.
  assert.equal(count(source, "void submit()"), 1, "the add submission is wired exactly once");
});

test("populated bodyweight architecture is untouched", () => {
  const source = read(PANEL);
  for (const marker of ["progress-bw-latest", "progress-chart", "progress-bw-list", "progress-bw-row", "progress-bw-confirm", "progress-bw-delta"]) {
    assert.ok(source.includes(marker), `populated marker ${marker} still present`);
  }
  assert.ok(source.includes("readStoredBodyweightUnit"), "local unit preference seeding preserved");
  assert.ok(source.includes("persistBodyweightUnit"), "local unit preference persistence preserved");
});

// ---------- No giant fixed-height / spacer behavior ----------

test("zero-entry CSS uses natural document flow only: no min-height, no height, no spacer", () => {
  const css = read(CSS);
  const lines = css.split("\n").filter((line) => line.includes("progress-bw-empty"));
  assert.ok(lines.length >= 2, "wrapper + inner-empty rules exist");
  for (const line of lines) {
    assert.ok(!line.includes("min-height") && !line.includes("height:"), `rule introduces forced sizing: ${line.trim()}`);
    assert.ok(!line.includes("margin-top:100px") && !line.includes("padding:100px"), `rule inflates dead space: ${line.trim()}`);
  }
  assert.ok(lines[0].includes(".progress-bw-empty{display:grid;gap:12px;margin-top:4px}"), "wrapper rule is the compact grid composition");
  assert.ok(lines.some((line) => line.includes(".progress-bw-empty .progress-empty{margin-top:0;padding:24px 18px}")), "empty card is tightened inside the wrapper");
  assert.ok(!css.includes(".progress-bw-empty .progress-empty{min-height"), "no forced card height for the zero-entry state");
});

test("empty-state copy stays exactly as approved in FR/EN/AR", () => {
  const text = read("app/progress/(product)/progress-text.ts");
  assert.ok(text.includes('noEntries: "No measurements yet."'));
  assert.ok(text.includes('noEntriesHint: "Add your first measurement to start your bodyweight history."'));
  assert.ok(text.includes('noEntries: "Aucun relevé pour le moment."'));
  assert.ok(text.includes('noEntriesHint: "Ajoutez votre premier relevé pour démarrer votre historique de poids."'));
  assert.ok(text.includes('noEntries: "لا توجد قياسات بعد."'));
  assert.ok(text.includes('noEntriesHint: "أضف أول قياس لبدء سجل وزنك."'));
});

test("bodyweight files stay free of U+2014 em dashes", () => {
  for (const file of [PANEL, CSS]) {
    assert.ok(!read(file).includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});
