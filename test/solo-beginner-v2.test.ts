import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  builtInExercises,
  soloBeginnerLevelFor,
  difficultyTierFor,
} from "../app/lib/exercise-catalogue.ts";
import { exerciseIntelligenceFor } from "../app/lib/exercise-intelligence.ts";
import { isSoloBeginner, applyTrainingSupervision, deriveIntakeFields, parseProfile, profileSummary, sanitizeProfile, supervisionCoachLabel, supervisionLabelFor, emptyProfile, type OnboardingProfile } from "../app/lib/onboarding-profile.ts";
import { buildFallbackDraft } from "../app/lib/ai-programme.ts";
import {
  soloBeginnerChecks,
  analyseProgrammeQuality,
  type QualityOptions,
} from "../app/lib/programme-quality.ts";

// ---------- Helpers ----------

function soloBeginnerProfile(overrides?: Partial<{ experience: string; confidenceAlone: string; trainingSupervision: "" | "alone" | "coach" | "mixed" }>): OnboardingProfile {
  return {
    version: 2,
    goals: { primary: "Build muscle", secondary: [], note: "", targetWeightKg: null },
    timeline: { targetDate: "", targetDateValue: "", importance: null },
    experience: { level: overrides?.experience ?? "Beginner", years: "", used: [] },
    confidence: { alone: overrides?.confidenceAlone ?? "Not confident", help: [] },
    trainingSupervision: overrides?.trainingSupervision ?? "",
    schedule: { daysPerWeek: 3, days: [], time: "", duration: "" },
    location: { venue: "Full commercial gym", equipment: [], unsure: false },
    preferences: { style: [], liked: [], disliked: [], unsure: [], note: "" },
    limitations: { status: "none", areas: [], areaKinds: {}, note: "" },
    lifestyle: { activity: "", steps: "", work: "" },
    recovery: { sleepHours: "", sleepQuality: null, stress: null, recovery: "" },
    motivation: { drivers: [], barriers: [] },
    coaching: { accountability: "", feedback: "", focus: [], coachingFormat: "" },
    nutrition: { tracking: "", pattern: "", note: "", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: null },
    measurements: { heightCm: null, weightKg: null, waistCm: null },
    prefillSource: [],
    openNote: "",
    demographics: { ageYears: null, sex: "" },
    nutritionSafety: { flags: [], note: "" },
  };
}

// ---------- Metadata coverage ----------

describe("SoloBeginnerLevel - metadata coverage", () => {
  it("every built-in exercise has a soloBeginnerLevel", () => {
    const missing: string[] = [];
    for (const exercise of builtInExercises) {
      const level = soloBeginnerLevelFor(exercise);
      if (level === null) missing.push(exercise.id);
    }
    assert.deepEqual(missing, [], `Exercises missing soloBeginnerLevel: ${missing.join(", ")}`);
  });

  it("soloBeginnerLevelFor returns null for unknown exercises", () => {
    assert.equal(soloBeginnerLevelFor({ libraryId: "nonexistent-exercise" }), null);
    assert.equal(soloBeginnerLevelFor({}), null);
    assert.equal(soloBeginnerLevelFor(null), null);
  });

  it("soloBeginnerLevel is consistent with difficultyTier for known misclassifications", () => {
    assert.equal(difficultyTierFor({ libraryId: "builtin-hack-squat" }), 1);
    assert.equal(soloBeginnerLevelFor({ libraryId: "builtin-hack-squat" }), 2);
    assert.equal(difficultyTierFor({ libraryId: "builtin-leg-press" }), 1);
    assert.equal(soloBeginnerLevelFor({ libraryId: "builtin-leg-press" }), 2);
    assert.equal(difficultyTierFor({ libraryId: "builtin-cable-pull-through" }), 1);
    assert.equal(soloBeginnerLevelFor({ libraryId: "builtin-cable-pull-through" }), 2);
  });

  it("distribution matches target (L1: 49, L2: 42, L3: 15)", () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const exercise of builtInExercises) {
      const level = soloBeginnerLevelFor(exercise);
      if (level) counts[level]++;
    }
    assert.equal(counts[1], 49, `Level 1 count: expected 49, got ${counts[1]}`);
    assert.equal(counts[2], 42, `Level 2 count: expected 42, got ${counts[2]}`);
    assert.equal(counts[3], 15, `Level 3 count: expected 15, got ${counts[3]}`);
  });

  it("all Tier 3 difficultyTier exercises are Solo Level 3", () => {
    for (const exercise of builtInExercises) {
      const tier = difficultyTierFor(exercise);
      const soloLevel = soloBeginnerLevelFor(exercise);
      if (tier === 3) {
        assert.equal(soloLevel, 3, `${exercise.id}: Tier 3 must be Solo Level 3, got ${soloLevel}`);
      }
    }
  });

  it("exerciseIntelligenceFor includes soloBeginnerLevel", () => {
    const intel = exerciseIntelligenceFor({ libraryId: "builtin-leg-press" });
    assert.ok(intel, "exerciseIntelligenceFor should return intel for leg-press");
    assert.equal(intel.soloBeginnerLevel, 2);
  });
});

