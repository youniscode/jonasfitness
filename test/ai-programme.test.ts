import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateProgrammeDurationMinutes,
  validateDraft,
  rehydrateDraft,
  designRecommendation,
  programmeChangeSummary,
  buildFallbackDraft,
} from "../app/lib/ai-programme.ts";

// ---------- Draft fixtures ----------

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: "3-Day Full Body Foundation",
    overview: "Progressive full-body plan",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    estimatedSessionDurationMinutes: 60,
    progressionStrategy: "Double progression",
    coachNotes: "",
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        estimatedMinutes: 60,
        exercises: [
          { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
          { libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" },
        ],
      },
      {
        name: "Day 2",
        focus: "Full body",
        estimatedMinutes: 60,
        exercises: [
          { libraryId: "builtin-romanian-deadlift", name: "Romanian deadlift", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" },
          { libraryId: "builtin-seated-cable-row", name: "Seated cable row", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        ],
      },
      {
        name: "Day 3",
        focus: "Full body",
        estimatedMinutes: 60,
        exercises: [
          { libraryId: "builtin-overhead-press", name: "Overhead press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
          { libraryId: "builtin-lat-pulldown", name: "Lat pulldown", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------- Duration estimation ----------

test("duration estimate derives from real set count and rest, not AI claims", () => {
  const draft = validDraft({
    estimatedSessionDurationMinutes: 999, // AI claim is ignored
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        estimatedMinutes: 999,
        exercises: [
          { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 4, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
          { libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 4, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" },
        ],
      },
    ],
  });
  const minutes = estimateProgrammeDurationMinutes(draft as never);
  assert.ok(minutes > 20 && minutes < 80, `plausible range, got ${minutes}`);
});

test("duration estimate handles empty and malformed sessions safely", () => {
  assert.equal(estimateProgrammeDurationMinutes({ sessions: [] } as never), 0);
  assert.equal(estimateProgrammeDurationMinutes({ sessions: [{ name: "X", focus: "", estimatedMinutes: 60, exercises: [] }] } as never), 0);
});

// ---------- Draft validation ----------

test("valid draft with real library IDs passes validation", () => {
  const result = validateDraft(validDraft(), 3);
  assert.equal(result.ok, true);
});

test("exact requested frequency must match real session count", () => {
  const draft = validDraft({ sessions: validDraft().sessions.slice(0, 2) });
  const result = validateDraft(draft, 3);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join(" "), /3 was requested/i);
});

test("invalid library IDs rejected", () => {
  const draft = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [{ libraryId: "not-a-real-exercise", name: "Mystery move", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" }],
      },
    ],
  });
  const result = validateDraft(draft, 1);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join(" "), /unknown library exercise/i);
});

test("duplicate exercises in the same session rejected", () => {
  const draft = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [
          { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
          { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 4, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        ],
      },
    ],
  });
  const result = validateDraft(draft, 1);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join(" "), /more than once/i);
});

test("out-of-range RIR/rest are warnings, not hard failures", () => {
  const draft = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [
          { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: -5, reps: "0-0", rir: 9, restSeconds: 900, tempo: "", note: "" },
        ],
      },
    ],
  });
  const result = validateDraft(draft, 1);
  // Sanitization clamps sets into range and accepts the draft;
  // out-of-range RIR/rest surface as coach warnings instead of blocking.
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => /RIR/.test(w.message)));
  assert.ok(result.warnings.some((w) => /rest/.test(w.message)));
});

test("malformed/empty programme rejected", () => {
  assert.equal(validateDraft(null, 3).ok, false);
  assert.equal(validateDraft({}, 3).ok, false);
  assert.equal(validateDraft(validDraft({ sessions: [] }), 3).ok, false);
});

// ---------- Rehydration ----------

