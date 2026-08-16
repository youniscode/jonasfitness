"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

type Status = "new" | "contacted" | "qualified" | "client" | "lost";
type ActivityType = "note" | "phone" | "email" | "whatsapp" | "status" | "follow_up" | "consultation";
type ConsultationStatus = "scheduled" | "completed" | "cancelled" | "no_show";
type TemplateKey = "initial" | "followup" | "consultation";
type Lead = {
  id: number; name: string; email: string; phone: string; country: string; goal: string; experience: string;
  trainingDays: number; coachingFormat: string; contactPreference: string; preferredLanguage: string; message: string;
  status: Status; coachNotes: string; acquisitionSource: string; acquisitionCampaign: string; convertedClientId: number | null;
  nextFollowUpAt: string | null; contactedAt: string | null; createdAt: string;
};
type Activity = { id: number; leadId: number; type: ActivityType; title: string; detail: string; occurredAt: string; createdAt: string };
type Consultation = { id: number; leadId: number; startAt: string; durationMinutes: number; status: ConsultationStatus; outcome: string; notes: string; createdAt: string };
type ConvertedClient = { id:number; name:string; email:string; phone:string; goal:string; sessionsPerWeek:number; currentWeight:number|null; adherence:number; nextCheckIn:string|null; status:string; acquisitionSource:string };

const columns: { status: Status; label: string }[] = [
  { status: "new", label: "New" }, { status: "contacted", label: "Contacted" },
  { status: "qualified", label: "Qualified" }, { status: "client", label: "Client" }, { status: "lost", label: "Lost" },
];
const templateLabels: Record<TemplateKey, string> = { initial: "Initial reply", followup: "Follow-up", consultation: "Consultation" };
const activityLabels: Record<ActivityType, string> = { note:"Note", phone:"Phone", email:"Email", whatsapp:"WhatsApp", status:"Status", follow_up:"Follow-up", consultation:"Consultation" };

