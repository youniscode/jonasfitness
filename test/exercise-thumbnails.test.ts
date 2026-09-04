/**
 * Exercise thumbnails (Add-Exercise picker, full legacy Coach coverage).
 *
 * Locks the contract:
 *   - getExerciseThumbnail is the ONLY interface the picker consumes
 *   - EVERY legacy Coach exercise (106) resolves a real thumbnail DERIVED from
 *     its own canonical imageUrl ("/exercises/<slug>.webp" ->
 *     "/exercises/thumbs/<slug>.webp") - no hand-maintained per-row manifest,
 *     so the mapping can never drift from the catalogue
 *   - Progress-only exercises (66) resolve ONLY through their explicit optional
 *     illustration set (5 in-house rows); the other 61 keep the fallback and
 *     are never treated as fully-imaged legacy exercises
 *   - resolved paths are local static assets that must exist on disk and be
 *     small (no remote URLs, no duplicate mapping, filename == exercise slug)
 *   - the legacy 106 Coach imageUrl/instructions payload stays untouched
 *   - graceful fallback: anything without an eligible path resolves to null
 *     and the UI renders its deterministic fallback tile
 *   - the result row keeps instant-add from the whole row and the tile is
 *     decorative, fixed-size and broken-image-safe
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  builtInExercises,
  coachCatalogueExercises,
  progressLifterExercises,
  type ExerciseDefinition,
} from "../app/lib/exercise-catalogue.ts";
import { getExerciseThumbnail } from "../app/lib/exercise-thumbnails.ts";

const ROOT = process.cwd();
const THUMB_DIR = join(ROOT, "public", "exercises", "thumbs");

const byId = new Map<string, ExerciseDefinition>(builtInExercises.map((exercise) => [exercise.id, exercise]));
const slugOf = (id: string) => id.replace(/^builtin-/, "");
const THUMB_RE = /^\/exercises\/thumbs\/[a-z0-9]+(-[a-z0-9]+)*\.webp$/;

// ---------- Full legacy Coach coverage (derivation, not a manifest) ----------

test("all 106 legacy Coach exercises resolve a real thumbnail derived from their own canonical imageUrl", () => {
  const coachThumbs = coachCatalogueExercises.map((exercise) => {
    const thumb = getExerciseThumbnail(exercise);
    assert.ok(thumb, `${exercise.id} must resolve a thumbnail (coach photo exists)`);
    assert.equal(thumb, `/exercises/thumbs/${slugOf(exercise.id)}.webp`, `${exercise.id} thumbnail derives from its canonical slug`);
    assert.match(thumb, THUMB_RE, `${exercise.id} thumbnail path format`);
    assert.doesNotMatch(thumb, /^https?:\/\//, `${exercise.id} must never use a remote image URL`);
    return thumb;
  });
  assert.equal(coachThumbs.length, 106, "every legacy coach row is covered");
  assert.equal(new Set(coachThumbs).size, 106, "derivation can never produce duplicate paths");
  // No legacy Coach row is left on the fallback: 0 unresolved coach exercises.
  const unresolved = coachCatalogueExercises.filter((exercise) => getExerciseThumbnail(exercise) === null);
  assert.deepEqual(unresolved, [], "every legacy coach exercise has a real thumbnail");
});

test("every resolved thumbnail file exists on disk and is a small webp", () => {
  const onDisk = new Set(readdirSync(THUMB_DIR).filter((f) => f.endsWith(".webp")));
  for (const exercise of [...coachCatalogueExercises, ...progressLifterExercises]) {
    const thumb = getExerciseThumbnail(exercise);
    if (!thumb) continue;
    const fileName = `${slugOf(exercise.id)}.webp`;
    assert.ok(onDisk.has(fileName), `missing thumbnail asset ${fileName} for ${exercise.id}`);
    const size = statSync(join(THUMB_DIR, fileName)).size;
    assert.ok(size > 0 && size < 60_000, `${fileName} must be a small thumbnail (< 60KB, got ${size})`);
  }
});

// ---------- Progress-only boundary (optional illustrations, else fallback) ----------

/** The explicit optional set: Progress-only rows WITHOUT a source photo that
 *  still carry an in-house illustration thumbnail. */
