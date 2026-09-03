"use client";

// Dev-only Playwright harness for the Achievements page. Mounts the exact
// AchievementsPanel used on /progress/achievements inside the exact
// ProgressShell, with /api/progress/achievements mocked at the fetch boundary.
// ?seed=empty|mixed varies the derived milestone evaluation.
import { useState } from "react";
import AchievementsPanel from "../../progress/(product)/achievements/AchievementsPanel";
import ProgressShell from "../../progress/(product)/ProgressShell";
import "../../progress/progress.css";

type MilestoneState = {
  id: string;
  kind: string;
  threshold: number;
  currentValue: number;
  isEarned: boolean;
  earnedAt: string | null;
  progressPercent: number;
};

function milestone(id: string, kind: string, threshold: number, currentValue: number, isEarned: boolean, earnedAt: string | null): MilestoneState {
  return { id, kind, threshold, currentValue, isEarned, earnedAt, progressPercent: Math.min(100, Math.round((currentValue / threshold) * 100)) };
}

function evaluationFixture(seed: "empty" | "mixed") {
  const milestones: MilestoneState[] = seed === "empty"
    ? [
        milestone("first_workout", "workout_count", 1, 0, false, null),
        milestone("ten_workouts", "workout_count", 10, 0, false, null),
        milestone("first_pb", "pb_count", 1, 0, false, null),
        milestone("five_pbs", "pb_count", 5, 0, false, null),
        milestone("hundred_sets", "working_sets", 100, 0, false, null),
        milestone("four_week_streak", "weekly_streak", 4, 0, false, null),
        milestone("thousand_kg_volume", "volume_kg", 1000, 0, false, null),
      ]
    : [
        milestone("first_workout", "workout_count", 1, 1, true, "2026-07-06T12:00:00.000Z"),
        milestone("first_pb", "pb_count", 1, 1, true, "2026-07-13T12:00:00.000Z"),
        milestone("ten_workouts", "workout_count", 10, 9, false, null),
        milestone("five_pbs", "pb_count", 5, 2, false, null),
        milestone("hundred_sets", "working_sets", 100, 40, false, null),
        milestone("four_week_streak", "weekly_streak", 4, 3, false, null),
        milestone("thousand_kg_volume", "volume_kg", 1000, 620, false, null),
      ];
  return {
    motivation: seed === "empty"
      ? { currentStreakWeeks: 0, longestStreakWeeks: 0, workoutsThisMonth: 0, completedWorkingSets: 0, canonicalLifetimeVolumeKg: 0 }
      : { currentStreakWeeks: 3, longestStreakWeeks: 6, workoutsThisMonth: 8, completedWorkingSets: 40, canonicalLifetimeVolumeKg: 620 },
    milestones,
    latestMilestoneId: seed === "empty" ? null : "first_pb",
  };
}

function installMockFetch(seed: "empty" | "mixed") {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/progress/achievements")) {
      return new Response(JSON.stringify(evaluationFixture(seed)), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
}

export default function ProgressAchievementsHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [ready] = useState(() => {
    const seed = (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("seed") as "empty" | "mixed" | null)) ?? "mixed";
    installMockFetch(seed === "empty" ? "empty" : "mixed");
    return true;
  });
  if (!ready) return null;
  return (
    <ProgressShell>
      <AchievementsPanel />
    </ProgressShell>
  );
}