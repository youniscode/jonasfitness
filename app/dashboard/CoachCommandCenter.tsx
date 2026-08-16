"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Session = { id: number; clientId: number; clientName: string; startAt: string; durationMinutes: number; readinessLevel: "pending" | "green" | "amber" | "red"; readinessScore: number | null; coachAction: string; pulsePath: string };
type Consultation = { id: number; leadId: number; leadName: string; startAt: string; durationMinutes: number; status: string };
type FollowUp = { id: number; name: string; phone: string; email: string; source: string; status: string; nextFollowUpAt: string | null };
type ProgressUpdate = { id: number; clientId: number; clientName: string; weight: number | null; energy: number; sleep: number; adherence: number; notes: string; createdAt: string };
type WorkoutReview = { id: number; clientId: number; clientName: string; title: string; completedAt: string | null; exercises: number; completedSets: number; totalVolume: number };
type ProgressionApproval = { clientId: number; clientName: string; programmeId: number; programmeTitle: string; count: number; first: { exerciseName: string; action: string; proposedWeight: number; performedWeight: number } };
type OnboardingItem = { clientId: number; clientName: string; kind: "readiness_review" | "onboarding_incomplete" | "first_programme"; tone: "amber" | "neutral" | "lime"; eyebrow: string; detail: string; action: string };
type AttendancePending = { id: number; clientId: number; clientName: string; startAt: string; durationMinutes: number };
type LowCredit = { clientId: number; clientName: string; balance: number };
type Payload = {
  generatedAt: string;
  sessions: Session[];
  consultations: Consultation[];
  followUps: FollowUp[];
  progressUpdates: ProgressUpdate[];
  workoutReviews: WorkoutReview[];
  progressionApprovals: ProgressionApproval[];
  onboarding: OnboardingItem[];
  attendancePending: AttendancePending[];
  lowCredits: LowCredit[];
};

const emptyPayload: Payload = { generatedAt: "", sessions: [], consultations: [], followUps: [], progressUpdates: [], workoutReviews: [], progressionApprovals: [], onboarding: [], attendancePending: [], lowCredits: [] };

type QueueItem = {
  key: string;
  tone: "red" | "amber" | "lime" | "neutral";
  eyebrow: string;
  title: string;
  detail: string;
  time: string;
  action: string;
  onOpen: () => void;
  review?: { type: "progress" | "workout"; id: number };
};

function formatWhen(value: string) {
  // The coach operates in Europe/Paris; the command-center clock reflects it.
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value));
}