// ---------- isSoloBeginner ----------

describe("isSoloBeginner - detection logic", () => {
  it("trainingSupervision=alone + beginner → solo beginner (primary signal)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "alone" })), true);
  });

  it("trainingSupervision=alone + Never trained → solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Never trained", trainingSupervision: "alone" })), true);
  });

  it("trainingSupervision=alone + confident beginner → STILL solo beginner (supervision overrides confidence)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "alone", confidenceAlone: "Very confident" })), true);
  });

  it("trainingSupervision=coach + beginner → NOT solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "coach" })), false);
  });

  it("trainingSupervision=mixed + beginner → solo beginner (some sessions independent)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "mixed" })), true);
  });

  it("trainingSupervision=coach + unconfident beginner → NOT solo beginner (coach present)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "coach", confidenceAlone: "Not confident" })), false);
  });

  it("trainingSupervision empty + beginner + Not confident → legacy fallback → solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", confidenceAlone: "Not confident" })), true);
  });

  it("trainingSupervision empty + beginner + A little confident → legacy fallback → solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", confidenceAlone: "A little confident" })), true);
  });

  it("trainingSupervision empty + beginner + Comfortable → legacy fallback → NOT solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", confidenceAlone: "Comfortable" })), false);
  });

  it("trainingSupervision empty + beginner + Very confident → legacy fallback → NOT solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Beginner", confidenceAlone: "Very confident" })), false);
  });

  it("trainingSupervision empty + Regular lifter + Not confident → NOT solo beginner (not beginner)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Regular lifter", confidenceAlone: "Not confident" })), false);
  });

  it("trainingSupervision empty + Advanced + Very confident → NOT solo beginner", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Advanced", confidenceAlone: "Very confident" })), false);
  });

  it("trainingSupervision=alone + Regular lifter → NOT solo beginner (not beginner)", () => {
    assert.equal(isSoloBeginner(soloBeginnerProfile({ experience: "Regular lifter", trainingSupervision: "alone" })), false);
  });
});

// ---------- Programme generation - solo beginner ----------

