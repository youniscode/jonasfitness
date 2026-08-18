import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInExercises } from "../app/lib/exercise-catalogue.ts";
import {
  appGoalToCanonical,
  applyGoalSelection,
  compactInitialPreferenceSummary,
  emptyProfile,
  initialPreferenceContextFrom,
  onboardingPreferenceConflictNotes,
  parseLeadSecondaryGoals,
  profileFromLead,
  representativeExercises,
  sanitizeProfile,
  type OnboardingProfile,
} from "../app/lib/onboarding-profile.ts";

// ---------- Application → client structured prefill ----------

test("lead structured data transfers into the onboarding profile", () => {
  const profile = profileFromLead({
    goal: "Build muscle",
    experience: "Beginner",
    trainingDays: 3,
    coachingFormat: "Online",
  });
  assert.equal(profile.goals.primary, "Build muscle");
  assert.equal(profile.experience.level, "Beginner");
  assert.equal(profile.schedule.daysPerWeek, 3);
  assert.equal(profile.coaching.coachingFormat, "Online");
  assert.deepEqual(profile.prefillSource, ["goal", "experience", "frequency", "format"]);
});

test("lead experience vocabulary maps semantically onto onboarding levels", () => {
  assert.equal(profileFromLead({ experience: "1–2 years" }).experience.level, "Some experience");
  assert.equal(profileFromLead({ experience: "3–5 years" }).experience.level, "Regular lifter");
  assert.equal(profileFromLead({ experience: "6+ years" }).experience.level, "Advanced");
  assert.equal(profileFromLead({ experience: "Something unknown" }).experience.level, "");
  assert.equal(profileFromLead({ experience: "" }).prefillSource.includes("experience"), false);
});

test("a non-canonical lead goal is preserved as a note, never faked", () => {
  const profile = profileFromLead({ goal: "Run a marathon" });
  assert.equal(profile.goals.primary, "");
  assert.equal(profile.goals.note, "Run a marathon");
});

test("legacy application goal values map onto canonical onboarding values", () => {
  assert.equal(appGoalToCanonical("Build strength"), "Get stronger");
  assert.equal(appGoalToCanonical("Fat loss"), "Lose body fat");
  assert.equal(appGoalToCanonical("General fitness"), "Improve fitness");
  assert.equal(appGoalToCanonical("Build muscle"), "Build muscle");
  assert.equal(appGoalToCanonical("Run a marathon"), "");
  assert.equal(appGoalToCanonical(""), "");
});

test("a legacy single-goal lead prefills primary and stays compatible", () => {
  const profile = profileFromLead({ goal: "Build strength", experience: "Beginner", trainingDays: 3, coachingFormat: "Online" });
  assert.equal(profile.goals.primary, "Get stronger");
  assert.deepEqual(profile.goals.secondary, []);
  assert.deepEqual(profile.prefillSource, ["goal", "experience", "frequency", "format"]);
});

test("lead secondary objectives transfer into profile.goals.secondary", () => {
  const profile = profileFromLead({
    goal: "Build muscle",
    secondaryGoals: ["Get stronger", "Improve fitness"],
    experience: "Beginner",
    trainingDays: 3,
    coachingFormat: "Online",
  });
  assert.equal(profile.goals.primary, "Build muscle");
  assert.deepEqual(profile.goals.secondary, ["Get stronger", "Improve fitness"]);
  assert.ok(profile.prefillSource.includes("goal"));
});

test("lead secondary objectives are canonicalized, deduped and never repeat the primary", () => {
  const profile = profileFromLead({
    goal: "Build muscle",
    secondaryGoals: ["Fat loss", "Build muscle", "General fitness", "Build strength", "Build strength"],
  });
  assert.equal(profile.goals.primary, "Build muscle");
  assert.deepEqual(profile.goals.secondary, ["Lose body fat", "Improve fitness", "Get stronger"]);
});

test("prefilled goals survive sanitization (secondary objectives kept)", () => {
  const prefilled = profileFromLead({ goal: "Build muscle", secondaryGoals: ["Get stronger", "Improve fitness"] });
  const cleaned = sanitizeProfile(JSON.parse(JSON.stringify(prefilled)));
  assert.equal(cleaned.goals.primary, "Build muscle");
  assert.deepEqual(cleaned.goals.secondary, ["Get stronger", "Improve fitness"]);
});

test("parseLeadSecondaryGoals is safe with missing, malformed or junk values", () => {
  assert.deepEqual(parseLeadSecondaryGoals(""), []);
  assert.deepEqual(parseLeadSecondaryGoals("not json"), []);
  assert.deepEqual(parseLeadSecondaryGoals(null), []);
  assert.deepEqual(parseLeadSecondaryGoals(JSON.stringify(["Get stronger", "junk", 42, "Fat loss"])), ["Get stronger", "Lose body fat"]);
  assert.deepEqual(parseLeadSecondaryGoals(JSON.stringify(["Build muscle", "Build muscle"]), "Build muscle"), []);
  assert.deepEqual(parseLeadSecondaryGoals(JSON.stringify(["Get stronger", "Improve fitness", "Return to training", "Improve general health", "Lose body fat", "Build muscle"])).length, 5);
});

