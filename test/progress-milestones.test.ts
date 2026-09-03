import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateMilestones, MILESTONES, type MilestoneId } from "../app/lib/progress-milestones.ts";
import { buildDashboardSummary } from "../app/lib/progress-mechanics.ts";
import type { MotivationSessionRow } from "../app/lib/progress-motivation.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const TZ = "Europe/Paris";
const NOW = new Date("2026-09-10T12:00:00.000Z");

function exercise(name: string, programmeExerciseId: string, sets: Array<{ weight: number; reps: number }>): WorkoutExercise {
  return {
    id: `e-${programmeExerciseId}`,
    programmeExerciseId,
    libraryId: "",
    name,
    target: "3×8–12 · RIR 2",
    focus: "",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    restSeconds: 90,
    note: "",
    status: "completed",
    sets: sets.map((s, index) => ({ id: `s-${index}`, target: "8–12", weight: s.weight, reps: s.reps, rir: "2", note: "", status: "completed" })),
  };
}

function row(completedAt: string | null, exercises: WorkoutExercise[] = [], weightUnit = "kg"): MotivationSessionRow {
  return { completedAt, exercises, weightUnit };
}

const LAT = (weight: number, reps = 8) => [exercise("Lat pulldown", "7", [{ weight, reps }])];
const SQUAT = (weight: number, reps = 5) => [exercise("Squat", "9", [{ weight, reps }])];

function stateOf(evaluation: ReturnType<typeof evaluateMilestones>, id: MilestoneId) {
  const milestone = evaluation.milestones.find((m) => m.id === id);
  assert.ok(milestone, `milestone ${id} missing`);
  return milestone;
}

// ---------- Approved set ----------

test("milestone definitions are exactly the seven approved FIRST-50 milestones", () => {
  assert.deepEqual(
    MILESTONES.map((m) => m.id),
    ["first_workout", "ten_workouts", "first_pb", "five_pbs", "hundred_sets", "four_week_streak", "thousand_kg_volume"] satisfies MilestoneId[],
  );
  assert.equal(MILESTONES.length, 7, "the FIRST-50 set is frozen at exactly seven milestones");
});

test("empty history: no milestone earned, zero motivation", () => {
  const evaluation = evaluateMilestones([], NOW, TZ);
  assert.equal(evaluation.motivation.currentStreakWeeks, 0);
  assert.equal(evaluation.motivation.longestStreakWeeks, 0);
  assert.equal(evaluation.motivation.workoutsThisMonth, 0);
  assert.equal(evaluation.motivation.completedWorkingSets, 0);
  assert.equal(evaluation.motivation.canonicalLifetimeVolumeKg, 0);
  assert.equal(evaluation.latestMilestoneId, null);
  for (const milestone of evaluation.milestones) {
    assert.equal(milestone.isEarned, false);
    assert.equal(milestone.earnedAt, null);
    assert.equal(milestone.progressPercent, 0);
  }
});

// ---------- Workout-count milestones + earnedAt ----------

test("first workout earned at its own completedAt; 9 workouts do not earn 10", () => {
  const one = evaluateMilestones([row("2026-09-01T09:00:00.000Z", LAT(70))], NOW, TZ);
  assert.equal(stateOf(one, "first_workout").isEarned, true);
  assert.equal(stateOf(one, "first_workout").earnedAt, "2026-09-01T09:00:00.000Z");
  assert.equal(stateOf(one, "ten_workouts").isEarned, false);
  assert.equal(stateOf(one, "ten_workouts").currentValue, 1);

  const nine = Array.from({ length: 9 }, (_, i) => row(`2026-07-0${i + 1}T09:00:00.000Z`, LAT(70)));
  const evaluation = evaluateMilestones(nine, NOW, TZ);
  assert.equal(stateOf(evaluation, "ten_workouts").isEarned, false);
  assert.equal(stateOf(evaluation, "ten_workouts").progressPercent, 90);
});

