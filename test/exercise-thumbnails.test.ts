/**
 * Exercise thumbnails (Add-Exercise picker pilot).
 *
 * Locks the v0.1 contract:
 *   - getExerciseThumbnail is the ONLY interface the picker consumes
 *   - a small static pilot map resolves ~18 exercises to local webp files
 *   - every other exercise resolves to null and the UI renders its fallback
 *   - the legacy 106 Coach exercises keep their imageUrl/instructions payload
 *     untouched and the 66 Progress-only rows stay free of Coach metadata
 *   - pilot paths are local static assets that must exist on disk (no remote
 *     URLs, no duplicate keys, thumbnail filename == exercise slug)
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
import {
  EXERCISE_THUMBNAILS,
  EXERCISE_THUMBNAIL_IDS,
  getExerciseThumbnail,
} from "../app/lib/exercise-thumbnails.ts";

const ROOT = process.cwd();
const THUMB_DIR = join(ROOT, "public", "exercises", "thumbs");

const byId = new Map<string, ExerciseDefinition>(builtInExercises.map((exercise) => [exercise.id, exercise]));
const slugOf = (id: string) => id.replace(/^builtin-/, "");
const THUMB_RE = /^\/exercises\/thumbs\/[a-z0-9]+(-[a-z0-9]+)*\.webp$/;

// ---------- Pilot map hygiene ----------

test("thumbnail pilot: every key is a real catalogue exercise, keys are unique", () => {
  assert.ok(EXERCISE_THUMBNAIL_IDS.length >= 10 && EXERCISE_THUMBNAIL_IDS.length <= 20, `pilot band 10-20 (got ${EXERCISE_THUMBNAIL_IDS.length})`);
  assert.equal(new Set(EXERCISE_THUMBNAIL_IDS).size, EXERCISE_THUMBNAIL_IDS.length, "no duplicate thumbnail mapping keys");
  for (const id of EXERCISE_THUMBNAIL_IDS) {
    assert.ok(byId.has(id), `pilot key ${id} must exist in the built-in catalogue`);
  }
});

test("thumbnail pilot: values are local static webp paths under /exercises/thumbs/ (never remote)", () => {
  for (const [id, path] of Object.entries(EXERCISE_THUMBNAILS)) {
    assert.match(path, THUMB_RE, `${id} thumbnail path format`);
    assert.doesNotMatch(path, /^https?:\/\//, `${id} must never use a remote image URL`);
    assert.equal(path, `/exercises/thumbs/${slugOf(id)}.webp`, `${id} thumbnail filename must match its stable slug`);
  }
});

test("every pilot thumbnail file exists on disk and is a small webp", () => {
  const onDisk = new Set(readdirSync(THUMB_DIR));
  for (const id of EXERCISE_THUMBNAIL_IDS) {
    const fileName = `${slugOf(id)}.webp`;
    assert.ok(onDisk.has(fileName), `missing pilot asset ${fileName}`);
    const size = statSync(join(THUMB_DIR, fileName)).size;
    assert.ok(size > 0 && size < 60_000, `${fileName} must be a small thumbnail (< 60KB, got ${size})`);
  }
});

// ---------- Unified interface semantics ----------

test("getExerciseThumbnail resolves the pilot path for Coach and Progress-only exercises alike", () => {
  // Coach-integrated exercise with an existing photo (downscaled derivative).
  assert.equal(getExerciseThumbnail({ id: "builtin-barbell-bench-press" }), "/exercises/thumbs/barbell-bench-press.webp");
  // Progress-only exercise: pilot thumbnail carried WITHOUT any Coach payload
  // (its imageUrl stays empty - no coach image/instructions required).
  const decline = byId.get("builtin-decline-barbell-bench-press");
  assert.equal(decline?.imageUrl, "", "progress-only pilot rows carry no coach imageUrl");
  assert.equal(getExerciseThumbnail({ id: "builtin-decline-barbell-bench-press" }), "/exercises/thumbs/decline-barbell-bench-press.webp");
});

test("getExerciseThumbnail returns null (fallback) when no pilot entry exists", () => {
  // Coach exercise outside the pilot and Progress-only exercise outside the
  // pilot both resolve to the polished fallback.
  assert.equal(getExerciseThumbnail({ id: "builtin-cable-fly" }), null);
  assert.equal(getExerciseThumbnail({ id: "builtin-pendlay-row" }), null);
  // Custom/user exercises never resolve to a pilot asset.
  assert.equal(getExerciseThumbnail({ id: "custom-landmine-row" }), null);
  assert.equal(getExerciseThumbnail({ id: "unknown" }), null);
});

test("the pilot mixes Coach reuse and Progress-only rows without Coach metadata", () => {
  let coachCount = 0;
  let progressCount = 0;
  for (const id of EXERCISE_THUMBNAIL_IDS) {
    const exercise = byId.get(id);
    assert.ok(exercise, `pilot id ${id} not found`);
    if (exercise && exercise.imageUrl.startsWith("/exercises/")) coachCount += 1;
    else progressCount += 1;
  }
  assert.equal(coachCount, 14, "coach pilot entries reuse existing coach image metadata");
  assert.equal(progressCount, 4, "progress-only pilot entries need no coach imageUrl to carry a thumbnail");
  // The Progress-only pilot rows themselves carry no coach payload.
  for (const id of EXERCISE_THUMBNAIL_IDS) {
    const exercise = byId.get(id);
    if (exercise && !exercise.imageUrl) {
      assert.equal(exercise.instructions, "", `${id} must not gain coach instruction copy`);
    }
  }
});

// ---------- Legacy Coach invariants stay untouched ----------

test("the 106 Coach exercises keep their imageUrl + instructions payload exactly", () => {
  assert.equal(coachCatalogueExercises.length, 106, "legacy coach catalogue never grows or shrinks");
  for (const exercise of coachCatalogueExercises) {
    assert.ok(exercise.imageUrl.startsWith("/exercises/"), `${exercise.id} coach image path`);
    assert.ok(exercise.instructions.trim().length > 0, `${exercise.id} coach instructions`);
  }
  // No slug was renamed or removed, and no coach row was given a thumbs path.
  assert.ok(byId.has("builtin-machine-chest-press"));
  assert.ok(byId.has("builtin-decline-machine-chest-press"));
  for (const exercise of coachCatalogueExercises) {
    assert.equal(exercise.imageUrl, `/exercises/${slugOf(exercise.id)}.webp`, `${exercise.id} canonical image path unchanged`);
  }
});

test("Progress-only rows stay Progress-only (no image/instructions), optional thumbnails come from the pilot map", () => {
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
  assert.match(panel, /onClick=\{\(\) => quickAdd\(exercise\)\}/, "tapping the row still instant-adds");
  assert.doesNotMatch(thumb, /<button|role="button"|onClick/, "the thumbnail tile is never interactive");
  assert.doesNotMatch(thumb, /href=/, "the thumbnail is not a link");
});

test("thumbnail tile renders the image with alt=\"\" and reserves 48x48 before load", () => {
  assert.match(panel, /<ExerciseThumb exercise=\{exercise\} \/>/, "every catalogue row renders the shared tile");
  assert.match(thumb, /getExerciseThumbnail\(exercise\)/, "the row consumes only the thumbnail interface");
  assert.match(thumb, /alt=""/, "decorative image is silent for screen readers");
  assert.match(thumb, /width=\{48\} height=\{48\}/, "intrinsic size reserved - no layout shift");
  assert.match(thumb, /loading="lazy"/, "image lazy-loads");
  assert.match(thumb, /onError=\{\(\) => setFailed\(true\)\}/, "broken/missing optional path swaps to the fallback");
  assert.match(css, /\.progress-exercise-thumb\{[^}]*width:48px[^}]*height:48px/, "CSS reserves the fixed tile box");
});

test("fallback tile is deterministic movement line-art, never an empty or broken box", () => {
  assert.match(thumb, /movementVariantFor\(exercise\.name\)/, "fallback figure derives from the movement family");
  assert.match(thumb, /aria-hidden="true"/, "fallback tile is decorative only");
  assert.match(thumb, /return \(\s*<span className="progress-exercise-thumb progress-exercise-thumb-fallback"/, "no-image rows render the fallback tile");
  assert.doesNotMatch(thumb, />image unavailable<|>no image</i, "no noisy unavailable text is rendered in rows");
  assert.match(css, /\.progress-exercise-thumb-fallback/, "fallback tile has its own visual treatment");
});

test("no U+2014 and no hardcoded left/right in the new tile code", () => {
  assert.doesNotMatch(panel + thumb, /\u2014/, "no em dash in the picker code");
  assert.doesNotMatch(thumb, /left:|right:|margin-left|margin-right/, "tile layout is logical (RTL-safe by flexbox)");
  assert.ok(existsSync(join(ROOT, "scripts", "generate-exercise-thumbs.mjs")), "asset generator is committed for provenance");
});