// ---------- Multi-goal selection rules (application Step 1) ----------

test("first selected goal becomes primary, later selections become secondary", () => {
  let state = applyGoalSelection({ primary: "", secondary: [] }, "Build muscle");
  assert.deepEqual(state, { primary: "Build muscle", secondary: [] });
  state = applyGoalSelection(state, "Get stronger");
  assert.deepEqual(state, { primary: "Build muscle", secondary: ["Get stronger"] });
  state = applyGoalSelection(state, "Improve fitness");
  assert.deepEqual(state, { primary: "Build muscle", secondary: ["Get stronger", "Improve fitness"] });
});

test("deselecting a secondary goal removes it cleanly", () => {
  const state = applyGoalSelection({ primary: "Build muscle", secondary: ["Get stronger", "Improve fitness"] }, "Get stronger");
  assert.deepEqual(state, { primary: "Build muscle", secondary: ["Improve fitness"] });
});

test("deselecting the primary promotes the earliest secondary deterministically", () => {
  const state = applyGoalSelection({ primary: "Build muscle", secondary: ["Get stronger", "Improve fitness"] }, "Build muscle");
  assert.deepEqual(state, { primary: "Get stronger", secondary: ["Improve fitness"] });
});

test("deselecting the only goal leaves no primary (at least one required for Continue)", () => {
  const state = applyGoalSelection({ primary: "Build muscle", secondary: [] }, "Build muscle");
  assert.deepEqual(state, { primary: "", secondary: [] });
});

test("online coaching is NOT conflated with a home-gym venue", () => {
  const profile = profileFromLead({ coachingFormat: "Online" });
  assert.equal(profile.coaching.coachingFormat, "Online");
  assert.equal(profile.location.venue, "");
  assert.deepEqual(profile.location.equipment, []);
});

test("unknown or out-of-range values stay unanswered (client answers later)", () => {
  const profile = profileFromLead({ goal: "", experience: "", trainingDays: 9, coachingFormat: "Carrier pigeon" });
  assert.equal(profile.goals.primary, "");
  assert.equal(profile.schedule.daysPerWeek, null);
  assert.equal(profile.coaching.coachingFormat, "");
  assert.deepEqual(profile.prefillSource, []);
});

test("prefilled profile survives sanitization (round-trip safe)", () => {
  const prefilled = profileFromLead({ goal: "Build muscle", experience: "Beginner", trainingDays: 4, coachingFormat: "Hybrid" });
  const cleaned = sanitizeProfile(JSON.parse(JSON.stringify(prefilled)));
  assert.equal(cleaned.goals.primary, "Build muscle");
  assert.equal(cleaned.experience.level, "Beginner");
  assert.equal(cleaned.schedule.daysPerWeek, 4);
  assert.equal(cleaned.coaching.coachingFormat, "Hybrid");
  assert.deepEqual(cleaned.prefillSource, ["goal", "experience", "frequency", "format"]);
});

// ---------- Representative exercise selection ----------

test("representative set is bounded between 6 and 12 exercises", () => {
  for (const context of [
    { venue: "Full commercial gym", experience: "Beginner", goal: "Build muscle" },
    { venue: "Home gym", experience: "Never trained", goal: "Lose body fat" },
    {},
  ]) {
    const set = representativeExercises(builtInExercises, context);
    assert.ok(set.length >= 6 && set.length <= 12, `length ${set.length} out of bounds for ${JSON.stringify(context)}`);
  }
});

test("representative set uses canonical built-in ids only", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  const set = representativeExercises(builtInExercises, { venue: "Full commercial gym" });
  for (const exercise of set) {
    assert.ok(ids.has(exercise.id), `non-canonical id ${exercise.id}`);
  }
});

test("home venues swap machine-heavy picks for bodyweight/dumbbell staples", () => {
  const home = representativeExercises(builtInExercises, { venue: "Home, limited equipment" }).map((e) => e.id);
  // A heavy leg machine present in a gym set must not be the only lower-body pick at home.
  assert.ok(!(home.includes("builtin-leg-press") && home.includes("builtin-hack-squat") && !home.some((id) => id === "builtin-goblet-squat" || id === "builtin-reverse-lunge")));
  assert.ok(home.some((id) => id === "builtin-goblet-squat" || id === "builtin-reverse-lunge"), "home set should include bodyweight/dumbbell lower-body staples");
});