describe("buildFallbackDraft - solo beginner filtering", () => {
  it("solo beginner draft contains zero Level 3 exercises", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, true);
    const level3Exercises: string[] = [];
    for (const session of draft.sessions) {
      for (const exercise of session.exercises ?? []) {
        const level = soloBeginnerLevelFor(exercise);
        if (level === 3) level3Exercises.push(exercise.name);
      }
    }
    assert.deepEqual(level3Exercises, [], `Solo beginner draft contains Level 3 exercises: ${level3Exercises.join(", ")}`);
  });

  it("solo beginner draft has ≥70% Level 1 exercises", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, true);
    let total = 0;
    let level1 = 0;
    for (const session of draft.sessions) {
      for (const exercise of session.exercises ?? []) {
        total++;
        if (soloBeginnerLevelFor(exercise) === 1) level1++;
      }
    }
    const ratio = level1 / total;
    assert.ok(ratio >= 0.7, `Solo beginner draft has ${Math.round(ratio * 100)}% Level 1 (target ≥70%)`);
  });

  it("solo beginner draft has ≤1 Level 2 per session", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, true);
    for (const session of draft.sessions) {
      let level2Count = 0;
      for (const exercise of session.exercises ?? []) {
        if (soloBeginnerLevelFor(exercise) === 2) level2Count++;
      }
      assert.ok(level2Count <= 1, `Session "${session.name}" has ${level2Count} Level 2 exercises (max 1)`);
    }
  });

  it("solo beginner draft has ≤4 Level 2 exercises across the week", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, true);
    let weeklyLevel2 = 0;
    for (const session of draft.sessions) {
      for (const exercise of session.exercises ?? []) {
        if (soloBeginnerLevelFor(exercise) === 2) weeklyLevel2++;
      }
    }
    assert.ok(weeklyLevel2 <= 4, `Solo beginner draft has ${weeklyLevel2} Level 2 exercises (max 4 per week)`);
  });

  it("non-solo beginner draft may contain Level 3 exercises", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, false);
    assert.ok(draft.sessions.length === 3, "Non-solo beginner draft should have 3 sessions");
  });
});

// ---------- Quality engine - solo-beginner checks ----------

describe("soloBeginnerChecks - quality engine integration", () => {
  it("Level 3 exercise in solo-beginner draft produces error (not warning)", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push({
      libraryId: "builtin-back-squat",
      name: "Back Squat",
      sets: 3,
      reps: "8-12",
      rir: 2,
      restSeconds: 120,
      source: "library",
    });
    const result = soloBeginnerChecks(draft, true);
    assert.ok(result.errors.some((e) => e.includes("Back Squat") && e.includes("Level 3")), "Should flag Level 3 Back Squat as error");
    assert.equal(result.warnings.filter((w) => w.includes("Level 3")).length, 0, "Level 3 should appear in errors, not warnings");
  });

  it("excess Level 2 per session produces warning (not error)", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push(
      {
        libraryId: "builtin-goblet-squat",
        name: "Goblet Squat",
        sets: 3,
        reps: "8-12",
        rir: 2,
        restSeconds: 90,
        source: "library",
      },
      {
        libraryId: "builtin-reverse-lunge",
        name: "Reverse Lunge",
        sets: 2,
        reps: "10-15",
        rir: 2,
        restSeconds: 75,
        source: "library",
      },
    );
    const result = soloBeginnerChecks(draft, true);
    assert.ok(result.warnings.some((w) => w.includes("Level 2 exercises")), "Should warn about excess Level 2 per session");
    assert.equal(result.errors.length, 0, "Excess Level 2 should be warning only, not error");
  });

  it("non-solo-beginner mode produces no errors or warnings", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push({
      libraryId: "builtin-back-squat",
      name: "Back Squat",
      sets: 3,
      reps: "8-12",
      rir: 2,
      restSeconds: 120,
      source: "library",
    });
    const result = soloBeginnerChecks(draft, false);
    assert.equal(result.errors.length, 0, "Non-solo-beginner mode should produce no errors");
    assert.equal(result.warnings.length, 0, "Non-solo-beginner mode should produce no warnings");
  });

  it("Level 3 error makes soloBeginner quality check fail", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push({
      libraryId: "builtin-back-squat",
      name: "Back Squat",
      sets: 3,
      reps: "8-12",
      rir: 2,
      restSeconds: 120,
      source: "library",
    });
    const options: QualityOptions = {
      targetMinutes: null,
      equipment: "Full commercial gym",
      experience: "beginner",
      soloBeginner: true,
    };
    const report = analyseProgrammeQuality(draft, options);
    const soloCheck = report.checks.find((c) => c.key === "soloBeginner");
    assert.ok(soloCheck, "Quality report should include soloBeginner check");
    assert.equal(soloCheck.ok, false, "soloBeginner check should fail when Level 3 is present");
    assert.ok(report.warnings.some((w) => w.includes("Level 3")), "Warnings should mention Level 3");
  });

  it("excess Level 2 is advisory - soloBeginner check still passes, warning surfaces", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    // Inject two Level 2 exercises into one session to exceed the 1/session budget
    draft.sessions[0].exercises.push(
      { libraryId: "builtin-hack-squat", name: "Hack Squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, source: "library" },
      { libraryId: "builtin-leg-press", name: "Leg Press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, source: "library" },
    );
    const options: QualityOptions = {
      targetMinutes: null,
      equipment: "Full commercial gym",
      experience: "beginner",
      soloBeginner: true,
    };
    const report = analyseProgrammeQuality(draft, options);
    const soloCheck = report.checks.find((c) => c.key === "soloBeginner");
    assert.ok(soloCheck, "Quality report should include soloBeginner check");
    assert.equal(soloCheck.ok, true, "Excess Level 2 must remain advisory - check should still pass");
    assert.ok(report.warnings.some((w) => w.includes("Level 2")), "Excess Level 2 should surface as an advisory warning");
  });
});

