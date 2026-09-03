"use client";

// Dev-only Playwright harness for the Dashboard Motivation panel. Mounts the
// exact ProgressDashboard used on /progress inside the exact ProgressShell,
// with the three dashboard APIs mocked at the fetch boundary (no Clerk
// session, no DB). ?seed=empty|some|all varies the derived motivation block.
import { useState } from "react";
import ProgressDashboard from "../../progress/(product)/ProgressDashboard";
import ProgressShell from "../../progress/(product)/ProgressShell";
import "../../progress/progress.css";

type Seed = "empty" | "some" | "all";

function dashboardFixture(seed: Seed) {
  if (seed === "empty") {
    return {
      summary: {
        completedWorkouts: 0,
        completedWorkoutsFourWeeks: 0,
        lastWorkoutAt: null,
        exercisesImproving: 0,
        exercisesTracked: 0,
        recentPRs: [],
        consistencyPercent: null,
      },
      history: { improvingExercises: 0, trackedExercises: 0 },
      motivation: { currentStreakWeeks: 0, longestStreakWeeks: 0, workoutsThisMonth: 0, latestMilestoneId: null },
    };
  }
  if (seed === "some") {
    return {
      summary: {
        completedWorkouts: 9,
        completedWorkoutsFourWeeks: 4,
        lastWorkoutAt: "2026-09-05T09:00:00.000Z",
        exercisesImproving: 5,
        exercisesTracked: 6,
        recentPRs: [{ date: "2026-09-05T09:00:00.000Z", exercise: "Lat pulldown", weight: 75, reps: 8 }],
        consistencyPercent: 100,
      },
      history: { improvingExercises: 5, trackedExercises: 6 },
      motivation: { currentStreakWeeks: 3, longestStreakWeeks: 5, workoutsThisMonth: 8, latestMilestoneId: "first_pb" },
    };
  }
  return {
    summary: {
      completedWorkouts: 42,
      completedWorkoutsFourWeeks: 4,
      lastWorkoutAt: "2026-09-07T09:00:00.000Z",
      exercisesImproving: 8,
      exercisesTracked: 9,
      recentPRs: [
        { date: "2026-09-07T09:00:00.000Z", exercise: "Squat", weight: 140, reps: 5 },
        { date: "2026-09-05T09:00:00.000Z", exercise: "Lat pulldown", weight: 80, reps: 8 },
      ],
      consistencyPercent: 100,
    },
    history: { improvingExercises: 8, trackedExercises: 9 },
    motivation: { currentStreakWeeks: 6, longestStreakWeeks: 9, workoutsThisMonth: 12, latestMilestoneId: "thousand_kg_volume" },
  };
}

function installMockFetch(seed: Seed) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = dashboardFixture(seed);
    if (url.includes("/api/progress/dashboard")) {
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/progress/history")) {
      return new Response(JSON.stringify({ exercises: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/progress/workouts")) {
      return new Response(JSON.stringify({ active: null, history: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
}

export default function ProgressMotivationHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [ready] = useState(() => {
    const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("seed") : null;
    const seed: Seed = requested === "empty" || requested === "some" || requested === "all" ? requested : "some";
    installMockFetch(seed);
    return true;
  });
  if (!ready) return null;
  return (
    <ProgressShell>
      <ProgressDashboard />
    </ProgressShell>
  );
}