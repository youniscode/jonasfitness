"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Client = { id: number; name: string; goal: string; sessionsPerWeek: number };
type DurationState = "match" | "under" | "over";
type CoachPayload = {
  draft: Record<string, unknown>;
  estimatedMinutes: number;
  duration: { state: DurationState; expectedMinutes: number; targetMinutes: number | null; overTarget: boolean; underTarget: boolean; differenceMinutes: number };
  validation: { ok: boolean; errors: { field: string; message: string; severity: string }[]; warnings: { field: string; message: string; severity: string }[] };
  design: { recommendedSplit: string; sessionsPerWeek: number; sessionDurationMinutes: number | null; rationale: string[]; priorities: string[]; constraints: string[]; progressionStrategy: string; estimatedSessionDurationMinutes: number; sessionBlueprint?: { name: string; focus: string }[] };
  changeSummary: { dayChanges: { day: string; changes: string[] }[]; weeklyVolume: { area: string; deltaSets: number }[]; durationBefore: number | null; durationAfter: number | null } | null;
  context: Record<string, unknown>;
  generation: { source: "ai" | "fallback"; provider: string; model: string | null; fallbackReason?: string };
  notice: string;
  equipmentNote: string | null;
  quality: {
    state: "ready" | "review";
    checks: { key: string; label: string; ok: boolean; message?: string }[];
    balance: { push: number; pull: number; verticalPull: number; kneeDominant: number; posteriorChain: number; core: number; isolation: number };
    duration: DurationState;
    durationDifferenceMinutes: number;
    warnings: string[];
  };
  published: boolean;
};
type ContextItem = { id: string; label: string; complete: boolean; detail: string; required: boolean };

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function sessionsOf(draft: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(draft.sessions) ? draft.sessions.map(record) : [];
}
function exercisesOf(session: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(session.exercises) ? session.exercises.map(record) : [];
}
function durationLabel(minutes: number | null | undefined) { return minutes ? `~${minutes} min` : "—"; }

