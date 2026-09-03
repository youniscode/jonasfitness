"use client";

// Dev-only Playwright harness for the mobile-first workout logger. It mounts
// the exact WorkoutLogger used on /progress/workouts/[id] inside the exact
// ProgressShell used on every /progress page (real brand, fixed mobile bottom
// nav, language switcher), with the workout API mocked at the fetch boundary
// so layout tests need no Clerk session or database. Never rendered in
// production builds (NODE_ENV is inlined by Next.js). The fixture mirrors a
// real in-progress session (7 exercises x 3 sets + previous performance) so
// responsive density is verified against the real production components.
// ?short=1 serves a 1-exercise x 2-set session for dead-space checks.
import { useState } from "react";
import WorkoutLogger from "../../progress/(product)/workout/[id]/WorkoutLogger";
import ProgressShell from "../../progress/(product)/ProgressShell";
import "../../progress/progress.css";

type LoggerSet = { id: string; target: string; weight: number | null; reps: number | null; rir: string; note: string; status: "pending" | "completed" | "skipped" };
type LoggerExercise = { id: string; programmeExerciseId: string; name: string; nameFr?: string; nameAr?: string; target: string; focus: string; imageUrl: string; sets: LoggerSet[]; status: string };
type LoggerSession = { id: number; title: string; exercises: LoggerExercise[]; weightUnit: string; notes: string; status: string; startedAt: string; completedAt: string | null };
type LoggerLoaded = { session: LoggerSession; previous: Record<string, { date: string | null; sets: LoggerSet[] }>; priorSets: Record<string, LoggerSet[]> };

const EXERCISE_NAMES = ["Lat pulldown", "Seated cable row", "Straight-arm pulldown", "Barbell row", "Pull-up", "Face pull", "Incline dumbbell curl"];

function workingSets(previous: boolean): LoggerSet[] {
  const previousPerformance = previous ? [[55, 12], [60, 10], [70, 9]] : [];
  return Array.from({ length: 3 }, (_, index) => {
    const [weight, reps] = previousPerformance[index] ?? [null, null];
    return { id: `s-${index}`, target: "8–12", weight, reps, rir: "2", note: "", status: weight === null ? "pending" : "completed" };
  });
}

function fixture(short: boolean): LoggerLoaded {
  const exerciseCount = short ? 1 : 7;
  const session: LoggerSession = {
    id: 101,
    title: "Back + Biceps + Triceps",
    weightUnit: "kg",
    notes: "",
    status: "active",
    startedAt: "2026-09-01T08:00:00.000Z",
    completedAt: null,
    exercises: EXERCISE_NAMES.slice(0, exerciseCount).map((name, index) => ({
      id: `e${index + 1}`,
      programmeExerciseId: `pe${index + 1}`,
      name,
      target: "3×8–12 · RIR 2",
      focus: "Back + Biceps + Triceps",
      imageUrl: "",
      status: "pending",
      sets: workingSets(false),
    })),
  };
  const previous: Record<string, { date: string | null; sets: LoggerSet[] }> = {
    e1: { date: "2026-08-25T08:00:00.000Z", sets: workingSets(true) },
  };
  const priorSets: Record<string, LoggerSet[]> = { e1: workingSets(true) };
  return { session, previous, priorSets };
}

/** Mock server: GET returns the fixture, PATCH echoes the submitted session
 *  exactly like the real save endpoint so autosave keeps working. */
function installMockFetch(short: boolean) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/progress/workouts/")) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const data = fixture(short);
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { exercises?: unknown; notes?: unknown; status?: string };
      const session: LoggerSession = {
        ...data.session,
        exercises: (body.exercises as LoggerExercise[]) ?? data.session.exercises,
        notes: typeof body.notes === "string" ? body.notes : data.session.notes,
        status: body.status === "completed" ? "completed" : body.status === "discarded" ? "discarded" : "active",
      };
      return new Response(JSON.stringify({ session }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  };
}

export default function ProgressLoggerHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [ready] = useState(() => {
    const short = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("short") === "1";
    installMockFetch(short);
    return true;
  });
  if (!ready) return null;
  return (
    <ProgressShell>
      <WorkoutLogger />
    </ProgressShell>
  );
}