import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareNextMilestones,
  evaluateMilestones,
  MILESTONES,
  nextMilestones,
  type MilestoneId,
  type MilestoneKind,
  type MilestoneState,
} from "../app/lib/progress-milestones.ts";
import type { MotivationSessionRow } from "../app/lib/progress-motivation.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const ROOT = process.cwd();
const TZ = "Europe/Paris";

function exercise(name: string, programmeExerciseId: string, sets: Array<{ weight: number | null; reps: number | null }>): WorkoutExercise {
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

function row(completedAt: string | null, exercises: WorkoutExercise[] = []): MotivationSessionRow {
  return { completedAt, exercises, weightUnit: "kg" };
}

/** Three completed sets in one exercise: a weight-bearing set plus two
 *  completed-but-empty placeholders, so one session = 3 working sets, 0 extra
 *  volume and no accidental PB on the empty rows. */
function threeSets(weight: number | null): WorkoutExercise[] {
  return [exercise("Lat pulldown", "7", [{ weight, reps: weight === null ? null : 1 }, { weight: null, reps: null }, { weight: null, reps: null }])];
}

function stateOf(evaluation: ReturnType<typeof evaluateMilestones>, id: MilestoneId) {
  const milestone = evaluation.milestones.find((m) => m.id === id);
  assert.ok(milestone, `milestone ${id} missing`);
  return milestone;
}

/** Handcrafted milestone state for direct ordering tests (values need not
 *  correspond to a real history; only percent/isEarned/id drive ordering). */
function ms(id: MilestoneId, kind: MilestoneKind, threshold: number, currentValue: number, isEarned: boolean): MilestoneState {
  return {
    id,
    kind,
    threshold,
    currentValue,
    isEarned,
    earnedAt: isEarned ? "2026-08-01T09:00:00.000Z" : null,
    progressPercent: Math.min(100, Math.round((currentValue / threshold) * 100)),
  };
}

// ---------- The task's example progress states ----------

test("example progress states: streak 1/4=25%, PBs 1/5=20%, workouts 2/10=20%, sets 6/100=6%", () => {
  // Two workouts in the current week (2026-W37), each with 3 completed sets:
  // one genuine PB (2 kg beats the 1 kg baseline), volume near zero so the
  // thousand-kg milestone cannot jump the queue.
  const rows = [
    row("2026-09-07T09:00:00.000Z", threeSets(1)), // Mon W37: baseline
    row("2026-09-09T18:00:00.000Z", threeSets(2)), // Wed W37: PB event 1
  ];
  const evaluation = evaluateMilestones(rows, new Date("2026-09-10T12:00:00.000Z"), TZ);
  assert.equal(stateOf(evaluation, "four_week_streak").progressPercent, 25, "live streak 1/4");
  assert.equal(stateOf(evaluation, "five_pbs").progressPercent, 20, "1/5 PBs");
  assert.equal(stateOf(evaluation, "ten_workouts").progressPercent, 20, "2/10 workouts");
  assert.equal(stateOf(evaluation, "hundred_sets").progressPercent, 6, "6/100 sets");
});

test("NEXT list orders the example states by percent: 25%, the tied 20% pair, then 6% and 0%", () => {
  const rows = [
    row("2026-09-07T09:00:00.000Z", threeSets(1)),
    row("2026-09-09T18:00:00.000Z", threeSets(2)),
  ];
  const evaluation = evaluateMilestones(rows, new Date("2026-09-10T12:00:00.000Z"), TZ);
  const next = nextMilestones(evaluation.milestones).map((m) => m.id);
  assert.deepEqual(next, ["four_week_streak", "ten_workouts", "five_pbs", "hundred_sets", "thousand_kg_volume"]);
  assert.equal(next.includes("first_workout"), false, "earned first_workout never appears in NEXT");
  assert.equal(next.includes("first_pb"), false, "earned first_pb never appears in NEXT");
});

test("tied 20% between ten_workouts and five_pbs breaks deterministically by definition order", () => {
  // 2/10 and 1/5 both round to 20%, but their raw gaps differ (8 vs 4), which
  // is exactly why raw remaining amount must never decide the order. Definition
  // order (ten_workouts before five_pbs) wins and is stable on every render.
  const states = [
    ms("five_pbs", "pb_count", 5, 1, false),
    ms("ten_workouts", "workout_count", 10, 2, false),
  ];
  const ordered = [...states].sort(compareNextMilestones).map((m) => m.id);
  assert.deepEqual(ordered, ["ten_workouts", "five_pbs"]);
  const reversed = [...states].reverse().sort(compareNextMilestones).map((m) => m.id);
  assert.deepEqual(reversed, ordered, "tie-break is stable regardless of input order");
});

// ---------- The task's 9/10 vs 1/5 fixture ----------

test("9/10 workouts (90%) appears before 1/5 personal bests (20%) in NEXT", () => {
  // Nine consecutive weekly sessions: session 1 is the weight-1 baseline,
  // session 2 earns the single genuine PB at weight 2, sessions 3-9 regress.
  const monday = (weekOffset: number) => new Date(Date.UTC(2026, 6, 6 + weekOffset * 7)).toISOString();
  const rows = Array.from({ length: 9 }, (_, index) =>
    row(monday(index), [exercise("Lat pulldown", "7", [{ weight: index === 1 ? 2 : 1, reps: 1 }])]),
  );
  const evaluation = evaluateMilestones(rows, new Date("2026-09-01T12:00:00.000Z"), TZ);
  assert.equal(stateOf(evaluation, "ten_workouts").progressPercent, 90, "9/10 workouts");
  assert.equal(stateOf(evaluation, "five_pbs").progressPercent, 20, "1/5 PBs");
  const next = nextMilestones(evaluation.milestones).map((m) => m.id);
  assert.equal(next[0], "ten_workouts", "the 90% milestone leads NEXT");
  assert.ok(next.indexOf("five_pbs") > next.indexOf("ten_workouts"), "10 workouts must appear before 5 personal bests");
  assert.equal(next.includes("four_week_streak"), false, "the already-earned 4-week streak leaves NEXT");
});

// ---------- Tie-break ignores raw remaining amount ----------

test("equal progressPercent with different raw gaps ties on definition order, not gap size", () => {
  // ten_workouts 5/10 = 50% (raw gap 5) vs four_week_streak 2/4 = 50% (raw gap
  // 2). A raw-gap sort would put the streak first; percent + definition order
  // deterministically puts ten_workouts first.
  const states = [
    ms("four_week_streak", "weekly_streak", 4, 2, false),
    ms("ten_workouts", "workout_count", 10, 5, false),
    ms("hundred_sets", "working_sets", 100, 6, false),
    ms("thousand_kg_volume", "volume_kg", 1000, 10, false),
  ];
  const ordered = nextMilestones(states).map((m) => m.id);
  assert.deepEqual(ordered, ["ten_workouts", "four_week_streak", "hundred_sets", "thousand_kg_volume"]);
});

// ---------- Earned milestones never appear in NEXT ----------

test("earned milestones are always excluded from NEXT; all earned leaves it empty", () => {
  const states = MILESTONES.map((m, index) => ms(m.id, m.kind, m.threshold, index % 2 === 0 ? m.threshold : 0, index % 2 === 0));
  const next = nextMilestones(states);
  assert.ok(next.length > 0, "odd-indexed unearned milestones remain");
  for (const milestone of next) assert.equal(milestone.isEarned, false);

  const allEarned = MILESTONES.map((m) => ms(m.id, m.kind, m.threshold, m.threshold, true));
  assert.equal(nextMilestones(allEarned).length, 0);
});

test("identical milestones compare as equal (stable definition order + id fallback)", () => {
  const a = ms("ten_workouts", "workout_count", 10, 5, false);
  const b = ms("ten_workouts", "workout_count", 10, 5, false);
  assert.equal(compareNextMilestones(a, b), 0);
});

test("ordering module files stay free of U+2014 em dashes", () => {
  for (const file of ["app/lib/progress-milestones.ts", "app/progress/(product)/achievements/AchievementsPanel.tsx"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.ok(!source.includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});