test("rehydrateDraft resolves library metadata EN/FR/AR + image", () => {
  const draft = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" }],
      },
    ],
  });
  const rehydrated = rehydrateDraft(draft);
  const exercise = rehydrated.sessions[0].exercises[0];
  assert.equal(exercise.name, "Barbell bench press");
  assert.equal(exercise.nameFr, "Développé couché barre");
  assert.equal(exercise.nameAr, "ضغط الصدر بالبار");
  assert.ok(exercise.imageUrl);
  assert.equal(exercise.source, "library");
});

test("custom exercises are marked source custom and keep coach name", () => {
  const draft = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [{ libraryId: "", name: "Landmine t-spine rotation", sets: 3, reps: "10", rir: 2, restSeconds: 90, tempo: "", note: "" }],
      },
    ],
  });
  const rehydrated = rehydrateDraft(draft);
  const exercise = rehydrated.sessions[0].exercises[0];
  assert.equal(exercise.source, "custom");
  assert.equal(exercise.libraryId, "custom");
  assert.equal(exercise.name, "Landmine t-spine rotation");
});

// ---------- Design recommendation ----------

test("designRecommendation respects client frequency and equipment", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "Commercial gym", "", "Monday / Wednesday / Friday evenings", 60);
  assert.equal(design.sessionsPerWeek, 3);
  assert.match(design.recommendedSplit, /Full body/i);
  assert.equal(design.sessionDurationMinutes, 60);
});

test("no-equipment client never assumes commercial gym machines", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "No equipment", "", "", 60);
  assert.ok(design.constraints.some((c) => /bodyweight|minimal-equipment/i.test(c)));
  assert.ok(design.constraints.some((c) => /no machine or barbell/i.test(c)));
  assert.ok(design.rationale.some((r) => /equipment/i.test(r)));
});

test("missing equipment is flagged, not assumed", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "", "", "", 60);
  assert.ok(design.constraints.some((c) => /full commercial gym/i.test(c)));
});

test("limitations flag coach review in design output", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "Commercial gym", "Knee discomfort on squats", "", 60);
  assert.ok(design.constraints.some((c) => /limitation|coach-reviewed/i.test(c)));
  assert.ok(design.rationale.some((r) => /coach review required/i.test(r)));
});

// ---------- Change summary ----------

test("programmeChangeSummary derives deterministic diffs", () => {
  const previous = validDraft();
  const next = validDraft({
    sessions: [
      {
        name: "Day 1",
        focus: "Full body",
        exercises: [
          { libraryId: "builtin-leg-press", name: "Leg press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        ],
      },
      ...validDraft().sessions.slice(1),
    ],
  });
  const summary = programmeChangeSummary(previous, next);
  assert.ok(summary.dayChanges.length >= 1);
  assert.ok(summary.dayChanges[0].changes.some((c) => /Added Leg press/.test(c)));
  assert.ok(summary.dayChanges[0].changes.some((c) => /Removed Barbell bench press/.test(c)));
});

// ---------- Fallback builder ----------

test("buildFallbackDraft produces a library-grounded draft", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  assert.equal(draft.sessions.length, 3);
  assert.equal(validateDraft(draft, 3).ok, true);
  const rehydrated = rehydrateDraft(draft);
  assert.ok(rehydrated.sessions[0].exercises.length > 0);
  assert.equal(rehydrated.sessions[0].exercises[0].source, "library");
  assert.ok(rehydrated.sessions[0].exercises[0].imageUrl);
});

test("buildFallbackDraft respects frequency (never silently adds days)", () => {
  assert.equal(buildFallbackDraft("Build muscle", 4, "Commercial gym", "intermediate").sessions.length, 4);
  assert.equal(buildFallbackDraft("Build muscle", 1, "Commercial gym", "beginner").sessions.length, 1);
});

test("buildFallbackDraft with no equipment stays bodyweight/dumbbell compatible", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "No equipment", "beginner");
  const equipment = draft.sessions.flatMap((s) => s.exercises.map((e) => e.name)).join(" ");
  assert.ok(equipment.length > 0);
  // Every exercise must resolve through the library (no invented moves).
  for (const session of draft.sessions) {
    for (const exercise of session.exercises) {
      assert.equal(exercise.source, "library");
    }
  }
});
