"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProgressLang } from "./progress-lang";
import { milestoneTitle, progressLocale } from "./progress-text";
import type { MilestoneId } from "../../lib/progress-milestones";

type Summary = {
  completedWorkouts: number;
  completedWorkoutsFourWeeks: number;
  lastWorkoutAt: string | null;
  exercisesImproving: number;
  exercisesTracked: number;
  recentPRs: Array<{ date: string; exercise: string; weight: number; reps: number }>;
  consistencyPercent: number | null;
};
type Motivation = {
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  workoutsThisMonth: number;
  latestMilestoneId: MilestoneId | null;
};
type HistoryItem = { key: string; name: string; nameFr?: string; nameAr?: string; sessions: number; latestDate: string; records: { heaviestWeight: number; estimatedOneRepMax: number }; trend: { estimatedOneRepMax: number } };
type ActiveSession = { id: number; title: string; startedAt: string; status: string };

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

export default function ProgressDashboard() {
  const { lang, t } = useProgressLang();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [motivation, setMotivation] = useState<Motivation | null>(null);
  const [trends, setTrends] = useState<HistoryItem[]>([]);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [historyMeta, setHistoryMeta] = useState<{ improvingExercises: number; trackedExercises: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dashboard, history, workouts] = await Promise.all([
          json<{ summary: Summary; history: { improvingExercises: number; trackedExercises: number }; motivation: Motivation }>("/api/progress/dashboard"),
          json<{ exercises: HistoryItem[] }>("/api/progress/history"),
          json<{ active: ActiveSession | null; history: unknown }>("/api/progress/workouts"),
        ]);
        if (cancelled) return;
        setSummary(dashboard.summary);
        setMotivation(dashboard.motivation);
        setHistoryMeta(dashboard.history);
        setTrends(history.exercises.slice(0, 6));
        setActive(workouts.active);
      } catch {
        if (!cancelled) setError(t.error);
      }
    })();
    return () => { cancelled = true; };
  }, [t.error]);

  const locale = progressLocale(lang);
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));
  const fmt = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  return (
    <section className="progress-base">
      <div className="progress-dash-head">
        <div>
          <p>{t.kicker}</p>
          <h1>{t.dashboardTitle}</h1>
          <span>{t.dashboardIntro}</span>
        </div>
        <div className="progress-last-session">
          <small>{t.lastSession}</small>
          <strong>{summary?.lastWorkoutAt ? fmtDate(summary.lastWorkoutAt) : t.never}</strong>
        </div>
      </div>

      {error && <p className="progress-error" role="alert">{error}</p>}

      {active && (
        <div className="progress-active-card">
          <div><small>{t.navDashboard}</small><strong>{active.title}</strong><span>{active.startedAt ? t.today : ""}</span></div>
          <div><Link className="progress-cta" href={`/progress/workout/${active.id}`}>{t.resume}<span>→</span></Link></div>
        </div>
      )}

      {summary && (
        <div className="progress-kpi-grid">
          <article><small>{t.workoutsCompleted}</small><strong>{summary.completedWorkouts}</strong><span>{t.workoutsCompletedHint}</span></article>
          <article><small>{t.consistency}</small><strong>{summary.consistencyPercent ?? 0}%</strong><span>{`${summary.completedWorkoutsFourWeeks} / 4 · ${t.consistencyHint}`}</span></article>
          <article className="lime"><small>{t.exercisesImproving}</small><strong>{historyMeta?.improvingExercises ?? 0}</strong><span>{t.exercisesTracked} · {historyMeta?.trackedExercises ?? 0}</span></article>
          <article><small>{t.recentPRs}</small><strong>{summary.recentPRs.length}</strong><span>{t.pr}</span></article>
        </div>
      )}

      {motivation && (
        <div className="progress-motivation">
          <div className="progress-motivation-stats">
            <article><small>{t.currentStreak}</small><strong>{motivation.currentStreakWeeks}</strong><span>{motivation.currentStreakWeeks === 1 ? t.weekWord : t.weekWordPlural}</span></article>
            <article><small>{t.thisMonth}</small><strong>{motivation.workoutsThisMonth}</strong><span>{motivation.workoutsThisMonth === 1 ? t.workoutWord : t.workoutWordPlural}</span></article>
            <article className="name"><small>{t.latestMilestone}</small><strong>{motivation.latestMilestoneId ? milestoneTitle(lang, motivation.latestMilestoneId) : t.noneYet}</strong></article>
          </div>
          <div className="progress-motivation-actions">
            <Link className="progress-ghost" href="/progress/achievements">{t.viewAchievements}<span>→</span></Link>
            <Link className="progress-ghost" href="/progress/bodyweight">{t.bodyweight}<span>→</span></Link>
          </div>
        </div>
      )}

      <div className="progress-dash-grid">
        <section className="progress-panel">
          <div className="progress-panel-head"><div><p>{t.recentTrends}</p><h2>{t.recentTrendsHint}</h2></div><Link href="/progress/history">{t.viewAll} ↔</Link></div>
          {trends.length === 0
            ? <div className="progress-empty"><strong>{t.dashboardEmptyTitle}</strong><span>{t.dashboardEmptyHint}</span><Link className="progress-cta" href="/progress/routines">{t.createRoutine}<span>→</span></Link></div>
            : <div className="progress-trend-list">{trends.map((item) => (
              <Link key={item.key} href={`/progress/history/${encodeURIComponent(item.key)}`} className="progress-trend-row">
                <span><strong>{item.name}</strong><small>{item.sessions} {item.sessions === 1 ? t.session : t.sessions} · {fmtDate(item.latestDate)}</small></span>
                {item.sessions === 1
                  ? <span><b>{t.baseline}</b><small>{t.max} {fmt(item.records.estimatedOneRepMax)} kg</small></span>
                  : <span><b>{item.trend.estimatedOneRepMax >= 0 ? "+" : ""}{fmt(item.trend.estimatedOneRepMax)} kg</b><small>{t.max}</small></span>}
              </Link>
            ))}</div>}
        </section>

        <section className="progress-panel">
          <div className="progress-panel-head"><div><p>{t.recentPRs}</p>{summary && summary.recentPRs.length > 0 && <h2>{t.pr}</h2>}</div></div>
          {summary && summary.recentPRs.length === 0
            ? <div className="progress-empty"><strong>{t.noPBsTitle}</strong><span>{t.noPBsHint}</span></div>
            : <div className="progress-pr-list">{(summary?.recentPRs ?? []).map((pr, index) => (
              <div key={`${pr.date}-${index}`}><span><b>{pr.exercise}</b><small>{fmtDate(pr.date)}</small></span><strong>{fmt(pr.weight)} kg <small>× {pr.reps}</small></strong></div>
            ))}</div>}
        </section>
      </div>
    </section>
  );
}