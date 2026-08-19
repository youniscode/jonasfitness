import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  builtInExercises,
  exerciseDisplayName,
  exerciseSearchText,
  type ExerciseDefinition,
} from "../app/lib/exercise-catalogue.ts";
import { exerciseFromDefinition, programmeExercise } from "../app/lib/programme-builder.ts";
import { createExercises, parseExercises, programmeDays } from "../app/lib/workouts.ts";
import { buildExerciseHistory } from "../app/lib/exercise-history.ts";

const exercise = (overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition => ({
  id: "builtin-test",
  name: "Barbell bench press",
  nameFr: "Développé couché barre",
  nameAr: "ضغط الصدر بالبار",
  muscleGroup: "Chest",
  equipment: "Barbell",
  instructions: "",
  imageUrl: "",
  videoUrl: "",
  isCustom: false,
  ...overrides,
});

test("exerciseDisplayName resolves English, French and Arabic", () => {
  const item = exercise();
  assert.equal(exerciseDisplayName(item, "en"), "Barbell bench press");
  assert.equal(exerciseDisplayName(item, "fr"), "Développé couché barre");
  assert.equal(exerciseDisplayName(item, "ar"), "ضغط الصدر بالبار");
  // Unknown language falls back to English.
  assert.equal(exerciseDisplayName(item, "xx"), "Barbell bench press");
  assert.equal(exerciseDisplayName(item, null), "Barbell bench press");
  assert.equal(exerciseDisplayName(item, undefined), "Barbell bench press");
});

test("exerciseDisplayName falls back to English when translation is missing", () => {
  assert.equal(exerciseDisplayName(exercise({ nameFr: "" }), "fr"), "Barbell bench press");
  assert.equal(exerciseDisplayName(exercise({ nameAr: "" }), "ar"), "Barbell bench press");
  // Whitespace-only translations are treated as missing.
  assert.equal(exerciseDisplayName(exercise({ nameFr: "   " }), "fr"), "Barbell bench press");
});

test("exerciseDisplayName never returns an empty label", () => {
  assert.equal(exerciseDisplayName(exercise({ nameFr: "", nameAr: "" }), "fr"), "Barbell bench press");
  assert.equal(exerciseDisplayName(exercise({ nameFr: "", nameAr: "" }), "ar"), "Barbell bench press");
});

test("exerciseSearchText matches English, French and Arabic names", () => {
  const item = exercise();
  const text = exerciseSearchText(item);
  assert.ok(text.includes("barbell bench press"));
  assert.ok(text.includes("développé couché barre"));
  assert.ok(text.includes("ضغط الصدر بالبار"));
  assert.ok(text.includes("chest"));
});

test("all 88 built-ins have English, French and Arabic names", () => {
  assert.equal(builtInExercises.length, 88);
  for (const item of builtInExercises) {
    assert.ok(item.name.trim(), `missing English name for ${item.id}`);
    assert.ok(item.nameFr.trim(), `missing French name for ${item.name}`);
    assert.ok(item.nameAr.trim(), `missing Arabic name for ${item.name}`);
  }
});

test("all built-in exercise ids are unique", () => {
  const ids = builtInExercises.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate built-in id detected");
});

test("all built-in normalized English names are unique", () => {
  const normalized = builtInExercises.map((item) => item.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate built-in name detected");
});

test("old exercise records without translations still work via fallback", () => {
  const legacy = exercise({ nameFr: "", nameAr: "" });
  assert.equal(exerciseDisplayName(legacy, "fr"), "Barbell bench press");
  assert.equal(exerciseDisplayName(legacy, "ar"), "Barbell bench press");
});

test("exerciseFromDefinition carries FR/AR names into a programme exercise", () => {
  const prescription = exerciseFromDefinition(exercise());
  assert.equal(prescription.name, "Barbell bench press");
  assert.equal(prescription.nameFr, "Développé couché barre");
  assert.equal(prescription.nameAr, "ضغط الصدر بالبار");
});

test("programmeExercise preserves FR/AR names when parsing a saved programme", () => {
  const source = {
    id: "abc",
    libraryId: "builtin-test",
    name: "Barbell bench press",
    nameFr: "Développé couché barre",
    nameAr: "ضغط الصدر بالبار",
    muscleGroup: "Chest",
    equipment: "Barbell",
    sets: 3,
    reps: "8–12",
  };
  const parsed = programmeExercise(source);
  assert.equal(parsed.nameFr, "Développé couché barre");
  assert.equal(parsed.nameAr, "ضغط الصدر بالبار");
});

test("legacy string exercises default to empty FR/AR names without breaking", () => {
  const legacy = programmeExercise("Barbell bench press · 3×8 · RIR 2");
  assert.equal(legacy.name, "Barbell bench press");
  assert.equal(legacy.nameFr, "");
  assert.equal(legacy.nameAr, "");
});

test("programmeDays selects the translated client copy when one exists", () => {
  const content = JSON.stringify({
    title: "Build strength foundation",
    overview: "",
    sessions: [{ name: "Upper strength", focus: "Upper body", exercises: [{ id: "e1", libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", nameFr: "Développé couché barre", nameAr: "ضغط الصدر بالبار", muscleGroup: "Chest", equipment: "Barbell", instructions: "", imageUrl: "", videoUrl: "", sets: 3, reps: "8–12", rir: 2, restSeconds: 90, targetWeight: null, notes: "" }] }],
    translations: {
      fr: { title: "Base de force", overview: "", sessions: [{ name: "Force du haut du corps", focus: "Haut du corps", work: ["Développé couché barre"] }] },
    },
  });
  const days = programmeDays(content, "fr");
  assert.equal(days.length, 1);
  assert.equal(days[0].name, "Force du haut du corps");
  assert.equal(days[0].focus, "Haut du corps");
  // The translated work string wins over the canonical English object name.
  assert.equal(days[0].work[0].name, "Développé couché barre");
});

test("programmeDays falls back to the canonical copy when no translation exists", () => {
  const content = JSON.stringify({
    title: "Build strength foundation",
    overview: "",
    sessions: [{ name: "Upper strength", focus: "Upper body", exercises: [{ id: "e1", libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", nameFr: "Développé couché barre", nameAr: "ضغط الصدر بالبار", muscleGroup: "Chest", equipment: "Barbell", instructions: "", imageUrl: "", videoUrl: "", sets: 3, reps: "8–12", rir: 2, restSeconds: 90, targetWeight: null, notes: "" }] }],
  });
  const days = programmeDays(content, "fr");
  assert.equal(days.length, 1);
  assert.equal(days[0].name, "Upper strength");
  // The exercise object still carries nameFr so the workout UI can localize it.
  assert.equal(days[0].work[0].name, "Barbell bench press");
  assert.equal(days[0].work[0].nameFr, "Développé couché barre");
  assert.equal(days[0].work[0].nameAr, "ضغط الصدر بالبار");
});

test("programmeDays + createExercises carry FR/AR names through to a workout", () => {
  const content = JSON.stringify({
    title: "Push day",
    overview: "",
    sessions: [{
      name: "Session 1",
      focus: "Chest",
      exercises: [{
        id: "e1",
        libraryId: "builtin-barbell-bench-press",
        name: "Barbell bench press",
        nameFr: "Développé couché barre",
        nameAr: "ضغط الصدر بالبار",
        muscleGroup: "Chest",
        equipment: "Barbell",
        instructions: "",
        imageUrl: "",
        videoUrl: "",
        sets: 3,
        reps: "8–12",
        rir: 2,
        restSeconds: 90,
        targetWeight: null,
        notes: "",
      }],
    }],
  });
  const days = programmeDays(content, "en");
  assert.equal(days.length, 1);
  const workout = createExercises(days[0]);
  assert.equal(workout.length, 1);
  assert.equal(workout[0].nameFr, "Développé couché barre");
  assert.equal(workout[0].nameAr, "ضغط الصدر بالبار");
});

test("exercise history carries FR/AR names for localized display", () => {
  const history = buildExerciseHistory([{
    id: 1,
    title: "Push day",
    startedAt: "2024-01-01T08:00:00.000Z",
    completedAt: "2024-01-01T09:00:00.000Z",
    exercises: JSON.stringify([{
      id: "e1",
      programmeExerciseId: "pe1",
      libraryId: "builtin-test",
      name: "Barbell bench press",
      nameFr: "Développé couché barre",
      nameAr: "ضغط الصدر بالبار",
      target: "3×8",
      focus: "Chest",
      sets: [{ id: "s1", weight: 60, reps: 8, status: "completed" }],
    }]),
  }]);
  assert.equal(history.length, 1);
  assert.equal(history[0].name, "Barbell bench press");
  assert.equal(history[0].nameFr, "Développé couché barre");
  assert.equal(history[0].nameAr, "ضغط الصدر بالبار");
  assert.equal(exerciseDisplayName(history[0], "fr"), "Développé couché barre");
  assert.equal(exerciseDisplayName(history[0], "ar"), "ضغط الصدر بالبار");
});

test("parseExercises tolerates saved workouts without FR/AR names", () => {
  const exercises = parseExercises(JSON.stringify([{
    id: "e1",
    programmeExerciseId: "pe1",
    libraryId: "builtin-test",
    name: "Barbell bench press",
    target: "3×8",
    focus: "Chest",
    sets: [{ id: "s1", weight: 60, reps: 8, status: "completed" }],
  }]));
  assert.equal(exercises.length, 1);
  assert.equal(exercises[0].name, "Barbell bench press");
  assert.equal(exercises[0].nameFr, "");
  assert.equal(exercises[0].nameAr, "");
});

// ——— Phase 1C: real exercise images (78/78) ———

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function imageAssetPath(slug: string) {
  return join(projectRoot, "public", "exercises", `${slug}.webp`);
}

function isGenuineWebP(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

// Parses the canonical width/height straight from the WebP container header,
// so tests never depend on a native image decoder. Handles the three chunk
// layouts (VP8 lossy, VP8L lossless, VP8X extended).
function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (!isGenuineWebP(buffer)) return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    // Key-frame header: 3-byte start code at offset 20, then 4 bytes holding
    // the 14-bit width and height (little-endian).
    const width = (buffer[26] | ((buffer[27] & 0x3f) << 8)) & 0x3fff;
    const height = (buffer[28] | ((buffer[29] & 0x3f) << 8)) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    // 0x2f signature at offset 20, then 4 bytes encoding (width - 1) and
    // (height - 1) as 14 bits each.
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    const width = (b1 | ((b2 & 0x3f) << 8)) + 1;
    const height = (((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))) + 1;
    return { width, height };
  }
  if (chunk === "VP8X") {
    // Canvas size (minus 1) as three little-endian bytes each.
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

test("all 88 built-ins have non-empty imageUrl under /exercises/", () => {
  assert.equal(builtInExercises.length, 88);
  for (const item of builtInExercises) {
    const slug = item.id.slice("builtin-".length);
    assert.ok(item.imageUrl.startsWith("/exercises/"), `${item.name} should use the /exercises/ prefix`);
    assert.equal(item.imageUrl, `/exercises/${slug}.webp`, `${item.name} has the wrong image path`);
  }
});

test("all 88 referenced local assets exist", () => {
  for (const item of builtInExercises) {
    const slug = item.id.slice("builtin-".length);
    assert.ok(existsSync(imageAssetPath(slug)), `missing asset for ${slug}`);
  }
});

test("all 88 referenced files are genuine WebP (RIFF…WEBP)", () => {
  for (const item of builtInExercises) {
    const slug = item.id.slice("builtin-".length);
    const buffer = readFileSync(imageAssetPath(slug));
    assert.ok(isGenuineWebP(buffer), `${slug} is not a genuine WebP file`);
  }
});

test("all 88 referenced images are canonical 1448×1086 (4:3)", () => {
  for (const item of builtInExercises) {
    const slug = item.id.slice("builtin-".length);
    const dimensions = webpDimensions(readFileSync(imageAssetPath(slug)));
    assert.ok(dimensions, `${slug} has an unrecognised WebP header`);
    assert.equal(dimensions?.width, 1448, `${slug} width is not 1448`);
    assert.equal(dimensions?.height, 1086, `${slug} height is not 1086`);
  }
});

test("no two distinct built-ins share identical image content", () => {
  const byHash = new Map<string, string>();
  for (const item of builtInExercises) {
    const slug = item.id.slice("builtin-".length);
    const hash = createHash("sha256").update(readFileSync(imageAssetPath(slug))).digest("hex");
    const other = byHash.get(hash);
    assert.equal(other, undefined, `${item.name} duplicates the image of ${other ?? "?"} (${hash})`);
    byHash.set(hash, item.name);
  }
  assert.equal(byHash.size, builtInExercises.length, "expected one distinct image per built-in");
});

test("imageUrl propagates through programme helpers for every built-in", () => {
  for (const item of builtInExercises) {
    const prescription = exerciseFromDefinition(item);
    assert.equal(prescription.imageUrl, item.imageUrl, `${item.name} imageUrl dropped by exerciseFromDefinition`);
    const roundTripped = programmeExercise({ ...prescription });
    assert.equal(roundTripped.imageUrl, item.imageUrl, `${item.name} imageUrl dropped by programmeExercise`);
  }
});

test("imageUrl propagates through workout helpers for every built-in", () => {
  for (const item of builtInExercises) {
    const prescription = exerciseFromDefinition(item);
    const content = JSON.stringify({
      sessions: [{
        name: "Session 1",
        focus: item.muscleGroup,
        exercises: [prescription],
      }],
    });
    const days = programmeDays(content, "en");
    assert.equal(days.length, 1, `${item.name} produced no days`);
    const workout = createExercises(days[0]);
    assert.equal(workout[0].imageUrl, item.imageUrl, `${item.name} imageUrl dropped by createExercises`);
    const parsed = parseExercises(JSON.stringify(workout));
    assert.equal(parsed[0].imageUrl, item.imageUrl, `${item.name} imageUrl dropped by parseExercises`);
  }
});

test("legacy/custom exercises without imageUrl still work", () => {
  // Custom definitions keep their own (possibly empty) imageUrl.
  assert.equal(exerciseFromDefinition(exercise({ imageUrl: "" })).imageUrl, "");
  // Saved workout snapshots are not rehydrated; a missing image is safe.
  const parsed = parseExercises(JSON.stringify([{ id: "e1", name: "Barbell bench press", sets: [] }]));
  assert.equal(parsed[0].imageUrl, "");
});

test("legacy built-in string entries rehydrate imageUrl and libraryId from the catalogue", () => {
  const legacy = programmeExercise("Barbell bench press · 3×8 · RIR 2");
  assert.equal(legacy.libraryId, "builtin-barbell-bench-press");
  assert.equal(legacy.imageUrl, "/exercises/barbell-bench-press.webp");
  // Translations are not rehydrated for legacy entries; FR/AR keep falling back to English.
  assert.equal(legacy.nameFr, "");
  assert.equal(legacy.nameAr, "");
});

test("saved structured built-in entries missing imageUrl rehydrate by stable libraryId", () => {
  const parsed = programmeExercise({
    id: "abc",
    libraryId: "builtin-barbell-bench-press",
    name: "Barbell bench press",
    nameFr: "Développé couché barre",
    nameAr: "ضغط الصدر بالبار",
    muscleGroup: "Chest",
    equipment: "Barbell",
  });
  assert.equal(parsed.imageUrl, "/exercises/barbell-bench-press.webp");
  // EN/FR/AR fields remain intact after rehydration.
  assert.equal(parsed.name, "Barbell bench press");
  assert.equal(parsed.nameFr, "Développé couché barre");
  assert.equal(parsed.nameAr, "ضغط الصدر بالبار");
});

test("custom exercises keep the fallback illustration even with a built-in name", () => {
  // A custom id must never be rehydrated from the built-in catalogue by name.
  const custom = programmeExercise({ id: "abc", libraryId: "custom-7", name: "Barbell bench press" });
  assert.equal(custom.imageUrl, "");
  // An unrecognized legacy name has no reliable match and stays a fallback.
  assert.equal(programmeExercise("Made-up olympic lift · 3×8 · RIR 2").imageUrl, "");
});

test("imageUrl survives legacy string workout conversion", () => {
  const content = JSON.stringify({
    sessions: [{ name: "Session 1", focus: "Chest", work: ["Barbell bench press · 3×8 · RIR 2"] }],
  });
  const days = programmeDays(content, "en");
  assert.equal(days.length, 1);
  const workout = createExercises(days[0]);
  assert.equal(workout[0].imageUrl, "/exercises/barbell-bench-press.webp");
  assert.equal(workout[0].libraryId, "");
});