export default function JonasCoach({ client, onReady }: { client: Client; onReady?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<CoachPayload | null>(null);
  const [mode, setMode] = useState<"first" | "adapt" | "adjust">("first");
  const [adjustInstruction, setAdjustInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [retryNotice, setRetryNotice] = useState("");
  const [sessionDuration, setSessionDuration] = useState("60");
  const [sessionsOverride, setSessionsOverride] = useState("");
  const [equipmentPreset, setEquipmentPreset] = useState("auto");
  const [equipmentCustom, setEquipmentCustom] = useState("");
  const [avoid, setAvoid] = useState("");
  const [draftGoal, setDraftGoal] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<number | null>(null);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [contextComplete, setContextComplete] = useState(false);
  const [hasApproved, setHasApproved] = useState(false);

  // Load the deterministic context completeness for the selected client.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPayload(null);
      setSavedDraftId(null);
      setHasApproved(false);
      setDraftGoal("");
      setSessionsOverride("");
      setEquipmentPreset("auto");
      setEquipmentCustom("");
      setAvoid("");
      setAdjustInstruction("");
      setContextItems([]);
      setContextComplete(false);
      if (client.id < 1) return;
      let active = true;
      void fetch("/api/coach-context?clientId=" + client.id)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (active && data.profile) { setContextItems(data.items ?? []); setContextComplete(Boolean(data.complete)); setHasApproved(Boolean(data.hasApproved)); } })
        .catch(() => {});
      return () => { active = false; };
    }, 0);
    return () => window.clearTimeout(timer);
  }, [client.id]);

  const sessionCount = sessionsOf(payload?.draft ?? {}).length;
  const errors = payload?.validation.errors.filter((issue) => issue.severity === "error") ?? [];
  const warnings = payload?.validation.warnings ?? [];
  const draftSessions = useMemo(() => sessionsOf(payload?.draft ?? {}), [payload?.draft]);

  async function generate(event: FormEvent<HTMLFormElement> | null) {
    if (event) event.preventDefault();
    if (client.id < 1) { setError("Select a saved client first."); return; }
    // A fresh submit clears retry feedback; a Retry (event === null) keeps the
    // current draft visible and confirms the outcome below.
    if (event) setRetryNotice("");
    setLoading(true); setError(""); setSavedNotice(""); setSavedDraftId(null);
    const goal = draftGoal || client.goal;
    const body = {
      clientId: client.id,
      mode,
      goal,
      sessionsPerWeek: sessionsOverride ? Number(sessionsOverride) : client.sessionsPerWeek,
      sessionDurationMinutes: sessionDuration ? Number(sessionDuration) : null,
      equipment: equipmentPreset === "custom" ? equipmentCustom : equipmentPreset === "auto" ? "" : equipmentPreset,
      avoid,
      instruction: mode === "adjust" ? adjustInstruction : "",
      previousDraft: mode === "adjust" ? payload?.draft : undefined,
    };
    try {
      const response = await fetch("/api/coach-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.blocked) { setError(data.error ?? "Readiness review required."); return; }
        throw new Error(data.error ?? "Jonas Coach couldn't create a valid draft. Try again.");
      }
      setPayload(data as CoachPayload);
      // A retry that lands back on the deterministic fallback shows the coach
      // the retry actually happened (with the reason and a timestamp).
      if (event === null && (data as CoachPayload).generation?.source === "fallback") {
        const reason = (data as CoachPayload).generation?.fallbackReason ?? "unavailable";
        setRetryNotice(`AI retry failed — ${reason} at ${new Date().toLocaleTimeString()}`);
      }
      if (data.duration?.targetMinutes === null && !sessionDuration) setSessionDuration(String(data.design?.sessionDurationMinutes ?? 60));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Jonas Coach couldn't create a valid draft. Try again.");
    } finally { setLoading(false); }
  }

  // Save as a DRAFT first — the coach approves explicitly afterwards.
  async function saveAsDraft() {
    if (!payload || client.id < 1) return;
    setSaving(true); setSavedNotice("");
    try {
      const response = await fetch("/api/programmes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id, title: text(payload.draft.title, `${sessionCount}-day programme`), goal: text(payload.draft.goal, client.goal), sessionsPerWeek: Number(payload.draft.sessionsPerWeek) || client.sessionsPerWeek, content: payload.draft, status: "draft" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save the draft.");
      setSavedDraftId(data.programme?.id ?? null);
      setSavedNotice("Draft saved to the Programme Builder. Review it there, then approve it to publish to the client.");
      window.dispatchEvent(new CustomEvent("jonas-programme-saved", { detail: { clientId: client.id } }));
      onReady?.();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save the draft.");
    } finally { setSaving(false); }
  }

  return <section className="jonas-coach" id="coach-studio">
    <header className="jonas-coach-heading">
      <div><p>JONAS COACH AI</p><h2>Coach with client context.</h2><span>Programme drafts are built from the client&apos;s onboarding, history and limitations — never published until you approve.</span></div>
      <span className="jonas-coach-mode">{mode === "first" ? "FIRST PROGRAMME" : mode === "adapt" ? "ADAPT CURRENT" : "TARGETED ADJUSTMENT"}</span>
    </header>

    {client.id < 1 ? <div className="jonas-coach-empty"><strong>Select a client first.</strong><span>Jonas Coach builds every draft from the client&apos;s real profile.</span></div> : <>
      <div className="jonas-coach-layout">
        <article className="jonas-context">
          <div className="jonas-context-head"><div><p>JONAS COACH CONTEXT</p><h3>What I know about {client.name}</h3></div><span className={contextComplete ? "context-quality complete" : "context-quality"}>{contextComplete ? "COMPLETE" : "MISSING"}</span></div>
          {contextItems.length === 0 ? <p className="jonas-context-loading">Loading client context…</p> : <div className="jonas-context-list">{contextItems.map((item) => <div className={`jonas-context-item ${item.complete ? "done" : ""} ${!item.required ? "optional" : ""}`} key={item.id}><i>{item.complete ? "✓" : "○"}</i><span><b>{item.label}</b><small>{item.detail}</small></span>{!item.required && <em>OPTIONAL</em>}</div>)}</div>}
          <p className="jonas-context-hint">AI sees only coaching context — never email, phone, acquisition or billing data.</p>
        </article>

        <article className="jonas-controls">
          <div className="jonas-controls-head"><p>COACH CONTROLS</p><span>AUTO — defaults come from onboarding</span></div>
          <form className="jonas-controls-form" onSubmit={generate}>
            <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as "first" | "adapt" | "adjust")}><option value="first">Generate first programme</option><option value="adapt">Adapt current programme</option><option value="adjust">Targeted adjustment</option></select></label>
            <label>Goal<input value={draftGoal || client.goal} onChange={(event) => setDraftGoal(event.target.value)} /></label>
            <div className="jonas-controls-pair">
              <label>Sessions / week<input type="number" min="1" max="7" value={sessionsOverride || client.sessionsPerWeek} onChange={(event) => setSessionsOverride(event.target.value)} /></label>
              <label>Target duration (min)<input type="number" min="30" max="120" step="5" value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)} /></label>
            </div>
            <label>Equipment<select value={equipmentPreset} onChange={(event) => setEquipmentPreset(event.target.value)}><option value="auto">Auto — from onboarding</option><option value="Full commercial gym">Full commercial gym</option><option value="Dumbbells">Dumbbells + bench</option><option value="Home">Home / basic equipment</option><option value="Bodyweight">Bodyweight</option><option value="custom">Custom…</option></select></label>
            {equipmentPreset === "custom" && <label>Custom equipment<input value={equipmentCustom} onChange={(event) => setEquipmentCustom(event.target.value)} placeholder="e.g. squat rack + dumbbells" /></label>}
            <label>Avoid exercises<textarea value={avoid} onChange={(event) => setAvoid(event.target.value)} placeholder="Optional — e.g. barbell squats, cable machines, deadlifts…" /></label>
            {mode === "adjust" && <label>Coach instruction<textarea value={adjustInstruction} onChange={(event) => setAdjustInstruction(event.target.value)} placeholder='e.g. "Keep the programme but replace barbell squats with something easier to learn."' required /></label>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="generate" disabled={loading}>{loading ? "Jonas Coach is thinking…" : mode === "first" ? "Generate first programme" : mode === "adapt" ? "Adapt current programme" : "Apply adjustment"}<span>✦</span></button>
          </form>
        </article>
      </div>

      {payload && <div className="jonas-draft">
        <div className="jonas-recommendation">
          <div className="jonas-recommendation-head"><div><p>JONAS COACH RECOMMENDS</p><h3>{payload.design.recommendedSplit}</h3><span>{payload.design.sessionsPerWeek} sessions/week · {durationLabel(payload.design.estimatedSessionDurationMinutes)} per session</span></div>{errors.length === 0 && <div className="jonas-validity"><b className="draft-valid">✓ VALID DRAFT</b>{payload.quality && <b className={payload.quality.state === "ready" ? "quality-ready" : "quality-review"}>{payload.quality.state === "ready" ? "READY FOR COACH REVIEW" : "REVIEW RECOMMENDED"}</b>}</div>}</div>
          {payload.equipmentNote && <div className="jonas-equipment-note" role="note">⚠ {payload.equipmentNote}</div>}
          {payload.design.rationale.map((point, index) => <p key={point}><i>{index + 1}</i><span>{point}</span></p>)}
          {payload.design.constraints.length > 0 && <div className="jonas-constraints"><strong>Constraints</strong>{payload.design.constraints.map((constraint) => <p key={constraint}>⚠ {constraint}</p>)}</div>}
        </div>

        {payload.generation?.source === "fallback" && <div className="jonas-fallback-banner" role="note"><strong>AI generation was unavailable, so Jonas Coach created a safe rules-based draft.</strong><span>Review it before approval{payload.generation?.fallbackReason ? ` (${payload.generation.fallbackReason})` : ""}.</span>{retryNotice && <em className="jonas-retry-notice">↻ {retryNotice}</em>}<button type="button" className="ghost-button" disabled={loading} onClick={() => void generate(null)}>{loading ? "Retrying AI…" : "Retry AI"}</button></div>}

        {errors.length > 0 && <div className="jonas-validation-error" role="alert"><strong>Jonas Coach couldn&apos;t create a valid draft. Try again.</strong>{errors.slice(0, 4).map((issue) => <p key={issue.field}>· {issue.message}</p>)}<button type="button" className="ghost-button" onClick={() => void generate(null)}>Retry</button></div>}

        {errors.length === 0 && <>
          {warnings.length > 0 && <div className="jonas-validation-warning">{warnings.slice(0, 4).map((issue) => <p key={issue.field}>⚠ {issue.message}</p>)}</div>}
          <div className="jonas-duration">
            <div><small>EXPECTED DURATION</small><strong>{durationLabel(payload.estimatedMinutes)}</strong>{payload.duration.targetMinutes ? <span>Client target: {payload.duration.targetMinutes} min</span> : <span>No client target set</span>}</div>
            {payload.duration.targetMinutes && payload.duration.state === "match" && <em className="duration-ok">✓ Fits the {payload.duration.targetMinutes}-minute target.</em>}
            {payload.duration.targetMinutes && payload.duration.state === "under" && <em className="duration-warning">⚠ {durationLabel(payload.estimatedMinutes)} — about {Math.abs(payload.duration.differenceMinutes)} min under your {payload.duration.targetMinutes}-minute target.</em>}
            {payload.duration.targetMinutes && payload.duration.state === "over" && <em className="duration-warning">⚠ {durationLabel(payload.estimatedMinutes)} — about {payload.duration.differenceMinutes} min over target.</em>}
            {!payload.duration.targetMinutes && <em className="duration-ok">✓ No client target set — duration is advisory.</em>}
          </div>

          {payload.quality && <div className="jonas-quality">
            <div className="jonas-quality-head"><p>PROGRAMME QUALITY</p><b className={payload.quality.state === "ready" ? "quality-ready" : "quality-review"}>{payload.quality.state === "ready" ? "READY FOR COACH REVIEW" : "REVIEW RECOMMENDED"}</b></div>
            <ul>{payload.quality.checks.map((check) => <li key={check.key}><i>{check.ok ? "✓" : "⚠"}</i><span><b>{check.label}</b><small>{check.ok ? (check.message ?? "Passed") : (check.message ?? "Review recommended")}</small></span></li>)}</ul>
            <p className="jonas-quality-note">Technical validity and coaching quality are separate — schema validation is authoritative, these are coach-review signals. Not a medical assessment.</p>
          </div>}
          <div className="jonas-draft-sessions">
            <div className="jonas-draft-title"><div><p>JONAS COACH DRAFT</p><h3>{text(payload.draft.title)}</h3></div><span>{sessionCount} SESSIONS</span></div>
            <p className="jonas-overview">{text(payload.draft.overview)}</p>
            {text(payload.draft.progressionStrategy) && <div className="jonas-progression"><b>PROGRESSION</b><p>{text(payload.draft.progressionStrategy)}</p></div>}
            <div className="jonas-session-grid">{draftSessions.map((session, index) => <article className="jonas-session-card" key={`${text(session.name)}-${index}`}>
              <div><span>DAY {String(index + 1).padStart(2, "0")}</span><b>{durationLabel(Number(session.estimatedMinutes))}</b></div>
              <h4>{text(session.name)}</h4><p>{text(session.focus)}</p>
              <ul>{exercisesOf(session).map((exercise, exerciseIndex) => <li key={`${text(exercise.name)}-${exerciseIndex}`}><i>{exerciseIndex + 1}</i><span><b>{text(exercise.name)}</b>{exercise.source === "custom" && <em className="custom-exercise-tag">CUSTOM</em>}<small>{Number(exercise.sets)}×{text(exercise.reps)} · RIR {Number(exercise.rir)} · {Number(exercise.restSeconds)}s rest</small></span></li>)}</ul>
            </article>)}</div>
          </div>

          {payload.changeSummary && <div className="jonas-change-summary"><div className="jonas-change-head"><p>JONAS COACH CHANGES</p></div>
            {payload.changeSummary.dayChanges.map((day) => <div className="jonas-change-day" key={day.day}><strong>{day.day}</strong>{day.changes.map((change) => <p key={change}>· {change}</p>)}</div>)}
            {payload.changeSummary.weeklyVolume.length > 0 && <div className="jonas-change-volume"><strong>WEEKLY VOLUME</strong>{payload.changeSummary.weeklyVolume.map((row) => <p key={row.area}>{row.area}: {row.deltaSets > 0 ? `+${row.deltaSets}` : row.deltaSets} sets</p>)}</div>}
            {(payload.changeSummary.durationBefore || payload.changeSummary.durationAfter) && <div className="jonas-change-duration"><strong>ESTIMATED DURATION</strong><p>{durationLabel(payload.changeSummary.durationBefore)} → {durationLabel(payload.changeSummary.durationAfter)}</p></div>}
          </div>}

          <div className="jonas-draft-actions">
            <button type="button" className="dark-button" disabled={saving} onClick={() => void saveAsDraft()}>{saving ? "Saving…" : "Send to Programme Builder as draft"}</button>
            <button type="button" className="ghost-button" disabled={loading} onClick={() => void generate(null)}>Regenerate draft</button>
            <button type="button" className="ghost-button" onClick={() => { setMode("adjust"); setAdjustInstruction(""); window.scrollTo({ top: document.querySelector("#coach-studio")?.getBoundingClientRect().top, behavior: "smooth" }); }}>Ask Jonas Coach to adjust</button>
          </div>
          {savedNotice && <p className="programme-notice">✓ {savedNotice}</p>}
          {savedDraftId !== null && <p className="jonas-saved-note">Draft saved — approve it in the Programme Builder below to publish to the client portal.</p>}
          <small className="jonas-coach-footnote">AI never publishes a programme. {hasApproved ? "Review, then approve in the Programme Builder." : "This client has no approved programme yet."} Health-related notes always stay coach-reviewed.</small>
        </>}
      </div>}
    </>}
  </section>;
}