function localInputValue(value: string | Date) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value: string, language = "en") {
  const locale = language === "ar" ? "ar" : language === "fr" ? "fr-FR" : "en-GB";
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function contactTemplate(lead: Lead, key: TemplateKey, consultation?: Consultation) {
  const firstName = lead.name.trim().split(/\s+/)[0] || lead.name;
  const date = consultation ? formatDateTime(consultation.startAt, lead.preferredLanguage) : "";
  const language = ["fr", "en", "ar"].includes(lead.preferredLanguage) ? lead.preferredLanguage : "fr";
  const messages = {
    fr: {
      initial: `Bonjour ${firstName}, c’est Jonas de Jonas Fitness. Merci pour votre demande de coaching. J’ai bien étudié votre objectif et j’aimerais échanger quelques minutes avec vous pour comprendre vos besoins. Quand seriez-vous disponible ?`,
      followup: `Bonjour ${firstName}, je reviens vers vous concernant votre demande de coaching Jonas Fitness. Souhaitez-vous toujours que nous échangions sur votre objectif ${lead.goal.toLowerCase()} ?`,
      consultation: consultation
        ? `Bonjour ${firstName}, votre consultation Jonas Fitness est confirmée pour le ${date}. Durée prévue : ${consultation.durationMinutes} minutes. À très bientôt.`
        : `Bonjour ${firstName}, je vous propose une courte consultation afin de parler de votre objectif et de voir si mon accompagnement vous convient. Quelles sont vos disponibilités ?`,
      subject: "Votre demande de coaching Jonas Fitness",
    },
    en: {
      initial: `Hi ${firstName}, this is Jonas from Jonas Fitness. Thank you for your coaching application. I have reviewed your goal and would like to speak with you briefly to understand what you need. When would you be available?`,
      followup: `Hi ${firstName}, I am following up about your Jonas Fitness coaching application. Would you still like to discuss your ${lead.goal.toLowerCase()} goal?`,
      consultation: consultation
        ? `Hi ${firstName}, your Jonas Fitness consultation is confirmed for ${date}. Expected duration: ${consultation.durationMinutes} minutes. Speak soon.`
        : `Hi ${firstName}, I would like to offer you a short consultation to discuss your goal and see whether my coaching is the right fit. When are you available?`,
      subject: "Your Jonas Fitness coaching application",
    },
    ar: {
      initial: `مرحباً ${firstName}، معك جوناس من Jonas Fitness. شكراً على طلب التدريب. راجعت هدفك وأود التحدث معك لبضع دقائق لفهم احتياجاتك. متى يكون الوقت مناسباً لك؟`,
      followup: `مرحباً ${firstName}، أتابع معك بخصوص طلب التدريب لدى Jonas Fitness. هل ما زلت ترغب في مناقشة هدفك: ${lead.goal}؟`,
      consultation: consultation
        ? `مرحباً ${firstName}، تم تأكيد استشارتك مع Jonas Fitness بتاريخ ${date}. المدة المتوقعة: ${consultation.durationMinutes} دقيقة. إلى اللقاء قريباً.`
        : `مرحباً ${firstName}، أقترح استشارة قصيرة لمناقشة هدفك والتأكد من أن التدريب مناسب لك. ما هي الأوقات المناسبة لك؟`,
      subject: "طلب التدريب لدى Jonas Fitness",
    },
  } as const;
  const selected = messages[language as keyof typeof messages];
  return { subject: selected.subject, message: selected[key] };
}

function whatsappUrl(phone: string, message: string) {
  const digits = phone.replace(/[^\d+]/g, "").replace("+", "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function endOfDay(now: number) { const value = new Date(now); value.setHours(23, 59, 59, 999); return value.getTime(); }
function startOfDay(now: number) { const value = new Date(now); value.setHours(0, 0, 0, 0); return value.getTime(); }

export default function LeadPipeline({ onConverted }: { onConverted: (client: ConvertedClient) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All");
  const [converting, setConverting] = useState<number | null>(null);
  const [activityLead, setActivityLead] = useState<Lead | null>(null);
  const [consultationLead, setConsultationLead] = useState<Lead | null>(null);
  const [managedConsultation, setManagedConsultation] = useState<Consultation | null>(null);
  const [templates, setTemplates] = useState<Record<number, TemplateKey>>({});
  const [clock, setClock] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/leads");
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Leads could not be loaded.");
      setLeads(result.leads ?? []); setActivities(result.activities ?? []); setConsultations(result.consultations ?? []);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Leads could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const tick = () => setClock(Date.now()); tick(); const timer = window.setInterval(tick, 60_000); return () => window.clearInterval(timer); }, []);

  const leadMap = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const sources = useMemo(() => ["All", ...new Set(leads.map((lead) => lead.acquisitionSource))], [leads]);
  const visible = useMemo(() => leads.filter((lead) =>
    (source === "All" || lead.acquisitionSource === source) &&
    (!deferredQuery || `${lead.name} ${lead.email} ${lead.phone} ${lead.goal}`.toLowerCase().includes(deferredQuery)),
  ), [leads, source, deferredQuery]);
  // Lost leads are archived out of the active pipeline by default; the coach can
  // opt back in to review/delete them.
  const boardLeads = useMemo(() => showArchived ? visible : visible.filter((lead) => lead.status !== "lost"), [visible, showArchived]);
  const boardColumns = useMemo(() => showArchived ? columns : columns.filter((column) => column.status !== "lost"), [showArchived]);
  const archivedCount = leads.filter((lead) => lead.status === "lost").length;
  const activitiesByLead = useMemo(() => {
    const grouped = new Map<number, Activity[]>();
    for (const activity of activities) grouped.set(activity.leadId, [...(grouped.get(activity.leadId) ?? []), activity]);
    return grouped;
  }, [activities]);
  const consultationsByLead = useMemo(() => {
    const grouped = new Map<number, Consultation[]>();
    for (const consultation of consultations) grouped.set(consultation.leadId, [...(grouped.get(consultation.leadId) ?? []), consultation]);
    return grouped;
  }, [consultations]);
  const todayStart = startOfDay(clock); const todayEnd = endOfDay(clock); const now = clock;
  const openLeads = leads.filter((lead) => !["client", "lost"].includes(lead.status));
  const overdue = openLeads.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < todayStart);
  const dueToday = openLeads.filter((lead) => { const time = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : 0; return time >= todayStart && time <= todayEnd; });
  const scheduledConsultations = consultations.filter((item) => item.status === "scheduled" && new Date(item.startAt).getTime() >= now - 30 * 60_000);
  const consultationsToday = scheduledConsultations.filter((item) => new Date(item.startAt).getTime() <= todayEnd);

  async function patchLead(id: number, updates: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(updates) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Lead could not be updated."); return null; }
    setLeads((current) => current.map((lead) => lead.id === id ? result.lead : lead));
    if (result.activities?.length) setActivities((current) => [...result.activities, ...current]);
    return result.lead as Lead;
  }

  async function addActivity(lead: Lead, payload: Record<string, unknown>, quiet = false) {
    const response = await fetch(`/api/leads/${lead.id}/activities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Interaction could not be recorded."); return null; }
    setActivities((current) => [result.activity, ...current]);
    setLeads((current) => current.map((item) => item.id === lead.id ? result.lead : item));
    if (!quiet) setNotice(`Activity recorded for ${lead.name}.`);
    return result.activity as Activity;
  }

  async function saveFollowUp(event: FormEvent<HTMLFormElement>, lead: Lead) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const value = String(form.get("nextFollowUpAt") ?? "");
    const saved = await patchLead(lead.id, { nextFollowUpAt: value ? new Date(value).toISOString() : null });
    if (saved) setNotice(value ? `Follow-up scheduled for ${lead.name}.` : `Follow-up cleared for ${lead.name}.`);
  }

  async function logActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activityLead) return; const form = new FormData(event.currentTarget);
    const followUpValue = String(form.get("nextFollowUpAt") ?? "");
    const saved = await addActivity(activityLead, {
      type: String(form.get("type")), detail: String(form.get("detail") ?? ""),
      nextFollowUpAt: followUpValue ? new Date(followUpValue).toISOString() : undefined,
    });
    if (saved) setActivityLead(null);
  }

  async function scheduleConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!consultationLead) return; const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/leads/${consultationLead.id}/consultations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        startAt: new Date(String(form.get("startAt"))).toISOString(), durationMinutes: Number(form.get("durationMinutes")), notes: String(form.get("notes") ?? ""),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Consultation could not be scheduled."); return; }
    setConsultations((current) => [...current, result.consultation].sort((a, b) => a.startAt.localeCompare(b.startAt)));
    setActivities((current) => [result.activity, ...current]);
    setLeads((current) => current.map((lead) => lead.id === consultationLead.id ? result.lead : lead));
    setNotice(`Consultation scheduled for ${consultationLead.name}.`); setConsultationLead(null);
  }

  async function updateConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!managedConsultation) return; const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/consultations/${managedConsultation.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
        status: String(form.get("status")), outcome: String(form.get("outcome") ?? ""), notes: String(form.get("notes") ?? ""),
        startAt: new Date(String(form.get("startAt"))).toISOString(), durationMinutes: Number(form.get("durationMinutes")),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Consultation could not be updated."); return; }
    setConsultations((current) => current.map((item) => item.id === managedConsultation.id ? result.consultation : item));
    if (result.activity) setActivities((current) => [result.activity, ...current]);
    setNotice("Consultation updated."); setManagedConsultation(null);
  }

  async function deleteLead(lead: Lead) {
    if (!window.confirm(`Delete lead ${lead.name}? This permanently removes their activities and consultations.`)) return;
    setError("");
    const response = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Lead could not be deleted."); return; }
    setLeads((current) => current.filter((item) => item.id !== lead.id));
    setActivities((current) => current.filter((item) => item.leadId !== lead.id));
    setConsultations((current) => current.filter((item) => item.leadId !== lead.id));
    setNotice(`Lead ${lead.name} deleted.`);
  }

  async function convert(lead: Lead) {
    if (!window.confirm(`Convert ${lead.name} into a client?`)) return;
    setConverting(lead.id); setError("");
    try {
      const response = await fetch(`/api/leads/${lead.id}/convert`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Lead could not be converted.");
      setLeads((current) => current.map((item) => item.id === lead.id ? result.lead : item));
      onConverted(result.client); setNotice(`${lead.name} is now a client and has been added to your roster.`); void load();
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Lead could not be converted."); }
    finally { setConverting(null); }
  }

  function chosenTemplate(lead: Lead) { return templates[lead.id] ?? (lead.status === "new" ? "initial" : "followup"); }
  function latestScheduledConsultation(leadId: number) { return consultationsByLead.get(leadId)?.find((item) => item.status === "scheduled" && new Date(item.startAt).getTime() >= now - 30 * 60_000); }
  function openContact(lead: Lead, channel: "email" | "whatsapp") {
    const key = chosenTemplate(lead); const copy = contactTemplate(lead, key, latestScheduledConsultation(lead.id));
    void addActivity(lead, { type: channel, title: `${channel === "email" ? "Email" : "WhatsApp"}: ${templateLabels[key]} prepared`, detail: copy.message }, true);
    if (channel === "email") window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(copy.subject)}&body=${encodeURIComponent(copy.message)}`;
    else window.open(whatsappUrl(lead.phone, copy.message), "_blank", "noopener,noreferrer");
  }
  async function copyTemplate(lead: Lead) {
    const key = chosenTemplate(lead); const copy = contactTemplate(lead, key, latestScheduledConsultation(lead.id));
    await navigator.clipboard.writeText(copy.message); setNotice(`${templateLabels[key]} message copied for ${lead.name}.`);
  }

  return <section className="lead-pipeline" id="leads">
    <header><div><p>LEAD FOLLOW-UP · CONSULTATIONS</p><h2>Your sales day, under control.</h2><span>Know who needs a reply, book consultations and keep every interaction visible.</span></div><button className="refresh-button" onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></header>
    <section className="sales-today">
      <div className="sales-today-heading"><div><p>SALES TODAY</p><h3>What needs your attention.</h3></div><span>{clock ? new Intl.DateTimeFormat(undefined, { weekday:"long", day:"numeric", month:"long" }).format(new Date(clock)) : "Today"}</span></div>
      <div className="sales-metrics"><article className={overdue.length ? "urgent" : ""}><small>OVERDUE</small><strong>{overdue.length}</strong><span>follow-ups</span></article><article><small>DUE TODAY</small><strong>{dueToday.length}</strong><span>follow-ups</span></article><article><small>CONSULTATIONS</small><strong>{consultationsToday.length}</strong><span>today</span></article><article><small>NEW LEADS</small><strong>{leads.filter((lead) => lead.status === "new").length}</strong><span>waiting</span></article></div>
      <div className="sales-task-grid">
        <div><h4>FOLLOW-UP QUEUE</h4>{[...overdue, ...dueToday].length === 0 ? <p className="pipeline-empty">Nothing overdue or due today.</p> : [...overdue, ...dueToday].map((lead) => <article className="sales-task" key={lead.id}><span className={lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < todayStart ? "task-alert" : ""}>{lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : ""}</span><div><strong>{lead.name}</strong><small>{lead.goal} · {lead.acquisitionSource}</small></div><button onClick={() => setActivityLead(lead)}>Log contact →</button></article>)}</div>
        <div><h4>UPCOMING CONSULTATIONS</h4>{scheduledConsultations.length === 0 ? <p className="pipeline-empty">No consultations scheduled.</p> : scheduledConsultations.slice(0, 6).map((item) => { const lead = leadMap.get(item.leadId); return <article className="sales-task consultation-task" key={item.id}><span>{formatDateTime(item.startAt)}</span><div><strong>{lead?.name ?? "Lead"}</strong><small>{item.durationMinutes} min · {lead?.preferredLanguage.toUpperCase()}</small></div><button onClick={() => setManagedConsultation(item)}>Manage →</button></article>; })}</div>
      </div>
    </section>
    <div className="pipeline-summary"><article><small>NEW</small><strong>{visible.filter((lead) => lead.status === "new").length}</strong></article><article><small>QUALIFIED</small><strong>{visible.filter((lead) => lead.status === "qualified").length}</strong></article><article><small>CONVERTED</small><strong>{visible.filter((lead) => lead.status === "client").length}</strong></article><article><small>CONVERSION</small><strong>{visible.length ? Math.round(visible.filter((lead) => lead.status === "client").length / visible.length * 100) : 0}%</strong></article></div>
    <div className="pipeline-toolbar"><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, goal…" /></label><label>Source<select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" className="archive-toggle" onClick={() => setShowArchived((current) => !current)}>{showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</button></div>
    {notice ? <p className="pipeline-notice">✓ {notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="pipeline-board">{boardColumns.map((column) => <section className={`pipeline-column ${column.status}`} key={column.status}><header><span>{column.label}</span><b>{boardLeads.filter((lead) => lead.status === column.status).length}</b></header><div>
      {boardLeads.filter((lead) => lead.status === column.status).map((lead) => {
        const leadActivities = activitiesByLead.get(lead.id) ?? []; const leadConsultations = consultationsByLead.get(lead.id) ?? []; const followUpTime = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : 0;
        return <details className="lead-card" key={lead.id}><summary><span><small>{lead.acquisitionSource}{lead.acquisitionCampaign ? ` · ${lead.acquisitionCampaign}` : ""}</small><strong>{lead.name}</strong><em>{lead.goal} · {lead.country}</em>{followUpTime ? <i className={followUpTime < now ? "follow-up-overdue" : "follow-up-set"}>{followUpTime < now ? "OVERDUE · " : "NEXT · "}{formatDateTime(lead.nextFollowUpAt!)}</i> : null}</span><b>＋</b></summary><div className="lead-detail">
          <div className="lead-facts"><span><small>EXPERIENCE</small><b>{lead.experience || "—"}</b></span><span><small>TRAINING</small><b>{lead.trainingDays} days · {lead.coachingFormat}</b></span><span><small>CONTACT</small><b>{lead.contactPreference} · {lead.preferredLanguage.toUpperCase()}</b></span><span><small>APPLIED</small><b>{new Date(lead.createdAt).toLocaleDateString()}</b></span></div>
          {lead.message ? <p>{lead.message}</p> : null}
          <div className="contact-workbench"><label>Message template<select value={chosenTemplate(lead)} onChange={(event) => setTemplates((current) => ({ ...current, [lead.id]: event.target.value as TemplateKey }))}><option value="initial">Initial reply · {lead.preferredLanguage.toUpperCase()}</option><option value="followup">Follow-up · {lead.preferredLanguage.toUpperCase()}</option><option value="consultation">Consultation · {lead.preferredLanguage.toUpperCase()}</option></select></label><div><button onClick={() => void copyTemplate(lead)}>Copy</button><button onClick={() => openContact(lead, "email")}>Email</button><button className="whatsapp-contact" onClick={() => openContact(lead, "whatsapp")}>WhatsApp ↗</button></div></div>
          <div className="lead-action-row"><button onClick={() => setActivityLead(lead)}>+ Log interaction</button><button onClick={() => setConsultationLead(lead)}>+ Consultation</button></div>
          <form className="follow-up-form" onSubmit={(event) => void saveFollowUp(event, lead)}><label>Next follow-up<input key={lead.nextFollowUpAt ?? "empty"} name="nextFollowUpAt" type="datetime-local" defaultValue={lead.nextFollowUpAt ? localInputValue(lead.nextFollowUpAt) : ""} /></label><button>Save</button><button type="button" onClick={() => void patchLead(lead.id, { nextFollowUpAt: null })}>Clear</button></form>
          <label>Status<select value={lead.status} disabled={lead.status === "client"} onChange={(event) => void patchLead(lead.id, { status: event.target.value as Status })}>{columns.filter((option) => option.status !== "client" || lead.status === "client").map((option) => <option value={option.status} key={option.status}>{option.label}</option>)}</select></label>
          <label>Coach notes<textarea defaultValue={lead.coachNotes} onBlur={(event) => { if (event.target.value !== lead.coachNotes) void patchLead(lead.id, { coachNotes: event.target.value }); }} placeholder="Fit, objections, next step…" /></label>
          {leadConsultations.length ? <div className="lead-consultations"><h5>CONSULTATIONS</h5>{leadConsultations.slice(0, 3).map((item) => <button key={item.id} onClick={() => setManagedConsultation(item)}><span>{formatDateTime(item.startAt)}</span><b>{item.status.replace("_", " ")}</b></button>)}</div> : null}
          <div className="lead-timeline"><h5>ACTIVITY</h5>{leadActivities.length === 0 ? <p>No activity recorded yet.</p> : leadActivities.slice(0, 6).map((activity) => <article key={activity.id}><i>{activityLabels[activity.type]?.slice(0, 1) ?? "•"}</i><span><b>{activity.title}</b><small>{formatDateTime(activity.occurredAt)}</small>{activity.detail && activity.type !== "email" && activity.type !== "whatsapp" ? <em>{activity.detail}</em> : null}</span></article>)}</div>
          {lead.status !== "client" ? <button className="convert-lead" disabled={converting === lead.id} onClick={() => void convert(lead)}>{converting === lead.id ? "Converting…" : "Convert to client →"}</button> : <p className="converted-label">✓ Client created</p>}
          {lead.status !== "client" ? <button className="delete-lead" onClick={() => void deleteLead(lead)}>Delete lead</button> : null}
        </div></details>;
      })}
      {boardLeads.every((lead) => lead.status !== column.status) ? <p className="pipeline-empty">No {column.label.toLowerCase()} leads.</p> : null}
    </div></section>)}</div>

    {activityLead ? <div className="sales-modal-backdrop" role="presentation" onMouseDown={() => setActivityLead(null)}><form className="sales-modal" onSubmit={logActivity} onMouseDown={(event) => event.stopPropagation()}><header><div><p>INTERACTION · {activityLead.name}</p><h3>Record what happened.</h3></div><button type="button" aria-label="Close" onClick={() => setActivityLead(null)}>×</button></header><label>Contact type<select name="type" defaultValue={activityLead.contactPreference.toLowerCase() === "email" ? "email" : "whatsapp"}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="phone">Phone call</option><option value="note">General note</option></select></label><label>Outcome / note<textarea name="detail" required placeholder="What was discussed? What is the next step?" /></label><label>Next follow-up<input name="nextFollowUpAt" type="datetime-local" defaultValue={localInputValue(new Date(now + 24 * 60 * 60 * 1000))} /></label><button className="sales-primary">Save interaction →</button></form></div> : null}

    {consultationLead ? <div className="sales-modal-backdrop" role="presentation" onMouseDown={() => setConsultationLead(null)}><form className="sales-modal" onSubmit={scheduleConsultation} onMouseDown={(event) => event.stopPropagation()}><header><div><p>CONSULTATION · {consultationLead.name}</p><h3>Book the conversation.</h3></div><button type="button" aria-label="Close" onClick={() => setConsultationLead(null)}>×</button></header><label>Date and time<input name="startAt" type="datetime-local" required defaultValue={localInputValue(new Date(now + 24 * 60 * 60 * 1000))} /></label><label>Duration<select name="durationMinutes" defaultValue="30"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><label>Preparation note<textarea name="notes" placeholder="Questions to cover, goal, objections…" /></label><p className="sales-hint">After saving, choose the Consultation message template to send the confirmed time in {consultationLead.preferredLanguage.toUpperCase()}.</p><button className="sales-primary">Schedule consultation →</button></form></div> : null}

    {managedConsultation ? <div className="sales-modal-backdrop" role="presentation" onMouseDown={() => setManagedConsultation(null)}><form className="sales-modal" onSubmit={updateConsultation} onMouseDown={(event) => event.stopPropagation()}><header><div><p>CONSULTATION · {leadMap.get(managedConsultation.leadId)?.name}</p><h3>Outcome and next step.</h3></div><button type="button" aria-label="Close" onClick={() => setManagedConsultation(null)}>×</button></header><label>Date and time<input name="startAt" type="datetime-local" required defaultValue={localInputValue(managedConsultation.startAt)} /></label><label>Duration<select name="durationMinutes" defaultValue={managedConsultation.durationMinutes}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><label>Status<select name="status" defaultValue={managedConsultation.status}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="no_show">No show</option><option value="cancelled">Cancelled</option></select></label><label>Outcome<input name="outcome" defaultValue={managedConsultation.outcome} placeholder="Ready to start, follow up later, not a fit…" /></label><label>Coach notes<textarea name="notes" defaultValue={managedConsultation.notes} placeholder="Needs, budget, decision, next step…" /></label><button className="sales-primary">Save consultation →</button></form></div> : null}
  </section>;
}