const OPTIONAL_PROGRESS_ONLY_IDS = [
  "builtin-decline-barbell-bench-press",
  "builtin-dumbbell-fly",
  "builtin-front-squat",
  "builtin-ez-bar-curl",
  "builtin-trap-bar-deadlift",
];

test("Progress-only exercises resolve only their explicit optional illustrations (61 keep the fallback)", () => {
  assert.equal(progressLifterExercises.length, 66);
  const resolved = progressLifterExercises.filter((exercise) => getExerciseThumbnail(exercise) !== null);
  assert.equal(resolved.length, OPTIONAL_PROGRESS_ONLY_IDS.length, "exactly the 5 optional rows resolve");
  assert.deepEqual(
    resolved.map((e) => e.id).sort(),
    [...OPTIONAL_PROGRESS_ONLY_IDS].sort(),
    "no other Progress-only row is treated as fully imaged",
  );
  for (const id of OPTIONAL_PROGRESS_ONLY_IDS) {
    const exercise = byId.get(id);
    assert.ok(exercise, `${id} exists`);
    assert.equal(getExerciseThumbnail(exercise), `/exercises/thumbs/${slugOf(id)}.webp`);
    // Optional thumbnails must never smuggle Coach payload onto Progress rows.
    assert.equal(exercise.imageUrl, "", `${id} optional thumbnail needs no coach imageUrl`);
    assert.equal(exercise.instructions, "", `${id} must not gain coach instruction copy`);
  }
});

// ---------- Graceful fallback semantics ----------

test("rows without an eligible path resolve to null (fallback), never a broken or remote path", () => {
  // A legacy Coach row that (hypothetically) lost its imageUrl must fall back
  // instead of pointing at a stale asset - the same for rehydrated snapshots.
  assert.equal(getExerciseThumbnail({ id: "builtin-pull-up", imageUrl: "" }), null);
  assert.equal(getExerciseThumbnail({ id: "builtin-pull-up" }), null);
  // Custom / unknown / Progress-only rows never resolve a derived asset.
  assert.equal(getExerciseThumbnail({ id: "custom-landmine-row", imageUrl: "" }), null);
  assert.equal(getExerciseThumbnail({ id: "builtin-pendlay-row", imageUrl: "" }), null);
  assert.equal(getExerciseThumbnail({ id: "unknown" }), null);
  // Remote URLs and thumb-to-thumb paths are never eligible sources.
  assert.equal(getExerciseThumbnail({ id: "x", imageUrl: "https://evil.example/a.webp" }), null);
  assert.equal(getExerciseThumbnail({ id: "x", imageUrl: "/exercises/thumbs/pull-up.webp" }), null);
  // A progress-only exercise outside the optional set falls back.
  assert.equal(getExerciseThumbnail(byId.get("builtin-pendlay-row") as ExerciseDefinition), null);
  assert.equal(getExerciseThumbnail(byId.get("builtin-kettlebell-swing") as ExerciseDefinition), null);
});

test("every file in the thumbs directory maps to a catalogue exercise (no orphans) and all 111 are accounted for", () => {
  const onDisk = readdirSync(THUMB_DIR).filter((f) => f.endsWith(".webp"));
  assert.equal(onDisk.length, 111, "106 coach derivatives + 5 optional illustrations");
  for (const fileName of onDisk) {
    const slug = fileName.replace(/\.webp$/, "");
    const exercise = byId.get(`builtin-${slug}`);
    assert.ok(exercise, `orphan thumbnail file ${fileName} has no catalogue exercise`);
    assert.ok(getExerciseThumbnail(exercise) !== null, `${fileName} resolves through getExerciseThumbnail`);
  }
  // No duplicate mapping keys possible: the derived map is keyed by unique ids,
  // and the optional set is the only explicit source.
  assert.equal(new Set(OPTIONAL_PROGRESS_ONLY_IDS).size, OPTIONAL_PROGRESS_ONLY_IDS.length);
});

// ---------- Legacy Coach invariants stay untouched ----------

