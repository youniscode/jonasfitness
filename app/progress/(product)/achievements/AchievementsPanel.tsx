"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProgressLang } from "../progress-lang";
import { milestoneTitle, progressLocale } from "../progress-text";
import type { MilestoneEvaluation } from "../../../lib/progress-milestones";

async function fetchEvaluation(): Promise<MilestoneEvaluation> {
  const response = await fetch("/api/progress/achievements");
  const data = await response.json().catch(() => ({})) as MilestoneEvaluation & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

export default function AchievementsPanel() {
  const { lang, t } = useProgressLang();
  const locale = progressLocale(lang);
  const [evaluation, setEvaluation] = useState<MilestoneEvaluation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchEvaluation()
      .then((data) => { if (!cancelled) setEvaluation(data); })
      .catch(() => { if (!cancelled) setError(t.error); });
    return () => { cancelled = true; };
  }, [t.error]);

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const fmt = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  if (!evaluation && !error) return <section className="progress-base" />;

  const earned = evaluation
    ? [...evaluation.milestones].filter((m) => m.isEarned).sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? ""))
    : [];
  const next = evaluation
    ? [...evaluation.milestones].filter((m) => !m.isEarned).sort((a, b) => (a.threshold - a.currentValue) - (b.threshold - b.currentValue))
    : [];
  const anyEarned = earned.length > 0;

  return (
    <section className="progress-base">
      <div className="progress-dash-head"><div><p>{t.kicker}</p><h1>{t.achievementsTitle}</h1><span>{t.achievementsIntro}</span></div></div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      {evaluation && (
        <>
          <div className="progress-motivation-stats">
            <article><small>{t.currentStreak}</small><strong>{evaluation.motivation.currentStreakWeeks}</strong><span>{evaluation.motivation.currentStreakWeeks === 1 ? t.weekWord : t.weekWordPlural}</span></article>
            <article><small>{t.longestStreak}</small><strong>{evaluation.motivation.longestStreakWeeks}</strong><span>{evaluation.motivation.longestStreakWeeks === 1 ? t.weekWord : t.weekWordPlural}</span></article>
            <article><small>{t.thisMonth}</small><strong>{evaluation.motivation.workoutsThisMonth}</strong><span>{evaluation.motivation.workoutsThisMonth === 1 ? t.workoutWord : t.workoutWordPlural}</span></article>
          </div>

          {!anyEarned ? (
            <div className="progress-empty"><strong>{t.achievementsEmptyTitle}</strong><span>{t.achievementsEmptyHint}</span><Link className="progress-cta" href="/progress/routines">{t.createRoutine}<span>→</span></Link></div>
          ) : (
            <div className="progress-achievements-grid">
              <section className="progress-panel">
                <div className="progress-panel-head"><div><p>{t.earned}</p></div></div>
                <div className="progress-milestone-list">
                  {earned.map((milestone) => (
                    <div key={milestone.id} className="progress-milestone-card">
                      <strong>{milestoneTitle(lang, milestone.id)}</strong>
                      <span>{milestone.earnedAt ? fmtDate(milestone.earnedAt) : ""}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="progress-panel">
                <div className="progress-panel-head"><div><p>{t.nextMilestones}</p></div></div>
                <div className="progress-milestone-list">
                  {next.map((milestone) => (
                    <div key={milestone.id} className="progress-milestone-next">
                      <span><strong>{milestoneTitle(lang, milestone.id)}</strong><small>{fmt(milestone.currentValue)} / {fmt(milestone.threshold)}</small></span>
                      <div className="progress-milestone-bar" role="progressbar" aria-label={`${t.milestoneProgress}: ${fmt(milestone.currentValue)} / ${fmt(milestone.threshold)}`} aria-valuemin={0} aria-valuemax={milestone.threshold} aria-valuenow={Math.min(milestone.currentValue, milestone.threshold)}><i style={{ width: `${milestone.progressPercent}%` }} /></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}