// ---------- Regression: non-solo beginner draft unchanged ----------

describe("Regression - non-solo beginner draft unchanged", () => {
  it("non-solo beginner draft still passes quality checks", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    const options: QualityOptions = {
      targetMinutes: null,
      equipment: "Full commercial gym",
      experience: "beginner",
      soloBeginner: false,
    };
    const report = analyseProgrammeQuality(draft, options);
    const beginnerCheck = report.checks.find((c) => c.key === "beginnerSuitability");
    assert.ok(beginnerCheck, "Quality report should include beginnerSuitability check");
  });

  it("intermediate/expert drafts are unaffected by soloBeginner flag", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "intermediate");
    const options: QualityOptions = {
      targetMinutes: null,
      equipment: "Full commercial gym",
      experience: "intermediate",
      soloBeginner: true,
    };
    const report = analyseProgrammeQuality(draft, options);
    const soloCheck = report.checks.find((c) => c.key === "soloBeginner");
    assert.ok(soloCheck, "Quality report should include soloBeginner check");
  });
});

// ---------- Friend-like programme: gym buddy scenario ----------

describe("Friend-like programme - gym buddy scenario", () => {
  it("3-day full body gym programme for a solo beginner uses mostly Level 1", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, undefined, true);
    assert.equal(draft.sessions.length, 3, "Should have 3 sessions");
    for (const session of draft.sessions) {
      assert.ok(session.name, "Session should have a name");
      assert.ok((session.exercises?.length ?? 0) >= 3, `Session "${session.name}" should have at least 3 exercises`);
    }
    let total = 0;
    let level1 = 0;
    let level2 = 0;
    let level3 = 0;
    for (const session of draft.sessions) {
      for (const exercise of session.exercises ?? []) {
        total++;
        const level = soloBeginnerLevelFor(exercise);
        if (level === 1) level1++;
        else if (level === 2) level2++;
        else if (level === 3) level3++;
      }
    }
    assert.equal(level3, 0, "No Level 3 exercises in solo beginner programme");
    assert.ok(level1 / total >= 0.7, `Level 1 ratio should be ≥70%, got ${Math.round((level1 / total) * 100)}%`);
    assert.ok(level2 <= 4, `Level 2 count should be ≤4, got ${level2}`);
  });
});

// ---------- Mixed supervision & coached beginner ----------

describe("Mixed supervision & coached beginner", () => {
  it("mixed supervision beginner → solo beginner → solo-safe generation applies", () => {
    const profile = soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "mixed" });
    assert.equal(isSoloBeginner(profile), true, "Mixed supervision beginner should be solo beginner");
  });

  it("coached beginner with low confidence → NOT solo beginner", () => {
    const profile = soloBeginnerProfile({ experience: "Beginner", trainingSupervision: "coach", confidenceAlone: "Not confident" });
    assert.equal(isSoloBeginner(profile), false, "Coached beginner should not be solo beginner even with low confidence");
  });

  it("soloBeginnerChecks returns empty when soloBeginner=false", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push({
      libraryId: "builtin-back-squat",
      name: "Back Squat",
      sets: 3,
      reps: "8-12",
      rir: 2,
      restSeconds: 120,
      source: "library",
    });
    const result = soloBeginnerChecks(draft, false);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });
});