test("10 workouts earned at the completedAt of the 10th chronological workout", () => {
  const dates = [
    "2026-01-05T09:00:00.000Z", "2026-01-12T09:00:00.000Z", "2026-01-19T09:00:00.000Z", "2026-01-26T09:00:00.000Z",
    "2026-02-02T09:00:00.000Z", "2026-02-09T09:00:00.000Z", "2026-02-16T09:00:00.000Z", "2026-02-23T09:00:00.000Z",
    "2026-03-02T09:00:00.000Z", "2026-03-09T09:00:00.000Z",
  ];
  // Shuffle input order to prove chronology, not array order, decides earnedAt.
  const rows = [dates[9], dates[4], dates[0], dates[7], dates[2], dates[5], dates[1], dates[8], dates[3], dates[6]].map((d) => row(d, LAT(70)));
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "ten_workouts").isEarned, true);
  assert.equal(stateOf(evaluation, "ten_workouts").earnedAt, "2026-03-09T09:00:00.000Z", "earnedAt is the 10th workout, not today");
  assert.equal(stateOf(evaluation, "ten_workouts").currentValue, 10);
});

// ---------- PB milestones: canonical rules ----------

test("first-ever performance is a baseline, never a PB", () => {
  const evaluation = evaluateMilestones([row("2026-09-01T09:00:00.000Z", LAT(70))], NOW, TZ);
  assert.equal(stateOf(evaluation, "first_pb").isEarned, false);
  assert.equal(stateOf(evaluation, "first_pb").currentValue, 0);
  assert.equal(evaluation.motivation.longestStreakWeeks, 1, "streak still counts the baseline week");
});

test("equal and regressing sessions are never PBs; historical best is the guard", () => {
  const rows = [
    row("2026-08-03T09:00:00.000Z", LAT(70)), // baseline
    row("2026-08-10T09:00:00.000Z", LAT(75)), // PB event 1
    row("2026-08-17T09:00:00.000Z", LAT(72)), // regression vs 75
    row("2026-08-24T09:00:00.000Z", LAT(75)), // equal to historical best
    row("2026-08-31T09:00:00.000Z", LAT(74)), // better than baseline but below 75
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "first_pb").isEarned, true);
  assert.equal(stateOf(evaluation, "first_pb").earnedAt, "2026-08-10T09:00:00.000Z");
  assert.equal(stateOf(evaluation, "first_pb").currentValue, 1, "only the 75 session counts");
});

test("multiple qualifying sets of the same exercise in one session count once", () => {
  const rows = [
    row("2026-08-03T09:00:00.000Z", LAT(70)),
    row("2026-08-10T09:00:00.000Z", [exercise("Lat pulldown", "7", [{ weight: 75, reps: 8 }, { weight: 76, reps: 8 }])]),
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "first_pb").currentValue, 1, "one session-exercise = one PB event");
  assert.equal(stateOf(evaluation, "five_pbs").currentValue, 1);
});

test("multiple exercises beating their own baselines in one session are separate events", () => {
  const rows = [
    row("2026-08-03T09:00:00.000Z", [...LAT(70), ...SQUAT(100)]), // baselines
    row("2026-08-10T09:00:00.000Z", [...LAT(75), ...SQUAT(110)]), // two PBs
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "first_pb").currentValue, 2);
  assert.equal(stateOf(evaluation, "five_pbs").currentValue, 2);
});

test("5 personal bests earned at the session of PB event #5", () => {
  const rows = [
    row("2026-06-01T09:00:00.000Z", [...LAT(70), ...SQUAT(100)]), // baselines
    row("2026-06-08T09:00:00.000Z", [...LAT(75), ...SQUAT(105)]), // PB 1, 2
    row("2026-06-15T09:00:00.000Z", [...LAT(80), ...SQUAT(110)]), // PB 3, 4
    row("2026-06-22T09:00:00.000Z", [...LAT(85), ...SQUAT(115)]), // PB 5, 6
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "five_pbs").isEarned, true);
  assert.equal(stateOf(evaluation, "five_pbs").currentValue, 6);
  assert.equal(stateOf(evaluation, "five_pbs").earnedAt, "2026-06-22T09:00:00.000Z", "PB event #5 (the lat session) happened on 06-22");
});

// ---------- Working sets + volume + streak milestones ----------

