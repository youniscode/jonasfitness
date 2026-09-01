"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdaptiveAction,
  AdaptiveCoachPlan,
  AdaptiveExerciseDecision,
  AdaptivePriority,
  AdaptiveStatus,
} from "../lib/adaptive-coach";

type Client = { id: number; name: string };
type ApplyResponse = {
  draft: { id: number; title: string; status: string } | null;
  applied: Array<{ exerciseName: string; sessionIndex: number; change: string; reason: string }>;
  message?: string;
  error?: string;
};

const emptyPlan: AdaptiveCoachPlan = {
  status: "NO_CHANGE",
  programme: null,
  nextSession: null,
  exerciseDecisions: [],
  sessionDecisions: [],
  programmeSignals: [],
  summary: { keepCount: 0, progressCount: 0, regressCount: 0, replaceCount: 0, reviewCount: 0, completedWorkouts: 0, highPriority: 0, mediumPriority: 0, lowPriority: 0, infoPriority: 0 },
};

function actionBadge(action: AdaptiveAction): { label: string; tone: "keep" | "progress" | "regress" | "replace" | "review" } {
  if (action === "increase_load" || action === "add_set") return { label: "PROGRESS", tone: "progress" };
  if (action === "reduce_load" || action === "remove_set") return { label: "REGRESS", tone: "regress" };
  if (action === "replace") return { label: "REPLACE", tone: "replace" };
  if (action === "review" || action === "adjust_rep_target" || action === "adjust_rir_target") return { label: "REVIEW", tone: "review" };
  return { label: "KEEP", tone: "keep" };
}

function priorityBadge(priority: AdaptivePriority): { label: string; tone: "high" | "medium" | "low" | "info" } {
  if (priority === "high") return { label: "HIGH PRIORITY", tone: "high" };
  if (priority === "medium") return { label: "MEDIUM PRIORITY", tone: "medium" };
  if (priority === "low") return { label: "LOW PRIORITY", tone: "low" };
  return { label: "INFO", tone: "info" };
}

function isApplicable(action: AdaptiveAction): boolean {
  return ["increase_load", "reduce_load", "add_set", "remove_set", "replace"].includes(action);
}

function isKeep(action: AdaptiveAction): boolean {
  return action === "keep" || action === "keep_load";
}

function isReview(action: AdaptiveAction): boolean {
  return action === "review" || action === "adjust_rep_target" || action === "adjust_rir_target";
}

function statusLabel(status: AdaptiveStatus): { label: string; tone: string } {
  if (status === "ADAPTATION_AVAILABLE") return { label: "ADAPTATION AVAILABLE", tone: "available" };
  if (status === "COACH_REVIEW_REQUIRED") return { label: "COACH REVIEW REQUIRED", tone: "review" };
  return { label: "NO CHANGE SUGGESTED", tone: "none" };
}

function changeSummary(decision: AdaptiveExerciseDecision): string | null {
  const { action, currentPrescription: cur, suggestedPrescription: sug } = decision;
  if (action === "increase_load" || action === "reduce_load") {
    if (sug?.targetWeight != null && cur.targetWeight != null) return `${cur.targetWeight} kg → ${sug.targetWeight} kg`;
    return null;
  }
  if (action === "add_set" || action === "remove_set") {
    if (sug) return `${cur.sets} sets → ${sug.sets} sets`;
    return null;
  }
  if (action === "replace") {
    const name = decision.replacementCandidates?.[0]?.name;
    return name ? `Replace with ${name}` : null;
  }
  return null;
}

function evidenceLine(decision: AdaptiveExerciseDecision): string {
  const evidence = decision.evidence;
  const parts: string[] = [`${evidence.completedExposures} exposure${evidence.completedExposures === 1 ? "" : "s"}`];
  if (evidence.averageRir !== null) parts.push(`avg RIR ${evidence.averageRir} / target ${evidence.targetRir}`);
  if (evidence.discomfortCount > 0) parts.push(`${evidence.discomfortCount} discomfort report${evidence.discomfortCount === 1 ? "" : "s"}`);
  if (evidence.performanceTrend !== "insufficient") parts.push(`trend: ${evidence.performanceTrend}`);
  return parts.join(" · ");
}