test("selection is deterministic for the same context", () => {
  const context = { venue: "Basic-Fit / similar commercial gym", experience: "Beginner", goal: "Build muscle" };
  const first = representativeExercises(builtInExercises, context).map((e) => e.id);
  const second = representativeExercises(builtInExercises, context).map((e) => e.id);
  assert.deepEqual(first, second);
});

// ---------- Onboarding likes/dislikes → CLIENT initial-preference context ----------

function profileWithReactions(liked: string[], disliked: string[], unsure: string[] = []): OnboardingProfile {
  const profile = emptyProfile();
  profile.preferences.liked = liked;
  profile.preferences.disliked = disliked;
  profile.preferences.unsure = unsure;
  return profile;
}

test("likes and dislikes become CLIENT initial-preference signals, never coach preferred/avoid", () => {
  const snapshot = initialPreferenceContextFrom(profileWithReactions(["builtin-leg-press", "builtin-machine-chest-press"], ["builtin-face-pull"]));
  assert.deepEqual(snapshot, {
    liked: ["builtin-leg-press", "builtin-machine-chest-press"],
    disliked: ["builtin-face-pull"],
    unsure: [],
  });
  // The snapshot has no coach explicit state vocabulary at all.
  assert.equal("explicitState" in snapshot, false);
  assert.equal("preferred" in snapshot, false);
  assert.equal("avoid" in snapshot, false);
});

test("neutral and not-sure produce no signals and no penalty", () => {
  const snapshot = initialPreferenceContextFrom(profileWithReactions([], [], ["builtin-hack-squat"]));
  assert.deepEqual(snapshot, { liked: [], disliked: [], unsure: ["builtin-hack-squat"] });
  // Not-sure stays in its own bucket — never a dislike, never a limitation.
  const profile = profileWithReactions([], [], ["builtin-hack-squat"]);
  assert.deepEqual(profile.preferences.disliked, []);
  assert.equal(profile.limitations.status, "");
});

test("invalid ids are never persisted", () => {
  const snapshot = initialPreferenceContextFrom(profileWithReactions(["builtin-leg-press", "some random name"], ["bad id!"]));
  assert.deepEqual(snapshot.liked, ["builtin-leg-press"]);
  assert.deepEqual(snapshot.disliked, []);
});

test("dislike never creates a medical inference or a coach avoid", () => {
  const snapshot = initialPreferenceContextFrom(profileWithReactions([], ["builtin-back-squat"]));
  assert.deepEqual(snapshot.disliked, ["builtin-back-squat"]);
  // A client dislike is a soft signal — not a limitation, not a diagnosis.
  const profile = profileWithReactions([], ["builtin-back-squat"]);
  assert.equal(profile.limitations.status, "");
  assert.equal(profile.limitations.areas.length, 0);
});

test("a like and dislike for the same exercise keeps the dislike (conservative deterministic winner)", () => {
  const snapshot = initialPreferenceContextFrom(profileWithReactions(["builtin-leg-press"], ["builtin-leg-press"]));
  assert.deepEqual(snapshot.liked, []);
  assert.deepEqual(snapshot.disliked, ["builtin-leg-press"]);
});

test("compactInitialPreferenceSummary labels the block as client-reported, names only, PII-free", () => {
  const summary = compactInitialPreferenceSummary(profileWithReactions(["builtin-lat-pulldown"], ["builtin-bulgarian-split-squat"], ["builtin-pull-up"]));
  assert.ok(summary.includes("INITIAL CLIENT EXERCISE PREFERENCES"));
  assert.ok(summary.includes("not coach preference"));
  assert.ok(summary.includes("- Lat pulldown"));
  assert.ok(summary.includes("- Bulgarian split squat"));
  assert.ok(summary.includes("- Pull-up"));
  assert.ok(!summary.includes("Coach prefers"));
  assert.ok(!summary.includes("avoided"));
  assert.equal(compactInitialPreferenceSummary(emptyProfile()), "");
});

test("conflict notes surface coach preferred vs client disliked without overwriting", () => {
  const profile = profileWithReactions([], ["builtin-pull-up"]);
  const notes = onboardingPreferenceConflictNotes(profile, { "builtin-pull-up": "preferred" });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("Coach prefers Pull-up"));
  assert.ok(notes[0].includes("review"));
  // The client's dislike is never converted or removed.
  assert.deepEqual(initialPreferenceContextFrom(profile).disliked, ["builtin-pull-up"]);
  // No conflict when the coach has no explicit state for the exercise.
  assert.deepEqual(onboardingPreferenceConflictNotes(profile, {}), []);
  assert.deepEqual(onboardingPreferenceConflictNotes(profile, null), []);
});

test("coach avoid stays authoritative and is surfaced as such against a client like", () => {
  const profile = profileWithReactions(["builtin-pull-up"], []);
  const notes = onboardingPreferenceConflictNotes(profile, { "builtin-pull-up": "avoid" });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("authoritative"));
});
