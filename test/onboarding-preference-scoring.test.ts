import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyProfile,
  initialPreferenceContextFrom,
  onboardingPreferenceConflictNotes,
} from "../app/lib/onboarding-profile.ts";
import {
  ONBOARDING_DISLIKE_PENALTY,
  ONBOARDING_LIKE_BONUS,
  scoreExerciseForClient,
  explainExerciseForClient,
  type ClientFitContext,
} from "../app/lib/exercise-intelligence.ts";
import type { FeedbackExerciseProfile } from "../app/lib/exercise-feedback.ts";

// ---------- Context helpers ----------

const gymContext: ClientFitContext = {
  goal: "Build muscle",
  experience: "beginner",
  equipment: "Full commercial gym",
};

function withInitial(liked: string[], disliked: string[], unsure: string[] = []): ClientFitContext {
  const profile = emptyProfile();
  profile.preferences.liked = liked;
  profile.preferences.disliked = disliked;
  profile.preferences.unsure = unsure;
  return { ...gymContext, initialPreferenceContext: initialPreferenceContextFrom(profile) };
}

const CHEST_PRESS = { libraryId: "builtin-machine-chest-press", name: "Machine chest press" };
const LAT_PULLDOWN = { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" };
const PULL_UP = { libraryId: "builtin-pull-up", name: "Pull-up" };
const BULGARIAN = { libraryId: "builtin-bulgarian-split-squat", name: "Bulgarian split squat" };

function feedbackProfile(overrides: Partial<FeedbackExerciseProfile>): FeedbackExerciseProfile {
  return {
    recentSentiment: null,
    sentimentScore: 0,
    recentComfort: null,
    discomfortCount: 0,
    recentDifficulty: null,
    recentConfidence: null,
    notConfidentCount: 0,
    dislikeCount: 0,
    likeCount: 0,
    feedbackCount: 0,
    latestFeedbackAt: null,
    ...overrides,
  };
}

// ---------- Soft-signal scoring policy ----------

test("onboarding Like modestly raises fit (exact modest bonus, no exclusion)", () => {
  const baseline = scoreExerciseForClient(CHEST_PRESS, gymContext);
  const liked = scoreExerciseForClient(CHEST_PRESS, withInitial(["builtin-machine-chest-press"], []));
  assert.equal(liked.score - baseline.score, ONBOARDING_LIKE_BONUS);
  assert.equal(liked.exclusion, false);
  assert.ok(liked.positives.some((p) => p.includes("Client indicated during onboarding that they like this exercise.")));
  // Never phrased as a coach preference.
  assert.ok(!liked.positives.some((p) => p.includes("Coach")));
});

test("onboarding Dislike modestly lowers fit (exact modest penalty, never exclusion)", () => {
  const baseline = scoreExerciseForClient(BULGARIAN, gymContext);
  const disliked = scoreExerciseForClient(BULGARIAN, withInitial([], ["builtin-bulgarian-split-squat"]));
  assert.equal(baseline.score - disliked.score, ONBOARDING_DISLIKE_PENALTY);
  assert.equal(disliked.exclusion, false);
  assert.ok(disliked.score > 0, "a client dislike never excludes by itself");
  assert.ok(disliked.concerns.some((c) => c.includes("during onboarding they would prefer another exercise")));
});

test("Unsure and Neutral have zero effect on the score", () => {
  const baseline = scoreExerciseForClient(LAT_PULLDOWN, gymContext);
  const unsure = scoreExerciseForClient(LAT_PULLDOWN, withInitial([], [], ["builtin-lat-pulldown"]));
  const neutral = scoreExerciseForClient(LAT_PULLDOWN, withInitial([], []));
  assert.equal(unsure.score, baseline.score);
  assert.equal(neutral.score, baseline.score);
  assert.deepEqual(unsure.concerns, baseline.concerns);
});

test("onboarding Like never overrides the equipment gate (home gym)", () => {
  const homeContext: ClientFitContext = { ...gymContext, equipment: "Home, limited equipment" };
  const baseline = scoreExerciseForClient(CHEST_PRESS, homeContext);
  const liked = scoreExerciseForClient(CHEST_PRESS, { ...withInitial(["builtin-machine-chest-press"], []), equipment: "Home, limited equipment" });
  assert.equal(liked.score, baseline.score, "a positive onboarding like is ignored when the client's equipment penalises the exercise");
});

test("onboarding signals never create coach explicit state", () => {
  const snapshot = initialPreferenceContextFrom(emptyProfile());
  assert.deepEqual(Object.keys(snapshot).sort(), ["disliked", "liked", "unsure"]);
  // The scoring engine sees only the client snapshot — no explicit preferred/avoid.
  const liked = scoreExerciseForClient(CHEST_PRESS, withInitial(["builtin-machine-chest-press"], []));
  assert.ok(!liked.positives.some((p) => p.includes("Coach marked this exercise as preferred")));
});

// ---------- Conflict policy ----------

test("coach Avoid wins over a client onboarding Like (authoritative exclusion)", () => {
  const context: ClientFitContext = {
    ...withInitial(["builtin-pull-up"], []),
    preferenceContext: { explicit: { "builtin-pull-up": "avoid" }, learned: {}, replacements: {} },
  };
  const fit = scoreExerciseForClient(PULL_UP, context);
  assert.equal(fit.score, 0);
  assert.equal(fit.exclusion, true);
});

test("coach Preferred + client Dislike: allowed, boosted, conflict surfaced — never overwritten", () => {
  const profile = emptyProfile();
  profile.preferences.disliked = ["builtin-pull-up"];
  const context: ClientFitContext = {
    ...gymContext,
    initialPreferenceContext: initialPreferenceContextFrom(profile),
    preferenceContext: { explicit: { "builtin-pull-up": "preferred" }, learned: {}, replacements: {} },
  };
  const fit = scoreExerciseForClient(PULL_UP, context);
  assert.equal(fit.exclusion, false, "a client dislike never removes a coach-preferred exercise");
  const baseline = scoreExerciseForClient(PULL_UP, gymContext);
  assert.ok(fit.score > baseline.score, "coach preferred still boosts the score");
  // The conflict is surfaced in the explanation, and the client dislike stays visible.
  const explanation = explainExerciseForClient(PULL_UP, context);
  assert.ok(explanation.watchFor.some((w) => w.includes("initial client preference conflict")));
  assert.ok(explanation.watchFor.some((w) => w.includes("would prefer another exercise")));
  const notes = onboardingPreferenceConflictNotes(profile, { "builtin-pull-up": "preferred" });
  assert.equal(notes.length, 1);
  // The client's dislike is not overwritten by the coach preference.
  assert.deepEqual(initialPreferenceContextFrom(profile).disliked, ["builtin-pull-up"]);
});

test("repeated post-workout feedback outweighs an old onboarding Like", () => {
  const baseline = scoreExerciseForClient(LAT_PULLDOWN, gymContext);
  const staleLike = withInitial(["builtin-lat-pulldown"], []);
  const dislikedFeedback: FeedbackExerciseProfile = feedbackProfile({
    recentSentiment: "disliked",
    sentimentScore: -6,
    dislikeCount: 2,
    feedbackCount: 2,
  });
  const context: ClientFitContext = {
    ...staleLike,
    feedbackContext: { profile: { "builtin-lat-pulldown": dislikedFeedback }, history: {} },
  };
  const fit = scoreExerciseForClient(LAT_PULLDOWN, context);
  assert.ok(fit.score < baseline.score, "actual repeated workout feedback outweighs the old onboarding like");
  assert.equal(fit.exclusion, false);
  assert.ok(fit.concerns.some((c) => c.includes("negative client feedback")));
});

test("coach later marks Preferred while the client disliked it: coach intent is authoritative, client dislike still visible", () => {
  const profile = emptyProfile();
  profile.preferences.disliked = ["builtin-bulgarian-split-squat"];
  const context: ClientFitContext = {
    ...gymContext,
    initialPreferenceContext: initialPreferenceContextFrom(profile),
    preferenceContext: { explicit: { "builtin-bulgarian-split-squat": "preferred" }, learned: {}, replacements: {} },
  };
  const fit = scoreExerciseForClient(BULGARIAN, context);
  assert.equal(fit.exclusion, false);
  const baseline = scoreExerciseForClient(BULGARIAN, gymContext);
  assert.ok(fit.score > baseline.score, "the coach's later explicit preference remains authoritative");
  const explanation = explainExerciseForClient(BULGARIAN, context);
  assert.ok(explanation.watchFor.some((w) => w.includes("would prefer another exercise")), "the client dislike stays visible to the coach");
});
