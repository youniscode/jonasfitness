"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrainingLoadReport, TrainingLoadSeverity, VolumeTrend } from "../lib/training-load";

type Client = { id: number; name: string };

const emptyReport: TrainingLoadReport = {
  period: { now: new Date(0).toISOString(), currentDays: 7, trendDays: 28 },
  completedWorkouts: 0,
  totalWorkingSets: 0,
  previousWorkingSets: 0,
  volumeTrend: "insufficient_data",
  plannedSessions: null,
  completedSessions: 0,
  missedSessions: 0,
  pendingSessions: 0,
  adherencePercent: null,
  adherenceTrend: "insufficient_data",
  rir: { sampleCount: 0, averageRir: null, medianRir: null, rir0: 0, rir1: 0, rir2: 0, rir3Plus: 0, lowRirPercent: null },
  muscleGroups: [],
  unmappedSets: 0,
  signals: [],
};

function severityLabel(severity: TrainingLoadSeverity): { label: string; tone: string } {
  if (severity === "attention") return { label: "ATTENTION", tone: "attention" };
  if (severity === "review") return { label: "REVIEW", tone: "review" };
  return { label: "INFO", tone: "info" };
}

function trendMark(trend: VolumeTrend): string {
  if (trend === "increasing") return "↗";
  if (trend === "decreasing") return "↘";
  if (trend === "stable") return "→";
  return "—";
}

function deltaText(deltaPercent: number | null, trend: VolumeTrend): string {
  if (deltaPercent === null) return trend === "insufficient_data" ? "no baseline" : "—";
  return `${deltaPercent > 0 ? "+" : ""}${deltaPercent}%`;
}