function relativeTime(value: string | null, now: number) {
  if (!value || !now) return "";
  const minutes = Math.round((new Date(value).getTime() - now) / 60000);
  if (Math.abs(minutes) < 60) return minutes < 0 ? `${Math.abs(minutes)}m overdue` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return hours < 0 ? `${Math.abs(hours)}h overdue` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`;
}

function scrollTo(target: string) {
  document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function CoachCommandCenter({ onSelectClient }: { onSelectClient: (clientId: number, target: string) => void }) {
  const [data, setData] = useState<Payload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState("");
  const [clock, setClock] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/coach-today", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load your command center.");
      setData(payload as Payload);
      setClock(Date.now());
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load your command center.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const refresh = window.setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => { window.clearTimeout(first); window.clearInterval(refresh); };
  }, [load]);

  const now = clock || (data.generatedAt ? new Date(data.generatedAt).getTime() : 0);
  const next24Hours = now + 24 * 60 * 60 * 1000;
  const todaySessions = data.sessions.filter((item) => new Date(item.startAt).getTime() <= next24Hours);
  const todayConsultations = data.consultations.filter((item) => new Date(item.startAt).getTime() <= next24Hours);
  const pulseAlerts = data.sessions.filter((item) => item.readinessLevel === "red" || item.readinessLevel === "amber");
  const lowCreditCount = data.lowCredits.length;
  const reviewCount = data.progressUpdates.length + data.workoutReviews.length + data.progressionApprovals.reduce((total, item) => total + item.count, 0);

  const timeline = useMemo(() => [
    ...data.sessions.map((item) => ({ key: `session-${item.id}`, kind: "SESSION", name: item.clientName, startAt: item.startAt, duration: item.durationMinutes, status: item.readinessLevel.toUpperCase(), tone: item.readinessLevel, open: () => onSelectClient(item.clientId, "#calendar") })),
    ...data.consultations.map((item) => ({ key: `consultation-${item.id}`, kind: "CONSULTATION", name: item.leadName, startAt: item.startAt, duration: item.durationMinutes, status: "BOOKED", tone: "neutral", open: () => scrollTo("#leads") })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 6), [data.consultations, data.sessions, onSelectClient]);

  const queue = useMemo<QueueItem[]>(() => [
    // Attendance pending is the coach's top priority: sessions that ended and
    // still need an explicit completed / cancelled / no-show decision.
    ...data.attendancePending.map((item) => ({
      key: `attendance-${item.id}`, tone: "red" as const, eyebrow: "ATTENDANCE PENDING", title: item.clientName,
      detail: `Session ended ${relativeTime(item.startAt, now)} — record what happened.`, time: relativeTime(item.startAt, now), action: "Record attendance", onOpen: () => onSelectClient(item.clientId, "#calendar"),
    })),
    ...pulseAlerts.map((item) => ({
      key: `pulse-${item.id}`, tone: item.readinessLevel as "red" | "amber", eyebrow: `${item.readinessLevel.toUpperCase()} PULSE`, title: item.clientName,
      detail: item.coachAction || `Readiness ${item.readinessScore ?? "—"}% needs review before training.`, time: formatWhen(item.startAt), action: "Review Pulse", onOpen: () => onSelectClient(item.clientId, "#calendar"),
    })),
    ...data.followUps.map((item) => ({
      key: `follow-${item.id}`, tone: "amber" as const, eyebrow: "LEAD FOLLOW-UP", title: item.name,
      detail: `${item.source} · ${item.status}`, time: relativeTime(item.nextFollowUpAt, now), action: "Open lead", onOpen: () => scrollTo("#leads"),
    })),
    ...data.progressUpdates.map((item) => ({
      key: `progress-${item.id}`, tone: "lime" as const, eyebrow: "NEW CHECK-IN", title: item.clientName,
      detail: `${item.weight ? `${item.weight} kg · ` : ""}Energy ${item.energy}/10 · ${item.adherence}% adherence`, time: relativeTime(item.createdAt, now), action: "Review progress", onOpen: () => onSelectClient(item.clientId, "#progress"), review: { type: "progress" as const, id: item.id },
    })),
    ...data.workoutReviews.map((item) => ({
      key: `workout-${item.id}`, tone: "lime" as const, eyebrow: "CLIENT WORKOUT", title: `${item.clientName} · ${item.title}`,
      detail: `${item.completedSets} sets · ${item.totalVolume.toLocaleString()} kg volume`, time: relativeTime(item.completedAt, now), action: "Review workout", onOpen: () => onSelectClient(item.clientId, "#client-workouts"), review: { type: "workout" as const, id: item.id },
    })),
    ...data.progressionApprovals.map((item) => ({
      key: `progression-${item.clientId}`, tone: "neutral" as const, eyebrow: `${item.count} LOAD ${item.count === 1 ? "DECISION" : "DECISIONS"}`, title: item.clientName,
      detail: `${item.first.exerciseName}: ${item.first.performedWeight} → ${item.first.proposedWeight} kg`, time: "Coach approval", action: "Review loads", onOpen: () => onSelectClient(item.clientId, "#progression"),
    })),
    ...data.lowCredits.map((item) => ({
      key: `credits-${item.clientId}`, tone: "amber" as const, eyebrow: "LOW CREDITS", title: item.clientName,
      detail: `${item.balance} session${item.balance === 1 ? "" : "s"} remaining`, time: "Check credits", action: "Add credits", onOpen: () => onSelectClient(item.clientId, "#clients"),
    })),
    ...data.onboarding.map((item) => ({
      key: `onboarding-${item.clientId}`, tone: item.tone, eyebrow: item.eyebrow, title: item.clientName,
      detail: item.detail, time: "Now", action: item.action, onOpen: () => onSelectClient(item.clientId, "#onboarding"),
    })),
  ].slice(0, 12), [data.attendancePending, data.followUps, data.lowCredits, data.onboarding, data.progressUpdates, data.progressionApprovals, data.workoutReviews, now, onSelectClient, pulseAlerts]);

  async function markReviewed(item: NonNullable<QueueItem["review"]>) {
    const key = `${item.type}-${item.id}`;
    setReviewing(key);
    try {
      const response = await fetch("/api/coach-today", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not mark this item reviewed.");
      setData((current) => item.type === "progress"
        ? { ...current, progressUpdates: current.progressUpdates.filter((entry) => entry.id !== item.id) }
        : { ...current, workoutReviews: current.workoutReviews.filter((entry) => entry.id !== item.id) });
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not mark this item reviewed."); }
    finally { setReviewing(""); }
  }

  return <section className="coach-command" aria-labelledby="coach-command-title">
    <header className="coach-command-heading">
      <div><p>TODAY · COACH COMMAND</p><h2 id="coach-command-title">Your day, under control.</h2><span>What is next, what needs attention, and what can wait.</span></div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Syncing…" : "Refresh"} <span>↻</span></button>
    </header>

    {error && <p className="coach-command-error" role="alert">{error}</p>}

    <div className="coach-command-kpis">
      <button type="button" onClick={() => scrollTo("#calendar")}><small>NEXT 24H</small><strong>{todaySessions.length}</strong><span>training sessions</span></button>
      <button type="button" onClick={() => scrollTo("#leads")}><small>CONSULTATIONS</small><strong>{todayConsultations.length}</strong><span>sales conversations</span></button>
      <button type="button" className={pulseAlerts.length ? "urgent" : ""} onClick={() => scrollTo("#calendar")}><small>PULSE ALERTS</small><strong>{pulseAlerts.length}</strong><span>{pulseAlerts.length ? "need preparation" : "all clear"}</span></button>
      <button type="button" className={reviewCount || lowCreditCount ? "active" : ""} onClick={() => scrollTo("#command-queue")}><small>COACH REVIEWS</small><strong>{reviewCount}</strong><span>decisions waiting</span></button>
    </div>

    <div className="coach-command-layout">
      <article className="coach-agenda">
        <div className="coach-command-title"><div><p>NOW & NEXT</p><h3>Schedule</h3></div><span>{timeline.length ? "7-day view" : "Open capacity"}</span></div>
        {timeline.length ? <div className="coach-agenda-list">{timeline.map((item, index) => <button type="button" onClick={item.open} key={item.key}>
          <span className="agenda-time"><b>{formatWhen(item.startAt)}</b><small>{relativeTime(item.startAt, now)}</small></span>
          <i className={`agenda-line ${item.tone}`} aria-hidden="true"><em />{index < timeline.length - 1 && <span />}</i>
          <span className="agenda-person"><small>{item.kind} · {item.duration} MIN</small><strong>{item.name}</strong><em>{item.status}</em></span><b className="agenda-arrow">→</b>
        </button>)}</div> : <div className="coach-command-empty"><strong>No upcoming events.</strong><span>Use the space for programming, reviews, or lead follow-up.</span></div>}
      </article>

      <article className="coach-priority" id="command-queue">
        <div className="coach-command-title"><div><p>PRIORITY QUEUE</p><h3>Act next</h3></div><span>{queue.length} open</span></div>
        {queue.length ? <div className="coach-priority-list">{queue.map((item) => <section className={`coach-priority-item ${item.tone}`} key={item.key}>
          <button type="button" className="coach-priority-open" onClick={item.onOpen}><i aria-hidden="true" /><span><small>{item.eyebrow} · {item.time}</small><strong>{item.title}</strong><em>{item.detail}</em></span><b>→</b></button>
          {item.review && <button type="button" className="coach-review-done" disabled={reviewing === `${item.review.type}-${item.review.id}`} onClick={() => void markReviewed(item.review!)}>{reviewing === `${item.review.type}-${item.review.id}` ? "Saving…" : "Mark reviewed ✓"}</button>}
        </section>)}</div> : <div className="coach-command-empty clear"><strong>Queue cleared.</strong><span>No urgent Pulse alerts, overdue leads, or client reviews.</span></div>}
      </article>
    </div>

    <nav className="coach-quick-actions" aria-label="Coach quick actions">
      <button type="button" onClick={() => scrollTo("#clients")}><span>◎</span>Clients</button>
      <button type="button" onClick={() => scrollTo("#leads")}><span>◇</span>Leads</button>
      <button type="button" onClick={() => scrollTo("#calendar")}><span>□</span>Schedule</button>
      <button type="button" onClick={() => scrollTo("#programmes")}><span>▤</span>Programmes</button>
    </nav>
  </section>;
}
