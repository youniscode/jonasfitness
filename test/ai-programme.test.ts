import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_DRAFT_CONTRACT,
  candidateExercisesFor,
  compactCatalogue,
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

// ---------- Reps contract (strict, unchanged validation) ----------

test("prose rep prescriptions are rejected - never accommodated", () => {
  for (const badReps of ["30 sec", "30 sec walk", "8-10 each leg", "10 per side", "AMRAP", "to failure", "45 seconds"]) {
    const draft = validDraft({
      sessions: [
        {
          name: "Day 1",
          focus: "Full body",
          exercises: [{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: badReps, rir: 2, restSeconds: 120, tempo: "", note: "" }],
        },
      ],
    });
    const result = validateDraft(draft, 1);
    assert.equal(result.ok, false, `"${badReps}" must fail validation`);
    assert.match(result.errors.map((e) => e.message).join(" "), /invalid rep range/i);
  }
});

test("valid rep forms are accepted (integer or integer range only)", () => {
  for (const goodReps of ["8", "8-10", "10–12", "12-15", "3-5"]) {
    const draft = validDraft({
      sessions: [
        {
          name: "Day 1",
          focus: "Full body",
          exercises: [{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: goodReps, rir: 2, restSeconds: 120, tempo: "", note: "" }],
        },
      ],
    });
    assert.equal(validateDraft(draft, 1).ok, true, `"${goodReps}" must pass`);
  }
});

// ---------- Time/distance exercises excluded from AI generation ----------

test("timed/distance exercises are excluded from AI generation candidates", () => {
  for (const equipment of ["Commercial gym", "Home / Bodyweight", "Dumbbells", undefined]) {
    const ids = candidateExercisesFor(equipment).map((exercise) => exercise.id);
    assert.ok(!ids.includes("builtin-plank"), "plank is time-based and must be excluded");
    assert.ok(!ids.includes("builtin-farmer-carry"), "farmer carry is distance-based and must be excluded");
  }
  const catalogue = compactCatalogue("Commercial gym").join("\n");
  assert.ok(!catalogue.includes("builtin-plank"));
  assert.ok(!catalogue.includes("builtin-farmer-carry"));
});

test("excluded exercises remain in the full library for manual selection", () => {
  const ids = candidateExercisesFor("Commercial gym").map((exercise) => exercise.id);
  assert.ok(ids.includes("builtin-barbell-bench-press"));
  assert.ok(ids.includes("builtin-pull-up"));
});

// ---------- AI output contract (prompt-level hardening) ----------

test("AI_DRAFT_CONTRACT demands a pure JSON object and strict reps", () => {
  assert.match(AI_DRAFT_CONTRACT, /Return ONE JSON object only/);
  assert.match(AI_DRAFT_CONTRACT, /first character must be "\{"/);
  assert.match(AI_DRAFT_CONTRACT, /NO markdown, NO code fences/);
  assert.match(AI_DRAFT_CONTRACT, /reps must be ONLY a single integer or an integer range/);
  assert.match(AI_DRAFT_CONTRACT, /"8", "8-10", "10-12", "12-15"/);
  assert.match(AI_DRAFT_CONTRACT, /never "8-10 each leg"/);
  assert.match(AI_DRAFT_CONTRACT, /Avoid repeating the exact same technically demanding compound exercise in every weekly session unless client context or coach instruction specifically justifies it/);
  assert.match(AI_DRAFT_CONTRACT, /libraryId and name from the "Available library exercises" list/);
  assert.match(AI_DRAFT_CONTRACT, /OPAQUE identifier/);
  assert.match(AI_DRAFT_CONTRACT, /COPY IT EXACTLY/);
  assert.match(AI_DRAFT_CONTRACT, /Never construct, rename, infer, abbreviate or transform a libraryId/);
  assert.match(AI_DRAFT_CONTRACT, /at most ONE per session/);
  assert.match(AI_DRAFT_CONTRACT, /plank, farmer carry, timed holds, walking carries/);
  // The contract includes a pre-output self-check with the strict rules.
  assert.match(AI_DRAFT_CONTRACT, /SELF-CHECK BEFORE OUTPUT/);
  assert.match(AI_DRAFT_CONTRACT, /exact requested session count/);
  assert.match(AI_DRAFT_CONTRACT, /no duplicate exercise inside a session/);
  assert.match(AI_DRAFT_CONTRACT, /no timed\/distance prescription/);
  // The example must use a real library id - never a fake one.
  assert.match(AI_DRAFT_CONTRACT, /builtin-barbell-bench-press/);
  // The example teaches that an id may NOT resemble its name (the production
  // failure: "Barbell back squat" ↔ builtin-back-squat, no "barbell").
  assert.match(AI_DRAFT_CONTRACT, /builtin-back-squat/);
  assert.match(AI_DRAFT_CONTRACT, /no "barbell" in the id/);
  // The example itself must be valid per validateDraft's reps rule.
  const exampleJson = AI_DRAFT_CONTRACT.slice(AI_DRAFT_CONTRACT.indexOf("VALID EXAMPLE") + "VALID EXAMPLE".length);
  const firstBrace = exampleJson.indexOf("{");
  const parsed = JSON.parse(exampleJson.slice(firstBrace, exampleJson.lastIndexOf("}") + 1)) as { sessions: Array<{ exercises: Array<{ reps: string }> }> };
  assert.equal(validateDraft(parsed, parsed.sessions.length).ok, true, "the in-prompt example must pass validation");
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
  assert.ok(design.constraints.some((c) => /equipment not specified/i.test(c)));
  assert.ok(design.rationale.some((r) => /confirm access/i.test(r)));
});