export default function TrainingLoadRecovery({ client }: { client: Client }) {
  const [report, setReport] = useState<TrainingLoadReport>(emptyReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async () => {
    if (client.id < 1) { setReport(emptyReport); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/training-load?clientId=${client.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not build the training load report.");
      setReport((payload.report as TrainingLoadReport) ?? emptyReport);
      setShowAll(false);
      setShowDetail(false);
      setShowInfo(false);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not build the training load report.");
    } finally { setLoading(false); }
  }, [client.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (client.id < 1) return null;

  const attention = report.signals.filter((signal) => signal.severity === "attention");
  const review = report.signals.filter((signal) => signal.severity === "review");
  const info = report.signals.filter((signal) => signal.severity === "info");
  const hasHistory = report.completedWorkouts > 0 || report.totalWorkingSets > 0;
  const muscles = showAll ? report.muscleGroups : report.muscleGroups.filter((muscle) => muscle.trained);

  return <section className="training-load" id="training-load">
    <header className="training-load-head">
      <div><p>TRAINING LOAD &amp; RECOVERY</p><h2>How much work is the client doing?</h2><span>Deterministic volume, RIR, adherence and recovery signals from completed training. Advisory only — nothing changes automatically.</span></div>
      <button type="button" className="refresh-button" onClick={() => void load()}>{loading ? "Analysing…" : "Refresh"}</button>
    </header>
    {error && <p className="adaptive-error" role="alert">{error}</p>}

    {!hasHistory ? <div className="training-load-empty">
      <strong>Not enough training history yet.</strong>
      <span>Complete workouts to build load and recovery trends.</span>
    </div> : <>
      <div className="training-load-summary">
        <article><small>Last {report.period.currentDays} days</small><strong>{report.completedWorkouts}</strong><span>workout{report.completedWorkouts === 1 ? "" : "s"} completed</span></article>
        <article><small>Working sets</small><strong>{report.totalWorkingSets}</strong><span>{trendMark(report.volumeTrend)} vs previous week</span></article>
        <article><small>Adherence</small><strong>{report.adherencePercent !== null ? `${Math.round(report.adherencePercent)}%` : "—"}</strong><span>{report.completedSessions} completed · {report.missedSessions} missed</span></article>
        <article><small>Average RIR</small><strong>{report.rir.averageRir !== null ? report.rir.averageRir : "—"}</strong><span>{report.rir.lowRirPercent !== null ? `${Math.round(report.rir.lowRirPercent)}% at RIR 0–1` : "no RIR recorded"}</span></article>
      </div>

      {report.completedWorkouts === 1 && report.totalWorkingSets > 0 && <p className="training-load-note">{report.totalWorkingSets} working sets · RIR recorded on {report.rir.sampleCount} set{report.rir.sampleCount === 1 ? "" : "s"}. Not enough history for week-over-week trends.</p>}

      {(attention.length > 0 || review.length > 0) && <div className="training-load-signals">
        <h3>NEEDS REVIEW</h3>
        <ul>
          {[...attention, ...review].map((signal) => {
            const badge = severityLabel(signal.severity);
            return <li key={signal.id} className={`signal-${signal.severity}`}>
              <span className={`signal-severity ${badge.tone}`}>{badge.label}</span>
              <div><b>{signal.title}</b><span>{signal.explanation}</span></div>
            </li>;
          })}
        </ul>
      </div>}

      {muscles.length > 0 && <div className="training-load-muscles">
        <div className="training-load-muscles-head">
          <h3>MUSCLE LOAD</h3>
          {report.muscleGroups.some((muscle) => !muscle.trained) && <button type="button" className="training-load-toggle" onClick={() => setShowAll((current) => !current)} aria-expanded={showAll}>{showAll ? "Show trained only" : "Show all muscle groups"}</button>}
        </div>
        <div className="training-load-muscle-grid">
          {muscles.map((muscle) => <article key={muscle.muscle} className="training-load-muscle">
            <div><b>{muscle.label}</b><span>{trendMark(muscle.trend)} {deltaText(muscle.deltaPercent, muscle.trend)}</span></div>
            <strong>{muscle.currentSets}</strong><small>sets this week</small>
          </article>)}
        </div>
      </div>}

      <div className="training-load-detail">
        <button type="button" className="training-load-toggle" onClick={() => setShowDetail((current) => !current)} aria-expanded={showDetail}>{showDetail ? "Hide" : "View detailed breakdown"}</button>
        {showDetail && <div className="training-load-detail-body">
          <div className="training-load-detail-grid">
            <div>
              <h4>RIR DISTRIBUTION</h4>
              <p>{report.rir.sampleCount} recorded set{report.rir.sampleCount === 1 ? "" : "s"} · median {report.rir.medianRir ?? "—"}</p>
              <p>RIR 0: {report.rir.rir0} · RIR 1: {report.rir.rir1} · RIR 2: {report.rir.rir2} · RIR 3+: {report.rir.rir3Plus}</p>
            </div>
            <div>
              <h4>SCHEDULE</h4>
              <p>{report.plannedSessions !== null ? `${report.completedSessions} of ${report.plannedSessions} planned sessions completed` : "No scheduled-session data in this window"}</p>
              <p>{report.missedSessions} missed · {report.pendingSessions} pending attendance</p>
            </div>
            {report.unmappedSets > 0 && <div>
              <h4>UNMAPPED</h4>
              <p>{report.unmappedSets} completed set{report.unmappedSets === 1 ? "" : "s"} on custom exercises (no muscle mapping).</p>
            </div>}
          </div>
          {info.length > 0 && <div className="training-load-info">
            <button type="button" className="training-load-toggle" onClick={() => setShowInfo((current) => !current)} aria-expanded={showInfo}>{showInfo ? "Hide" : `Show ${info.length} info signal${info.length === 1 ? "" : "s"}`}</button>
            {showInfo && <ul>{info.map((signal) => <li key={signal.id}><b>{signal.title}</b><span>{signal.explanation}</span></li>)}</ul>}
          </div>}
        </div>}
      </div>
    </>}
    <footer className="training-load-foot">Training load is derived analytics for coach review — it never changes a client programme, publishes anything, or makes a medical assessment.</footer>
  </section>;
}