test("100 working sets earned at the session where the cumulative count crosses 100", () => {
  const manySets = (weight: number, reps: number) => exercise("Lat pulldown", "7", Array.from({ length: 10 }, () => ({ weight, reps })));
  const rows = [
    row("2026-08-01T09:00:00.000Z", [manySets(50, 10)]), // 10 sets
    row("2026-08-15T09:00:00.000Z", [manySets(50, 10)]), // 20
    row("2026-08-29T09:00:00.000Z", [manySets(50, 10)]), // 30
    row("2026-09-05T09:00:00.000Z", [manySets(50, 10)]), // 40
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "hundred_sets").isEarned, false, "40 < 100");
  assert.equal(stateOf(evaluation, "hundred_sets").currentValue, 40);
  assert.equal(stateOf(evaluation, "hundred_sets").progressPercent, 40);

  const crossing = [
    row("2026-08-01T09:00:00.000Z", [manySets(50, 10)]), // 10
    row("2026-08-08T09:00:00.000Z", [manySets(50, 10)]), // 20
    row("2026-08-15T09:00:00.000Z", [manySets(50, 10)]), // 30
    row("2026-08-22T09:00:00.000Z", [manySets(50, 10)]), // 40
    row("2026-08-29T09:00:00.000Z", [manySets(50, 10)]), // 50
    row("2026-09-05T09:00:00.000Z", [manySets(50, 10)]), // 60
    row("2026-09-12T09:00:00.000Z", [manySets(50, 10)]), // 70
    row("2026-09-19T09:00:00.000Z", [manySets(50, 10)]), // 80
    row("2026-09-26T09:00:00.000Z", [manySets(50, 10)]), // 90
    row("2026-10-03T09:00:00.000Z", [manySets(50, 10)]), // 100 -> earned here
  ];
  const crossed = evaluateMilestones(crossing, NOW, TZ);
  assert.equal(stateOf(crossed, "hundred_sets").isEarned, true);
  assert.equal(stateOf(crossed, "hundred_sets").earnedAt, "2026-10-03T09:00:00.000Z");
});

test("1,000 kg canonical volume earned on the mixed-unit session that crosses the threshold", () => {
  const rows = [
    row("2026-08-01T09:00:00.000Z", [exercise("Squat", "9", [{ weight: 120, reps: 5 }])], "kg"), // 600 kg
    row("2026-08-08T09:00:00.000Z", [exercise("Bench", "4", [{ weight: 200, reps: 5 }])], "lb"), // 1000 lb = 453.59237 kg -> 1053.59 cumulative
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(evaluation.motivation.canonicalLifetimeVolumeKg, Math.round(1053.59237 * 10) / 10);
  assert.equal(stateOf(evaluation, "thousand_kg_volume").isEarned, true);
  assert.equal(stateOf(evaluation, "thousand_kg_volume").earnedAt, "2026-08-08T09:00:00.000Z", "earned on the lb session after canonical normalization");
  assert.equal(stateOf(evaluation, "thousand_kg_volume").currentValue, 1053.6);

  const justUnder = evaluateMilestones([row("2026-08-01T09:00:00.000Z", [exercise("Squat", "9", [{ weight: 120, reps: 5 }])], "kg")], NOW, TZ);
  assert.equal(stateOf(justUnder, "thousand_kg_volume").isEarned, false);
});

test("4-week training streak earned at the first workout of the fourth consecutive week", () => {
  const rows = [
    row("2026-08-17T09:00:00.000Z", LAT(70)), // Mon W34
    row("2026-08-24T09:00:00.000Z", LAT(70)), // Mon W35
    row("2026-08-31T09:00:00.000Z", LAT(70)), // Mon W36
    row("2026-09-07T09:00:00.000Z", LAT(70)), // Mon W37
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "four_week_streak").isEarned, true);
  assert.equal(stateOf(evaluation, "four_week_streak").earnedAt, "2026-09-07T09:00:00.000Z", "the W37 session completes week 4");
  assert.equal(stateOf(evaluation, "four_week_streak").currentValue, 4);

  const three = evaluateMilestones(rows.slice(0, 3), NOW, TZ);
  assert.equal(stateOf(three, "four_week_streak").isEarned, false);
  assert.equal(stateOf(three, "four_week_streak").progressPercent, 75);
});

test("4-week streak uses Paris weeks: Sunday-evening UTC sessions count as Monday in Paris", () => {
  const rows = [
    row("2026-08-17T09:00:00.000Z", LAT(70)), // Mon W34
    row("2026-08-24T09:00:00.000Z", LAT(70)), // Mon W35
    row("2026-08-31T09:00:00.000Z", LAT(70)), // Mon W36
    row("2026-09-06T22:30:00.000Z", LAT(70)), // Mon 00:30 Paris => W37
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "four_week_streak").isEarned, true);
});