// ---------- Hallucination defense ----------

describe("Hallucination defense - Level 3 detection", () => {
  it("detects Level 3 exercises in a mixed draft", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push(
      {
        libraryId: "builtin-back-squat",
        name: "Back Squat",
        sets: 3,
        reps: "8-12",
        rir: 2,
        restSeconds: 120,
        source: "library",
      },
      {
        libraryId: "builtin-conventional-deadlift",
        name: "Conventional Deadlift",
        sets: 3,
        reps: "8-12",
        rir: 2,
        restSeconds: 120,
        source: "library",
      },
    );
    const result = soloBeginnerChecks(draft, true);
    assert.ok(result.errors.length >= 2, `Should detect multiple Level 3 exercises, got ${result.errors.length}`);
    assert.ok(result.errors.some((e) => e.includes("Back Squat")), "Should flag Back Squat");
    assert.ok(result.errors.some((e) => e.includes("Deadlift")), "Should flag Deadlift");
  });

  it("analyseProgrammeQuality surfaces Level 3 as failed check", () => {
    const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
    draft.sessions[0].exercises.push({
      libraryId: "builtin-back-squat",
      name: "Back Squat",
      sets: 3,
      reps: "8-12",
      rir: 2,
      restSeconds: 120,
      source: "library",
    });
    const report = analyseProgrammeQuality(draft, { targetMinutes: null, equipment: "Full commercial gym", experience: "beginner", soloBeginner: true });
    const soloCheck = report.checks.find((c) => c.key === "soloBeginner");
    assert.ok(soloCheck);
    assert.equal(soloCheck.ok, false, "Level 3 presence must fail the soloBeginner check");
    assert.equal(report.state, "review", "Quality state should be 'review' when soloBeginner check fails");
  });
});

// ---------- Stored values + display labels (UX polish, display-only) ----------

describe("trainingSupervision - stored values stay canonical; labels are display-only", () => {
  const CANONICAL = ["alone", "coach", "mixed"] as const;

  it("sanitizeProfile accepts only the canonical stored tokens (never localized labels)", () => {
    // A localized label is NOT a valid stored value - the sanitizer drops it.
    const localized = sanitizeProfile({ ...soloBeginnerProfile(), trainingSupervision: "By myself" });
    assert.equal(localized.trainingSupervision, "");
    for (const value of CANONICAL) {
      const sanitized = sanitizeProfile({ ...soloBeginnerProfile(), trainingSupervision: value });
      assert.equal(sanitized.trainingSupervision, value, `canonical value ${value} must survive`);
    }
  });

  it("parseProfile round-trip preserves the exact canonical value", () => {
    for (const value of CANONICAL) {
      const parsed = parseProfile(JSON.stringify(soloBeginnerProfile({ trainingSupervision: value })));
      assert.ok(parsed);
      assert.equal(parsed.trainingSupervision, value);
    }
  });

  it("EN display labels", () => {
    assert.equal(supervisionLabelFor("en", "alone"), "By myself");
    assert.equal(supervisionLabelFor("en", "coach"), "With my coach");
    assert.equal(supervisionLabelFor("en", "mixed"), "A mix of both");
  });

  it("FR display labels", () => {
    assert.equal(supervisionLabelFor("fr", "alone"), "Seul(e)");
    assert.equal(supervisionLabelFor("fr", "coach"), "Avec mon coach");
    assert.equal(supervisionLabelFor("fr", "mixed"), "Un mélange des deux");
  });

  it("AR display labels", () => {
    assert.equal(supervisionLabelFor("ar", "alone"), "بمفردي");
    assert.equal(supervisionLabelFor("ar", "coach"), "مع مدربي");
    assert.equal(supervisionLabelFor("ar", "mixed"), "مزيج من الاثنين");
  });

  it("label helpers return '' for an unanswered supervision field", () => {
    assert.equal(supervisionLabelFor("en", ""), "");
    assert.equal(supervisionCoachLabel(""), "");
  });

  it("coach-facing profileSummary uses English descriptors, never raw tokens", () => {
    const alone = profileSummary(soloBeginnerProfile({ trainingSupervision: "alone" }));
    const aloneLines = alone.find((block) => block.section === "Initial client preferences");
    assert.ok(aloneLines && aloneLines.lines.some((line) => line.includes("Training supervision: Trains alone")));
    assert.ok(!aloneLines!.lines.some((line) => line.includes("Training supervision: alone")));

    const coach = profileSummary(soloBeginnerProfile({ trainingSupervision: "coach" }));
    const coachLines = coach.find((block) => block.section === "Initial client preferences");
    assert.ok(coachLines && coachLines.lines.some((line) => line.includes("Training supervision: With coach")));

    const mixed = profileSummary(soloBeginnerProfile({ trainingSupervision: "mixed" }));
    const mixedLines = mixed.find((block) => block.section === "Initial client preferences");
    assert.ok(mixedLines && mixedLines.lines.some((line) => line.includes("Training supervision: Mixed")));
  });

  it("deriveIntakeFields embeds the coach descriptor, never the raw token", () => {
    const derived = deriveIntakeFields(soloBeginnerProfile({ trainingSupervision: "alone" }));
    assert.ok(derived.goalsDetail.includes("supervision: Trains alone"));
    assert.ok(!derived.goalsDetail.includes("supervision: alone"));
  });
});