test("the 106 Coach exercises keep their imageUrl + instructions payload exactly", () => {
  assert.equal(coachCatalogueExercises.length, 106, "legacy coach catalogue never grows or shrinks");
  for (const exercise of coachCatalogueExercises) {
    assert.ok(exercise.imageUrl.startsWith("/exercises/"), `${exercise.id} coach image path`);
    assert.equal(exercise.imageUrl, `/exercises/${slugOf(exercise.id)}.webp`, `${exercise.id} canonical image path unchanged`);
    assert.ok(exercise.instructions.trim().length > 0, `${exercise.id} coach instructions`);
  }
  assert.ok(byId.has("builtin-machine-chest-press"));
  assert.ok(byId.has("builtin-decline-machine-chest-press"));
});

test("Progress-only rows stay Progress-only (no image/instructions); composed catalogue is stable", () => {
  assert.equal(progressLifterExercises.length, 66);
  for (const exercise of progressLifterExercises) {
    assert.equal(exercise.imageUrl, "", `${exercise.id} must not require a coach image asset`);
    assert.equal(exercise.instructions, "", `${exercise.id} must not require coach instruction copy`);
  }
  assert.equal(builtInExercises.length, 172, "composed catalogue = 106 coach + 66 progress-only");
});

// ---------- Picker integration (instant add intact, tile decorative + safe) ----------

const panel = readFileSync(join(ROOT, "app", "progress", "(product)", "routines", "[id]", "AddExercisePanel.tsx"), "utf8");
const thumb = readFileSync(join(ROOT, "app", "progress", "(product)", "routines", "[id]", "ExerciseThumb.tsx"), "utf8");
const css = readFileSync(join(ROOT, "app", "progress", "progress.css"), "utf8");

test("the whole result row remains the one tap-to-add action (no second click, no thumbnail button)", () => {
  assert.ok(panel.includes("onClick={() => quickAdd(exercise)}"), "tapping the row still instant-adds");
  assert.doesNotMatch(thumb, /<button|role="button"|onClick/, "the thumbnail tile is never interactive");
  assert.doesNotMatch(thumb, /href=/, "the thumbnail is not a link");
});

test("thumbnail tile renders the image with alt=\"\" and reserves 48x48 before load", () => {
  assert.ok(panel.includes("<ExerciseThumb exercise={exercise} />"), "every catalogue row renders the shared tile");
  assert.ok(thumb.includes("getExerciseThumbnail(exercise)"), "the row consumes only the thumbnail interface");
  assert.ok(thumb.includes("exercise: ExerciseDefinition"), "the tile receives the full catalogue row (id, name, imageUrl)");
  assert.ok(thumb.includes('alt=""'), "decorative image is silent for screen readers");
  assert.ok(thumb.includes("width={48} height={48}"), "intrinsic size reserved - no layout shift");
  assert.ok(thumb.includes('loading="lazy"'), "image lazy-loads");
  assert.ok(thumb.includes("onError={() => setFailed(true)}"), "broken/missing optional path swaps to the fallback");
  assert.match(css, /\.progress-exercise-thumb\{[^}]*width:48px[^}]*height:48px/, "CSS reserves the fixed tile box");
});

test("fallback tile is deterministic movement line-art, never an empty or broken box", () => {
  assert.ok(thumb.includes("movementVariantFor(exercise.name)"), "fallback figure derives from the movement family");
  assert.ok(thumb.includes('aria-hidden="true"'), "fallback tile is decorative only");
  assert.ok(thumb.includes('className="progress-exercise-thumb progress-exercise-thumb-fallback"'), "no-image rows render the fallback tile");
  assert.doesNotMatch(thumb, />image unavailable<|>no image</i, "no noisy unavailable text is rendered in rows");
  assert.match(css, /\.progress-exercise-thumb-fallback/, "fallback tile has its own visual treatment");
});

test("no U+2014 and no hardcoded left/right in the new tile code", () => {
  assert.doesNotMatch(panel + thumb, /\u2014/, "no em dash in the picker code");
  assert.doesNotMatch(thumb, /left:|right:|margin-left|margin-right/, "tile layout is logical (RTL-safe by flexbox)");
});

test("thumbnail generation is reproducible and committed (asset provenance script)", () => {
  assert.ok(existsSync(join(ROOT, "scripts", "generate-exercise-thumbs.mjs")), "asset generator is committed for provenance");
});
