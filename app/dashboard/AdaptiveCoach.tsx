"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdaptiveAction,
  AdaptiveCoachPlan,
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
  summary: { keepCount: 0, progressCount: 0, regressCount: 0, replaceCount: 0, reviewCount: 0, completedWorkouts: 0 },
};

function actionBadge(action: AdaptiveAction): { label: string; tone: "keep" | "progress" | "regress" | "replace" | "review" } {
  if (action === "increase_load" || action === "add_set") return { label: "PROGRESS", tone: "progress" };
  if (action === "reduce_load" || action === "remove_set") return { label: "REGRESS", tone: "regress" };
  if (action === "replace") return { label: "REPLACE", tone: "replace" };
  if (action === "review" || action === "adjust_rep_target" || action === "adjust_rir_target") return { label: "REVIEW", tone: "review" };
  return { label: "KEEP", tone: "keep" };
}

function isApplicable(action: AdaptiveAction): boolean {
  return ["increase_load", "reduce_load", "add_set", "remove_set", "replace"].includes(action);
}

function statusLabel(status: AdaptiveStatus): { label: string; tone: string } {
  if (status === "ADAPTATION_AVAILABLE") return { label: "ADAPTATION AVAILABLE", tone: "available" };
  if (status === "COACH_REVIEW_REQUIRED") return { label: "COACH REVIEW REQUIRED", tone: "review" };
  return { label: "NO CHANGE SUGGESTED", tone: "none" };
}

export default function AdaptiveCoach({ client }: { client: Client }) {
  const [plan, setPlan] = useState<AdaptiveCoachPlan>(emptyPlan);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);

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
  const applicableCount = plan.exerciseDecisions.filter((decision) => isApplicable(decision.action)).length;

  return <section className="adaptive-coach" id="adaptive-coach">
    <header className="adaptive-coach-head">
      <div><p>ADAPTIVE COACH</p><h2>What should change next?</h2><span>Deterministic recommendations from completed workouts, feedback and preferences. Nothing changes until you apply it.</span></div>
      <div className="adaptive-coach-actions"><span className={`adaptive-status ${badge.tone}`}>{badge.label}</span><button type="button" className="refresh-button" onClick={() => void load()}>{loading ? "Analysing…" : "Refresh"}</button></div>
    </header>
    {notice && <p className="adaptive-notice">✓ {notice} {draftId !== null && <button type="button" className="adaptive-link-button" onClick={() => document.querySelector("#programmes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review in Programme Builder →</button>}</p>}
    {error && <p className="adaptive-error" role="alert">{error}</p>}
    {!plan.programme ? <div className="adaptive-empty"><strong>No approved programme.</strong><span>Approve a programme before using Adaptive Coach.</span></div> : <>
      <div className="adaptive-summary"><span>{plan.summary.completedWorkouts} completed workout{plan.summary.completedWorkouts === 1 ? "" : "s"}</span><span>{plan.summary.keepCount} keep</span><span>{plan.summary.progressCount} progress</span><span>{plan.summary.regressCount} regress</span><span>{plan.summary.replaceCount} replace</span><span>{plan.summary.reviewCount} review</span></div>

      {plan.nextSession && <div className="adaptive-next">
        <small>NEXT SESSION</small>
        <strong>{plan.nextSession.sessionName}</strong>
        <span>{plan.nextSession.reason}</span>
        <em>Confidence: {plan.nextSession.confidence.toUpperCase()}</em>
      </div>}

      {plan.exerciseDecisions.length > 0 && <div className="adaptive-decisions">
        <h3>EXERCISE DECISIONS</h3>
        <div className="adaptive-decision-list">{plan.exerciseDecisions.map((decision) => {
          const badgeInfo = actionBadge(decision.action);
          const applicable = isApplicable(decision.action);
          const checked = selected.has(decision.decisionId);
          return <article className="adaptive-decision" key={decision.decisionId}>
            {applicable && <label className="adaptive-check"><input type="checkbox" checked={checked} onChange={() => toggle(decision.decisionId)} aria-label={`Apply change for ${decision.exerciseName}`} /><span /></label>}
            <div className="adaptive-decision-body">
              <div className="adaptive-decision-title"><div><b>{decision.exerciseName}</b><small>Day {String(decision.sessionIndex + 1).padStart(2, "0")} · {decision.sessionName}</small></div><em className={`adaptive-badge ${badgeInfo.tone}`}>{badgeInfo.label}</em></div>
              {decision.action !== "keep" && decision.action !== "keep_load" && decision.suggestedPrescription && <p className="adaptive-prescription">Current: {decision.currentPrescription.sets}×{decision.currentPrescription.reps} · RIR {decision.currentPrescription.rir}{decision.currentPrescription.targetWeight !== null ? ` · ${decision.currentPrescription.targetWeight} kg` : ""}{decision.action === "add_set" || decision.action === "remove_set" ? ` → ${decision.suggestedPrescription.sets} sets` : decision.suggestedPrescription.targetWeight !== null ? ` → ${decision.suggestedPrescription.targetWeight} kg` : ""}</p>}
              {decision.performed && <p className="adaptive-performed">Performed: {decision.performed.completedSets} sets{decision.performed.performedWeight !== null ? ` · ${decision.performed.performedWeight} kg` : ""}{decision.performed.averageReps !== null ? ` · avg ${decision.performed.averageReps} reps` : ""}{decision.performed.averageRir !== null ? ` · RIR ${decision.performed.averageRir}` : ""}</p>}
              {decision.reasons.length > 0 && <p className="adaptive-why">Why: {decision.reasons.join(" ")}</p>}
              {decision.concerns.length > 0 && <p className="adaptive-concerns">⚠ {decision.concerns.join(" ")}</p>}
              {decision.replacementCandidates && decision.replacementCandidates.length > 0 && <p className="adaptive-alternatives">Alternatives: {decision.replacementCandidates.map((candidate) => candidate.name).join(" · ")}</p>}
              <small className="adaptive-confidence">Confidence: {decision.confidence.toUpperCase()} · {decision.exposureCount} exposure{decision.exposureCount === 1 ? "" : "s"}</small>
            </div>
          </article>;
        })}</div>
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
        <button type="button" className="ghost-button" onClick={() => document.querySelector("#programmes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review in Programme Builder</button>
        {applicableCount > 0 && <span className="adaptive-hint">Meaningful changes are unchecked by default — select what to apply.</span>}
      </div>
    </>}
    <footer className="adaptive-foot">Adaptive Coach is deterministic and advisory — it never publishes to the client. Applied changes become a draft in the Programme Builder for your review.</footer>
  </section>;
}
