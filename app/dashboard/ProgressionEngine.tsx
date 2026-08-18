"use client";

import { useCallback, useEffect, useState } from "react";
import ExerciseVisual from "../components/ExerciseVisual";
import type { ProgressionSuggestion } from "../lib/progression";

type Client = { id: number; name: string };
type Payload = {
  programme: { id: number; title: string } | null;
  completedWorkouts: number;
  suggestions: ProgressionSuggestion[];
};

const emptyPayload: Payload = { programme: null, completedWorkouts: 0, suggestions: [] };

function actionLabel(action: ProgressionSuggestion["action"]) {
  if (action === "increase") return "INCREASE LOAD";
  if (action === "decrease") return "REDUCE LOAD";
  return "KEEP LOAD";
}

export default function ProgressionEngine({ client }: { client: Client }) {
  const [data, setData] = useState<Payload>(emptyPayload);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (client.id < 1) { setData(emptyPayload); return; }
    setLoading(true);
    setData(emptyPayload);
    setError("");
    try {
      const response = await fetch(`/api/progression-suggestions?clientId=${client.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not analyse progression.");
      setData(payload as Payload);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not analyse progression.");
    } finally { setLoading(false); }
  }, [client.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function approve(suggestion: ProgressionSuggestion) {
    setApplying(suggestion.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/progression-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id, suggestionId: suggestion.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The recommendation could not be approved.");
      setNotice(payload.message ?? "Target load approved.");
      setData((current) => ({ ...current, suggestions: current.suggestions.filter((item) => item.id !== suggestion.id) }));
      window.dispatchEvent(new CustomEvent("jonas-programme-saved", { detail: { clientId: client.id } }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The recommendation could not be approved.");
    } finally { setApplying(""); }
  }

  if (client.id < 1) return null;

  return <section className="progression-engine" id="progression">
    <header className="progression-heading"><div><p>COACH-APPROVED PROGRESSION</p><h2>Next-load recommendations.</h2><span>Completed reps and RIR create a recommendation. Nothing changes until you approve it.</span></div><button type="button" className="refresh-button" onClick={() => void load()}>{loading ? "Analysing…" : "Refresh"}</button></header>
    {notice && <p className="progression-notice">✓ {notice}</p>}
    {error && <p className="progression-error" role="alert">{error}</p>}
    {!data.programme ? <div className="progression-empty"><strong>No approved programme.</strong><span>Approve a programme before using progression recommendations.</span></div> : data.suggestions.length ? <div className="progression-grid">{data.suggestions.map((suggestion) => <article className={`progression-card ${suggestion.action}`} key={suggestion.id}>
      <ExerciseVisual name={suggestion.exerciseName} imageUrl={suggestion.imageUrl} compact />
      <div className="progression-card-body"><div className="progression-card-title"><div><small>{actionLabel(suggestion.action)} · {suggestion.confidence.toUpperCase()}</small><h3>{suggestion.exerciseName}</h3><span>From {new Date(suggestion.completedAt).toLocaleDateString()} · {suggestion.completedSets} completed sets</span></div><b>{suggestion.change > 0 ? "+" : ""}{suggestion.change} kg</b></div>
        <div className="progression-metrics"><span>Performed<strong>{suggestion.performedWeight} kg</strong></span><span>Avg. reps<strong>{suggestion.averageReps}</strong></span><span>Avg. RIR<strong>{suggestion.averageRir}</strong></span><span>Next load<strong>{suggestion.proposedWeight} kg</strong></span></div>
        <p>{suggestion.reason}</p><div className="progression-prescription"><span>Prescription: {suggestion.repRange} reps · RIR {suggestion.targetRir}</span><span>Current programme load: {suggestion.currentProgrammeWeight === null ? "not set" : `${suggestion.currentProgrammeWeight} kg`}</span></div>
        <button type="button" className="progression-approve" disabled={applying === suggestion.id} onClick={() => void approve(suggestion)}>{applying === suggestion.id ? "Applying…" : `Approve ${suggestion.proposedWeight} kg`} <span>✓</span></button>
      </div>
    </article>)}</div> : !loading && <div className="progression-empty up-to-date"><strong>Programme is up to date.</strong><span>{data.completedWorkouts ? "New recommendations appear after the next eligible completed workout." : `Complete a workout for ${client.name} with weight, reps and RIR to create the first recommendation.`}</span></div>}
    <footer><span>Every approval uses one completed workout only once.</span><a href="#programmes">Review programme →</a></footer>
  </section>;
}
