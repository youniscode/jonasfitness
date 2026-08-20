"use client";

import { FormEvent, useEffect, useState } from "react";
import { isPositiveInt } from "../lib/query-params";
import {
  TRAINING_SUPERVISIONS,
  supervisionLabelFor,
  type OnboardingProfile,
} from "../lib/onboarding-profile";

type Client = { id: number; name: string };
type Check = { id: string; label: string; required: boolean; complete: boolean; detail: string };
type Intake = { preferredLanguage: string; trainingExperience: string; availability: string; equipment: string; goalsDetail: string; trainingConsiderations: string; readinessReviewedAt: string | null; coachNotes: string };
type ProfileBlock = { section: string; lines: string[] };
type Programme = { id: number; title: string; status: string } | null;
type State = { stage: string; label: string; nextAction: string; missingRequired: string[]; readiness: "noted" | "needs_review" | "ok" };
type Payload = { intake: Intake | null; client: { id: number; name: string; email: string; goal: string; currentWeight: number | null } | null; programme: Programme; state: State; checks: Check[]; summary?: ProfileBlock[]; profile?: OnboardingProfile | null };

const experienceOptions = ["Beginner", "Intermediate", "Advanced", "Experienced"];

function scrollToProgrammes() {
  // Jonas Coach sits directly above the Programme Builder, already loaded with
  // this client — the coach can generate a first programme with one click.
  document.querySelector("#coach-studio")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function OnboardingSummary({ client }: { client: Client }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function responseOk(data: Partial<Payload>): data is Payload {
    return Boolean(data.state && Array.isArray(data.checks));
  }

  useEffect(() => {
    let active = true;
    // Never issue the request before a real client is selected: the panel is
    // mounted with the demo placeholder (id -1) while the roster loads, and
    // the server would answer 400 "Choose a client." for that request.
    if (isPositiveInt(client.id)) {
      void fetch("/api/client-onboarding?clientId=" + client.id)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (active) { if (responseOk(data)) setPayload(data); setLoading(false); } })
        .catch(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [client.id]);

  // The Programme Builder and AI Studio dispatch this when a programme is
  // saved/approved for this client; the panel refreshes so "Ready to train"
  // appears without a manual reload.
  useEffect(() => {
    const refresh = (event: Event) => {
      const clientId = (event as CustomEvent<{ clientId?: number }>).detail?.clientId;
      if (clientId !== client.id || !isPositiveInt(client.id)) return;
      void fetch("/api/client-onboarding?clientId=" + client.id)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (responseOk(data)) setPayload(data); })
        .catch(() => {});
    };
    window.addEventListener("jonas-programme-saved", refresh);
    return () => window.removeEventListener("jonas-programme-saved", refresh);
  }, [client.id]);

  async function markReadinessReviewed() {
    if (!isPositiveInt(client.id)) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/client-onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id, readinessReviewed: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save the review.");
      setPayload((current) => current ? { ...current, intake: data.intake ?? current.intake, state: data.state ?? current.state, checks: data.checks ?? current.checks } : current);
      setNotice("Readiness review recorded. Programme assignment can now proceed.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save the review.");
    } finally { setSaving(false); }
  }

  async function saveOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPositiveInt(client.id)) return;
    setSaving(true);
    setNotice("");
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      clientId: client.id,
      preferredLanguage: form.get("preferredLanguage"),
      trainingExperience: form.get("trainingExperience"),
      trainingSupervision: form.get("trainingSupervision"),
      availability: form.get("availability"),
      equipment: form.get("equipment"),
      goalsDetail: form.get("goalsDetail"),
      trainingConsiderations: form.get("trainingConsiderations"),
      coachNotes: form.get("coachNotes"),
      readinessReviewed: form.get("readinessReviewed") === "on",
    };
    try {
      const response = await fetch("/api/client-onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save the onboarding details.");
      setPayload((current) => current ? { ...current, intake: data.intake ?? current.intake, state: data.state ?? current.state, checks: data.checks ?? current.checks, profile: data.profile ?? current.profile } : current);
      setShowEdit(false);
      setNotice("Onboarding details saved.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save the onboarding details.");
    } finally { setSaving(false); }
  }

  if (client.id < 1 || loading) return null;
  if (!payload) return <section className="coach-onboarding-summary pending" id="onboarding"><div><p>CLIENT ONBOARDING</p><h2>Waiting for {client.name}.</h2><span>Send the client portal link after saving their sign-in email. Their answers will appear here.</span></div><i>○</i></section>;

  const { intake, programme, state, checks } = payload;
  const required = checks.filter((check) => check.required);
  const optional = checks.filter((check) => !check.required);

  return <section className="coach-onboarding-summary" id="onboarding" data-stage={state.stage}>
    <div className="coach-onboarding-head">
      <div><p>ONBOARDING</p><h2>{state.label}.</h2><span>{state.nextAction}</span></div>
      <div className="onboarding-head-actions"><span className="onboarding-lang-pill">{intake?.preferredLanguage.toUpperCase() ?? "—"}</span><button type="button" className="onboarding-edit-button" onClick={() => { setError(""); setNotice(""); setShowEdit(true); }}>Edit onboarding</button></div>
    </div>
    {notice && <p className="onboarding-notice">✓ {notice}</p>}
    {error && <p className="onboarding-error" role="alert">{error}</p>}

    <div className="onboarding-checklist">
      {required.map((check) => <div className={`onboarding-check ${check.complete ? "done" : ""}`} key={check.id}><i>{check.complete ? "✓" : "○"}</i><span><b>{check.label}</b><small>{check.detail}</small></span></div>)}
      {optional.map((check) => <div className={`onboarding-check optional ${check.complete ? "done" : ""}`} key={check.id}><i>{check.complete ? "✓" : "○"}</i><span><b>{check.label}</b><small>{check.detail}</small></span><em>OPTIONAL</em></div>)}
    </div>

    <div className={`onboarding-readiness ${state.readiness === "needs_review" ? "warning" : state.readiness === "ok" ? "clear" : ""}`}>
      <div><p>{state.readiness === "needs_review" ? "READINESS · COACH REVIEW REQUIRED" : "READINESS"}</p>
        {intake?.trainingConsiderations
          ? <span>{intake.trainingConsiderations}</span>
          : <span>No injuries or limitations reported.</span>}
        {state.readiness === "needs_review" && <small>Review these notes before assigning the first programme. Medical clearance may be needed — do not clear a client for training yourself.</small>}
        {state.readiness === "ok" && <small>Reviewed by coach · {intake?.readinessReviewedAt ? new Date(intake.readinessReviewedAt).toLocaleDateString() : ""}</small>}
      </div>
      {state.readiness === "needs_review" && <button type="button" className="onboarding-review-button" disabled={saving} onClick={() => void markReadinessReviewed()}>{saving ? "Saving…" : "Mark readiness reviewed ✓"}</button>}
    </div>

    <div className="onboarding-programme">
      <div><p>PROGRAMME</p>
        {programme ? <><strong>{programme.title}</strong><span>Assigned · live in the client&apos;s portal — the client can start training.</span></>
          : <><strong>Not assigned</strong><span>{state.stage === "ready_for_programme" ? "The client is ready. Generate a first programme with Jonas Coach below, or reuse a saved one." : "The onboarding checklist above must be complete before the first programme."}</span></>}
      </div>
      {!programme && <button type="button" className="onboarding-assign-button" onClick={scrollToProgrammes}>Assign first programme <span>→</span></button>}
    </div>

    <div className="coach-onboarding-notes">
      <div><small>CLIENT PRIORITIES</small><p>{intake?.goalsDetail || "Not captured yet."}</p></div>
      {intake?.trainingConsiderations && <div><small>TRAINING CONSIDERATIONS</small><p>{intake.trainingConsiderations}</p></div>}
    </div>
    {payload.summary && Array.isArray(payload.summary) && (
      <div className="onboarding-survey-summary">{payload.summary.map((block) => block.lines.length > 0 ? <div className="onboarding-survey-block" key={block.section}><small>{block.section.toUpperCase()}</small>{block.lines.map((line) => <p key={line}>{line}</p>)}</div> : null)}</div>
    )}
    <div className="coach-onboarding-notes coach-private-notes"><div><small>COACH NOTES · PRIVATE</small><p>{intake?.coachNotes || "No private coach notes yet."}</p></div><div><small>PROFILE</small><p>{payload.client?.goal || "—"} · {payload.client?.email || "No sign-in email"}{payload.client?.currentWeight ? ` · ${payload.client.currentWeight} kg` : ""}</p></div></div>

    {showEdit && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowEdit(false)}><form className="modal onboarding-form coach-onboarding-form" onSubmit={saveOnboarding} onMouseDown={(event) => event.stopPropagation()}><div className="portal-form-head"><div><p>ONBOARDING · {client.name}</p><h2>Complete the coaching foundations.</h2></div><button type="button" aria-label="Close" onClick={() => setShowEdit(false)}>×</button></div>
      <label>Preferred language<select name="preferredLanguage" defaultValue={intake?.preferredLanguage ?? "fr"}><option value="fr">French</option><option value="en">English</option><option value="ar">Arabic</option></select></label>
      <label>Training experience<select name="trainingExperience" defaultValue={intake?.trainingExperience ?? ""}><option value="" disabled>—</option>{experienceOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Training supervision<select name="trainingSupervision" defaultValue={payload.profile?.trainingSupervision ?? ""}><option value="">—</option>{TRAINING_SUPERVISIONS.map((value) => <option key={value} value={value}>{supervisionLabelFor("en", value)}</option>)}</select></label>
      <label>Availability<textarea name="availability" defaultValue={intake?.availability ?? ""} placeholder="Days, times, time zone…" /></label>
      <label>Equipment / gym access<input name="equipment" defaultValue={intake?.equipment ?? ""} placeholder="Full gym, home dumbbells…" /></label>
      <label>Goal and priorities<textarea name="goalsDetail" defaultValue={intake?.goalsDetail ?? ""} placeholder="What the client wants to build, improve or change." /></label>
      <label>Injuries / limitations<textarea name="trainingConsiderations" defaultValue={intake?.trainingConsiderations ?? ""} placeholder="Current discomfort, limitations, movements to avoid…" /><small>Coach-facing record. The client portal never shows these notes.</small></label>
      <label>Private coach notes<textarea name="coachNotes" defaultValue={intake?.coachNotes ?? ""} placeholder="Fit, objections, context for future programming…" /><small>Never shown to the client.</small></label>
      <label className="onboarding-consent"><input name="readinessReviewed" type="checkbox" defaultChecked={Boolean(intake?.readinessReviewedAt)} /> <span>Readiness reviewed — limitations assessed before programme assignment</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="generate" disabled={saving}>{saving ? "Saving…" : "Save onboarding"}</button>
    </form></div>}
  </section>;
}