export default function AdaptiveCoach({ client }: { client: Client }) {
  const [plan, setPlan] = useState<AdaptiveCoachPlan>(emptyPlan);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [showKeeps, setShowKeeps] = useState(false);

  const load = useCallback(async () => {
    if (client.id < 1) { setPlan(emptyPlan); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/adaptive-coach?clientId=${client.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not build the adaptive plan.");
      setPlan((payload.plan as AdaptiveCoachPlan) ?? emptyPlan);
      setSelected(new Set());
      setDraftId(null);
      setShowKeeps(false);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not build the adaptive plan.");
    } finally { setLoading(false); }
  }, [client.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function toggle(decisionId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(decisionId)) next.delete(decisionId);
      else next.add(decisionId);
      return next;
    });
  }

  function selectAllHighPriority() {
    setSelected((current) => {
      const next = new Set(current);
      for (const decision of actionableHighPriority) next.add(decision.decisionId);
      return next;
    });
  }

  async function applyChanges() {
    if (!selected.size) return;
    setApplying(true);
    setError("");
    setNotice("");
    setDraftId(null);
    try {
      const response = await fetch("/api/adaptive-coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id, decisionIds: [...selected] }),
      });
      const payload = await response.json().catch(() => ({})) as ApplyResponse;
      if (!response.ok) throw new Error(payload.error ?? "The changes could not be applied.");
      setNotice(payload.message ?? "Adaptive draft created.");
      setDraftId(payload.draft?.id ?? null);
      window.dispatchEvent(new CustomEvent("jonas-programme-saved", { detail: { clientId: client.id } }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The changes could not be applied.");
    } finally { setApplying(false); }
  }

  if (client.id < 1) return null;

  const badge = statusLabel(plan.status);
  const decisions = plan.exerciseDecisions;
  const meaningful = decisions.filter((decision) => !isKeep(decision.action));
  const actionable = decisions.filter((decision) => isApplicable(decision.action));
  const reviews = decisions.filter((decision) => isReview(decision.action));
  const keeps = decisions.filter((decision) => isKeep(decision.action));
  const actionableHighPriority = actionable.filter((decision) => decision.priority === "high");
  const highCount = actionable.filter((decision) => decision.priority === "high").length;
  const mediumCount = actionable.filter((decision) => decision.priority === "medium").length;
  const lowCount = actionable.filter((decision) => decision.priority === "low").length;
  const changesCount = actionable.length;
  const hasAnything = changesCount > 0 || reviews.length > 0;

  const priorityBreakdown = [
    highCount > 0 ? `${highCount} high priority` : "",
    mediumCount > 0 ? `${mediumCount} medium priority` : "",
    lowCount > 0 ? `${lowCount} low priority` : "",
  ].filter(Boolean).join(" · ");

  return <section className="adaptive-coach" id="adaptive-coach">
    <header className="adaptive-coach-head">
      <div><p>ADAPTIVE COACH</p><h2>What should change next?</h2><span>Deterministic recommendations from completed workouts, feedback and preferences. Nothing changes until you apply it.</span></div>
      <div className="adaptive-coach-actions"><span className={`adaptive-status ${badge.tone}`}>{badge.label}</span><button type="button" className="refresh-button" onClick={() => void load()}>{loading ? "Analysing…" : "Refresh"}</button></div>
    </header>
    {notice && <p className="adaptive-notice">✓ {notice} {draftId !== null && <button type="button" className="adaptive-link-button" onClick={() => document.querySelector("#programmes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review in Programme Builder →</button>}</p>}
    {error && <p className="adaptive-error" role="alert">{error}</p>}
    {!plan.programme ? <div className="adaptive-empty"><strong>No approved programme.</strong><span>Approve a programme before using Adaptive Coach.</span></div> : <>
      <div className="adaptive-overview">
        <strong>{hasAnything ? `${changesCount} adaptation${changesCount === 1 ? "" : "s"} suggested` : "No adaptation needed yet"}</strong>
        {hasAnything && priorityBreakdown ? <span className="adaptive-priority-breakdown">{priorityBreakdown}</span> : <span>{hasAnything ? "Review the suggestions below before applying anything." : "0 changes recommended"}</span>}
        <span className="adaptive-based-on">Based on {plan.summary.completedWorkouts} completed workout{plan.summary.completedWorkouts === 1 ? "" : "s"}</span>
        {plan.trainingContextSummary && plan.trainingContextSummary.items.length > 0 && <div className="adaptive-training-context-summary"><small>TRAINING CONTEXT</small><ul>{plan.trainingContextSummary.items.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      </div>

      {plan.nextSession && <div className="adaptive-next">
        <small>NEXT SESSION</small>
        <strong>{plan.nextSession.sessionName}</strong>
        <span>{plan.nextSession.reason}</span>
        <em>Confidence: {plan.nextSession.confidence.toUpperCase()}</em>
      </div>}

      {meaningful.length > 0 && <div className="adaptive-decisions">
        <h3>RECOMMENDATIONS</h3>
        <div className="adaptive-decision-list">{meaningful.map((decision) => {
          const badgeInfo = actionBadge(decision.action);
          const prio = priorityBadge(decision.priority);
          const applicable = isApplicable(decision.action);
          const checked = selected.has(decision.decisionId);
          const change = changeSummary(decision);
          const prescriptionText = `${decision.currentPrescription.sets}×${decision.currentPrescription.reps}${decision.currentPrescription.targetWeight !== null ? ` · ${decision.currentPrescription.targetWeight} kg` : ""}`;
          return <article className={`adaptive-decision prio-${decision.priority}`} key={decision.decisionId}>
            {applicable && <label className="adaptive-check"><input type="checkbox" checked={checked} onChange={() => toggle(decision.decisionId)} aria-label={`Apply change for ${decision.exerciseName}`} /><span /></label>}
            <div className="adaptive-decision-body">
              <div className="adaptive-decision-title"><div><b>{decision.exerciseName}</b><small>Day {String(decision.sessionIndex + 1).padStart(2, "0")} · {decision.sessionName}</small></div><div className="adaptive-badges"><em className={`adaptive-badge ${badgeInfo.tone}`}>{badgeInfo.label}</em><em className={`adaptive-priority ${prio.tone}`}>{prio.label}</em></div></div>
              {change && <p className="adaptive-prescription">CURRENT <span>{prescriptionText}</span> → SUGGESTED <span>{change}</span></p>}
              {decision.reasons.length > 0 && <p className="adaptive-why">Why: {decision.reasons[0]}</p>}
              <small className="adaptive-confidence">Confidence: {decision.confidence.toUpperCase()} · {evidenceLine(decision)}</small>
              <details className="adaptive-evidence">
                <summary>Evidence &amp; details</summary>
                <ul>
                  {decision.contextReasons && decision.contextReasons.length > 0 && <li className="context-reason"><strong>Training context:</strong> {decision.contextReasons.join(" ")}</li>}
                  {decision.reasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}
                  {decision.concerns.map((concern) => <li key={concern} className="concern">⚠ {concern}</li>)}
                  {decision.evidence.rirSamples.length > 0 && <li>RIR samples (recent → older): {decision.evidence.rirSamples.join(" · ")}</li>}
                  {decision.evidence.repPerformance.averageReps !== null && <li>Reps: avg {decision.evidence.repPerformance.averageReps}, min {decision.evidence.repPerformance.minReps} (target {decision.evidence.repPerformance.repRange})</li>}
                  {decision.evidence.progressionRecommendation && <li>Progression engine: {decision.evidence.progressionRecommendation.action} → {decision.evidence.progressionRecommendation.proposedWeight ?? "-"} kg</li>}
                  {decision.evidence.coachPreference && <li>Coach preference: {decision.evidence.coachPreference}</li>}
                  {decision.evidence.clientPreference && <li>Client feedback: {decision.evidence.clientPreference}</li>}
                  {decision.evidence.onboardingPreference && <li>Onboarding preference: {decision.evidence.onboardingPreference}</li>}
                </ul>
              </details>
              {decision.replacementCandidates && decision.replacementCandidates.length > 0 && <p className="adaptive-alternatives">Alternatives: {decision.replacementCandidates.map((candidate) => candidate.name).join(" · ")}</p>}
            </div>
          </article>;
        })}</div>
      </div>}

      {keeps.length > 0 && <div className="adaptive-keeps">
        <button type="button" className="adaptive-keeps-toggle" onClick={() => setShowKeeps((current) => !current)} aria-expanded={showKeeps}>
          {showKeeps ? "Hide" : "Show"} {keeps.length} unchanged exercise{keeps.length === 1 ? "" : "s"}
        </button>
        {showKeeps && <div className="adaptive-decision-list compact">{keeps.map((decision) => {
          const badgeInfo = actionBadge(decision.action);
          return <article className="adaptive-decision keep-card" key={decision.decisionId}>
            <div className="adaptive-decision-body">
              <div className="adaptive-decision-title"><div><b>{decision.exerciseName}</b><small>{decision.sessionName}</small></div><em className={`adaptive-badge ${badgeInfo.tone}`}>{badgeInfo.label}</em></div>
              <p className="adaptive-why">{decision.reasons[0] ?? "Performance remains within the prescribed range."}</p>
              <small className="adaptive-confidence">Confidence: {decision.confidence.toUpperCase()} · {evidenceLine(decision)}</small>
            </div>
          </article>;
        })}</div>}
      </div>}

      {plan.sessionDecisions.some((session) => session.decision !== "keep_session") && <div className="adaptive-sessions">
        <h3>SESSION SIGNALS</h3>
        <ul>{plan.sessionDecisions.filter((session) => session.decision !== "keep_session").map((session) => <li key={session.sessionIndex}><b>{session.sessionName}</b><span>{session.decision.replace(/_/g, " ")}</span>{session.reasons.map((reason) => <small key={reason}>· {reason}</small>)}</li>)}</ul>
      </div>}

      {plan.programmeSignals.length > 0 && <div className="adaptive-signals">
        <h3>PROGRAMME SIGNALS</h3>
        <ul>{plan.programmeSignals.map((signal) => <li key={signal.kind}><b>{signal.kind.replace(/_/g, " ")}</b><span>{signal.message}</span></li>)}</ul>
      </div>}

      <div className="adaptive-actions">
        <button type="button" className="dark-button" disabled={selected.size === 0 || applying} onClick={() => void applyChanges()}>{applying ? "Applying…" : `Apply selected changes (${selected.size})`}</button>
        {actionableHighPriority.length > 0 && <button type="button" className="ghost-button" onClick={selectAllHighPriority}>Select all high-priority ({actionableHighPriority.length})</button>}
        <button type="button" className="ghost-button" onClick={() => document.querySelector("#programmes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review in Programme Builder</button>
        {changesCount > 0 && <span className="adaptive-hint">Changes are unchecked by default - select what to apply.</span>}
      </div>
    </>}
    <footer className="adaptive-foot">Adaptive Coach is deterministic and advisory - it never publishes to the client. Applied changes become a draft in the Programme Builder for your review.</footer>
  </section>;
}