// ---------- Coach onboarding modal: trainingSupervision edit + merge safety ----------

describe("Coach onboarding modal - trainingSupervision edit", () => {
  // A structured profile as the client survey would produce it, with a rich set
  // of fields the "Complete the coaching foundations" modal does NOT display.
  function fullProfile(): OnboardingProfile {
    const p = emptyProfile();
    p.goals.primary = "Build muscle";
    p.goals.secondary = ["Confidence"];
    p.timeline.targetDate = "In 3–6 months";
    p.experience.level = "Beginner";
    p.experience.years = "Less than 6 months";
    p.experience.used = ["Machines"];
    p.confidence.alone = "A little confident";
    p.confidence.help = ["Exercise technique"];
    p.schedule.daysPerWeek = 3;
    p.schedule.days = ["Mon", "Wed", "Fri"];
    p.schedule.time = "Evening";
    p.schedule.duration = "45–60 min";
    p.location.venue = "Full commercial gym";
    p.location.equipment = ["Cable station", "Bench"];
    p.location.unsure = false;
    p.preferences.style = ["Machines"];
    p.preferences.liked = ["builtin-lat-pulldown"];
    p.preferences.disliked = ["builtin-back-squat"];
    p.limitations.status = "none";
    p.lifestyle.activity = "Some walking";
    p.recovery.sleepHours = "6–7h";
    p.recovery.sleepQuality = 4;
    p.motivation.drivers = ["Health"];
    p.coaching.accountability = "High - keep me accountable";
    p.coaching.feedback = "Direct and concise";
    p.coaching.coachingFormat = "Online";
    p.nutrition.tracking = "Roughly";
    p.measurements.heightCm = 175;
    p.measurements.weightKg = 80;
    p.measurements.waistCm = 82;
    p.openNote = "Prefers quiet gyms.";
    return p;
  }

  it("1: existing 'alone' profile is preserved and maps to 'By myself'", () => {
    const profile = applyTrainingSupervision(fullProfile(), "alone");
    assert.equal(profile?.trainingSupervision, "alone", "stored token is the canonical 'alone'");
    assert.equal(supervisionLabelFor("en", profile?.trainingSupervision ?? ""), "By myself");
  });

  it("2: existing 'coach' profile maps to 'With my coach'", () => {
    const profile = applyTrainingSupervision(fullProfile(), "coach");
    assert.equal(profile?.trainingSupervision, "coach");
    assert.equal(supervisionLabelFor("en", profile?.trainingSupervision ?? ""), "With my coach");
  });

  it("3: existing 'mixed' profile maps to 'A mix of both'", () => {
    const profile = applyTrainingSupervision(fullProfile(), "mixed");
    assert.equal(profile?.trainingSupervision, "mixed");
    assert.equal(supervisionLabelFor("en", profile?.trainingSupervision ?? ""), "A mix of both");
  });

  it("4: a missing value stays empty (never fabricated from confidence.alone)", () => {
    // The profile has confidence.alone set, but no supervision - it must stay empty.
    const merged = applyTrainingSupervision(fullProfile(), "");
    assert.ok(merged, "merge of an existing structured profile is not dropped");
    assert.equal(merged.trainingSupervision, "", "empty supervision stays empty");
    assert.equal(merged.confidence.alone, "A little confident", "confidence.alone is preserved untouched");
  });

  it("5: saving writes the canonical token, never a localized label", () => {
    // A coach-selected friendly label must not be persisted as the stored value.
    const labeled = applyTrainingSupervision(fullProfile(), "By myself");
    assert.equal(labeled?.trainingSupervision, "", "a localized label is rejected, not stored");
    const canonical = applyTrainingSupervision(fullProfile(), "alone");
    assert.equal(canonical?.trainingSupervision, "alone", "canonical token is stored");
  });

  it("6: saving unrelated modal fields preserves trainingSupervision", () => {
    const withSupervision = applyTrainingSupervision(fullProfile(), "mixed");
    assert.equal(withSupervision?.trainingSupervision, "mixed", "mixed survives the first merge");
    // A later modal save (e.g. trainingExperience changes) must not erase it.
    const reMerged = applyTrainingSupervision(withSupervision ?? null, "coach");
    assert.equal(reMerged?.trainingSupervision, "coach");
    assert.equal(reMerged?.experience.level, "Beginner", "unrelated flat-mapped field preserved");
  });

  it("7: saving supervision preserves structured fields not exposed by the modal", () => {
    const before = fullProfile();
    const merged = applyTrainingSupervision(before, "alone");
    assert.ok(merged);
    assert.equal(merged.trainingSupervision, "alone");
    // Fields the coach modal does not display must survive byte-identical.
    assert.deepEqual(merged.preferences.liked, before.preferences.liked);
    assert.deepEqual(merged.preferences.disliked, before.preferences.disliked);
    assert.deepEqual(merged.preferences.style, before.preferences.style);
    assert.deepEqual(merged.recovery, before.recovery);
    assert.deepEqual(merged.motivation, before.motivation);
    assert.deepEqual(merged.nutrition, before.nutrition);
    assert.deepEqual(merged.measurements, before.measurements);
    assert.deepEqual(merged.lifestyle, before.lifestyle);
    assert.equal(merged.openNote, before.openNote);
    assert.deepEqual(merged.confidence, before.confidence);
  });

  it("8: isSoloBeginner reads the saved value correctly", () => {
    const beginner = applyTrainingSupervision(fullProfile(), "alone");
    assert.ok(beginner && isSoloBeginner(beginner), "Beginner + alone → solo-beginner rules active");
    const mixed = applyTrainingSupervision(fullProfile(), "mixed");
    assert.ok(mixed && isSoloBeginner(mixed), "Beginner + mixed → active");
    const coached = applyTrainingSupervision(fullProfile(), "coach");
    assert.ok(coached && !isSoloBeginner(coached), "Beginner + coach → inactive");
  });

  it("a legacy client with no structured profile gets one only when a real value is chosen", () => {
    // No structured profile yet + empty value → nothing is synthesized.
    assert.equal(applyTrainingSupervision(null, ""), null, "empty value on legacy client → no profile created");
    // No structured profile + a real canonical token → a minimal profile is synthesized.
    const created = applyTrainingSupervision(null, "mixed");
    assert.equal(created?.trainingSupervision, "mixed", "real value synthesizes a structured profile");
  });
});