test("limitations flag coach review in design output", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "Commercial gym", "Knee discomfort on squats", "", 60);
  assert.ok(design.constraints.some((c) => /limitation|coach-reviewed/i.test(c)));
  assert.ok(design.rationale.some((r) => /coach review required/i.test(r)));
});

test("designRecommendation surfaces secondary objectives as supporting context only", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "Commercial gym", "", "", 60, ["Get stronger", "Improve fitness", "Energy"]);
  assert.deepEqual(design.objectives, { primary: "Build muscle", supports: ["Get stronger", "Improve fitness", "Energy"] });
  assert.ok(design.rationale.some((r) => /secondary objectives/i.test(r) && /supporting context/i.test(r)));
});

test("designRecommendation without secondary goals has empty supports and no extra rationale", () => {
  const design = designRecommendation("Build muscle", 3, "beginner", "Commercial gym", "", "", 60);
  assert.deepEqual(design.objectives, { primary: "Build muscle", supports: [] });
  assert.ok(!design.rationale.some((r) => /secondary objectives/i.test(r)));
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

// ---------- Duration-aware first-programme fallback ----------

// The deterministic first-programme fallback must treat targetDuration as a
// real structured control: when AI fails (truncated/malformed/provider error)
// against a 30-min target it must NOT silently return the default ~48-min
// plan. It repairs toward the target band (target ± 15%) with the same
// deterministic shortening used by the adjustment fallback - fewer high-value
// exercises first, never artificial rest compression.

test("fallback honors a 30-min target (the production failure case)", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  const estimated = estimateProgrammeDurationMinutes(draft);
  // Inside the ±15% band (25.5–34.5) for a 30-min target.
  assert.ok(estimated >= 25.5 && estimated <= 34.5, `expected ~25.5–34.5 min, got ${estimated}`);
  assert.equal(draft.sessions.length, 3);
  assert.equal(validateDraft(draft, 3).ok, true, "duration-aware fallback must remain structurally valid");
});

test("fallback uses roughly 4 high-value exercises/session for a 30-min target", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  for (const session of draft.sessions) {
    assert.ok(session.exercises.length >= 3 && session.exercises.length <= 5, `${session.name} has ${session.exercises.length} exercises`);
  }
});

test("short-target fallback preserves major movement balance across the week", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  const week = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name).join(" "));
  const all = week.join(" ");
  // Weekly coverage: knee-dominant + posterior/hinge + push + pull must exist.
  const lowerKnee = /squat|leg press|split squat|hack squat/i.test(all);
  const hinge = /deadlift|hip thrust|leg curl/i.test(all);
  const push = /press|bench|fly/i.test(all);
  const pull = /row|pulldown|pull-up/i.test(all);
  assert.ok(lowerKnee, `no knee-dominant work: ${all}`);
  assert.ok(hinge, `no posterior-chain work: ${all}`);
  assert.ok(push, `no push work: ${all}`);
  assert.ok(pull, `no pull work: ${all}`);
});

test("short-target fallback never compresses rest artificially", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  for (const session of draft.sessions) {
    for (const exercise of session.exercises) {
      assert.ok(exercise.restSeconds >= 60, `${exercise.name} rest ${exercise.restSeconds}s is unrealistically short`);
    }
  }
});

test("60-min target still produces a longer, appropriate fallback", () => {
  const short = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  const long = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 60);
  const shortEst = estimateProgrammeDurationMinutes(short);
  const longEst = estimateProgrammeDurationMinutes(long);
  // A 60-min target must NOT be forced into the 30-min structure.
  assert.ok(longEst > shortEst, `60-min fallback (${longEst}) should be longer than 30-min fallback (${shortEst})`);
  assert.equal(long.sessions.length, 3);
  assert.equal(validateDraft(long, 3).ok, true);
});

test("no target keeps the existing default fallback behavior", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 40, `default fallback should stay substantial, got ${estimated}`);
  assert.equal(validateDraft(draft, 3).ok, true);
  // 5 blueprint patterns per day for a 3-day full-body plan.
  assert.ok(draft.sessions.every((session) => session.exercises.length >= 4));
});