test("a missed week never earns the 4-week streak", () => {
  const rows = [
    row("2026-08-17T09:00:00.000Z", LAT(70)), // W34
    row("2026-08-24T09:00:00.000Z", LAT(70)), // W35
    row("2026-08-31T09:00:00.000Z", LAT(70)), // W36
    row("2026-09-14T09:00:00.000Z", LAT(70)), // Mon W38 (W37 missed)
  ];
  const now = new Date("2026-09-17T12:00:00.000Z"); // Thu W38
  const evaluation = evaluateMilestones(rows, now, TZ);
  assert.equal(stateOf(evaluation, "four_week_streak").isEarned, false, "the W37 gap resets the run");
  assert.equal(stateOf(evaluation, "four_week_streak").currentValue, 1, "only the W38 run remains");
});

// ---------- PB parity with the Dashboard walk ----------

test("PARITY: milestone PB count equals the Dashboard recentPRs count on identical histories", () => {
  const histories: Array<MotivationSessionRow[]> = [
    [row("2026-08-03T09:00:00.000Z", [...LAT(70), ...SQUAT(100)])],
    [
      row("2026-08-03T09:00:00.000Z", [...LAT(70), ...SQUAT(100)]),
      row("2026-08-10T09:00:00.000Z", [...LAT(75), ...SQUAT(105)]),
    ],
    [
      row("2026-08-03T09:00:00.000Z", [...LAT(70), ...SQUAT(100)]),
      row("2026-08-10T09:00:00.000Z", [...LAT(75), ...SQUAT(105)]),
      row("2026-08-17T09:00:00.000Z", [...LAT(72), ...SQUAT(110)]),
      row("2026-08-24T09:00:00.000Z", [...LAT(75), ...SQUAT(112)]),
    ],
    [
      row("2026-08-03T09:00:00.000Z", [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }, { weight: 80, reps: 3 }])]),
      row("2026-08-10T09:00:00.000Z", [exercise("Lat pulldown", "7", [{ weight: 75, reps: 8 }, { weight: 76, reps: 8 }])]),
    ],
    // Active/discarded placeholders (null completedAt) never contribute either way.
    [
      row("2026-08-03T09:00:00.000Z", [...LAT(70)]),
      row(null, [...LAT(200)]),
      row("2026-08-10T09:00:00.000Z", [...LAT(75)]),
    ],
  ];
  for (const history of histories) {
    const milestonePbCount = evaluateMilestones(history, NOW, TZ).milestones.find((m) => m.id === "first_pb")!.currentValue;
    const dashboardPbCount = buildDashboardSummary(history as never, NOW).recentPRs.length;
    assert.equal(milestonePbCount, dashboardPbCount, "one PB definition: milestone count must equal the Dashboard walk");
  }
});

test("first_pb earnedAt equals the Dashboard's first recentPR date", () => {
  const history = [
    row("2026-08-03T09:00:00.000Z", LAT(70)),
    row("2026-08-10T09:00:00.000Z", LAT(75)),
  ];
  const evaluation = evaluateMilestones(history, NOW, TZ);
  const dashboardPrs = buildDashboardSummary(history as never, NOW).recentPRs;
  assert.equal(dashboardPrs.length, 1);
  assert.equal(stateOf(evaluation, "first_pb").earnedAt, dashboardPrs[0].date, "earnedAt must be the genuine first PB session");
});

// ---------- latestMilestone ----------

test("latestMilestone is the most recently earned milestone", () => {
  const rows = [
    row("2026-01-05T09:00:00.000Z", [...LAT(70), ...SQUAT(100)]), // first workout
    row("2026-01-12T09:00:00.000Z", [...LAT(75)]), // first PB
  ];
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(evaluation.latestMilestoneId, "first_pb", "the newer milestone wins");
  assert.equal(stateOf(evaluation, "first_workout").earnedAt, "2026-01-05T09:00:00.000Z");
});

// ---------- Progress percent + copy guard ----------

test("progressPercent is capped at 100 and rounded", () => {
  const rows = Array.from({ length: 3 }, (_, i) => row(`2026-08-0${i + 1}T09:00:00.000Z`, LAT(70)));
  const evaluation = evaluateMilestones(rows, NOW, TZ);
  assert.equal(stateOf(evaluation, "ten_workouts").progressPercent, 30);
  assert.equal(stateOf(evaluation, "first_workout").progressPercent, 100);
});

test("milestone module files stay free of U+2014 em dashes", () => {
  for (const file of ["app/lib/progress-motivation.ts", "app/lib/progress-milestones.ts"]) {
    assert.ok(!read(file).includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});