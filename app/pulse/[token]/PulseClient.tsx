"use client";

import { FormEvent, useEffect, useState } from "react";

type PulseSession = { clientName: string; startAt: string; durationMinutes: number; respondedAt: string | null; available: boolean; opensAt: string; expiresAt: string };
type ScaleProps = { name: string; label: string; options: Array<{ value: number; emoji: string; text: string }>; value: number; onChange: (value: number) => void };

function Scale({ name, label, options, value, onChange }: ScaleProps) {
  return <fieldset className="pulse-question"><legend>{label}</legend><div className="pulse-options">{options.map(option => <label className={value === option.value ? "selected" : ""} key={option.value}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.emoji}</span><b>{option.text}</b></label>)}</div></fieldset>;
}

function formatSession(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function PulseClient({ token }: { token: string }) {
  const [session, setSession] = useState<PulseSession | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [sent, setSent] = useState(false);
  const [energy, setEnergy] = useState(3); const [sleep, setSleep] = useState(3); const [soreness, setSoreness] = useState(1); const [stress, setStress] = useState(1); const [pain, setPain] = useState(false); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { fetch(`/api/pulse?token=${encodeURIComponent(token)}`).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Pulse Check unavailable"); setSession(data.session); }).catch(reason => setError(reason instanceof Error ? reason.message : "Pulse Check unavailable")).finally(() => setLoading(false)); }, [token]);
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setError(""); setSubmitting(true); const form = new FormData(e.currentTarget); const response = await fetch("/api/pulse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, energy, sleep, soreness, stress, pain, painArea: form.get("painArea"), note: form.get("note") }) }); const data = await response.json().catch(() => ({})); if (response.ok) setSent(true); else setError(data.error ?? "Your Pulse Check could not be sent."); setSubmitting(false); }
  if (loading) return <main className="pulse-page"><section className="pulse-card pulse-state"><span className="pulse-logo">JF</span><h1>Loading your Pulse Check…</h1></section></main>;
  if (error && !session) return <main className="pulse-page"><section className="pulse-card pulse-state"><span className="pulse-logo">JF</span><p>PRE-SESSION PULSE</p><h1>Link unavailable.</h1><p>{error}</p></section></main>;
  if (!session) return null;
  if (sent || session.respondedAt) return <main className="pulse-page"><section className="pulse-card pulse-state success"><span className="pulse-logo">JF</span><i>✓</i><p>CHECK-IN COMPLETE</p><h1>Thanks, {session.clientName}.</h1><p>Jonas has received your readiness update and will review it before your session.</p><small>If pain or symptoms worsen, contact an appropriate healthcare professional.</small></section></main>;
  if (!session.available) return <main className="pulse-page"><section className="pulse-card pulse-state"><span className="pulse-logo">JF</span><p>PRE-SESSION PULSE</p><h1>Not open yet.</h1><p>This check-in opens 24 hours before your session on {formatSession(session.startAt)}.</p></section></main>;
  return <main className="pulse-page"><form className="pulse-card" onSubmit={submit}><header><span className="pulse-logo">JF</span><div><p>JONAS FITNESS · PRE-SESSION PULSE</p><strong>{formatSession(session.startAt)} · {session.durationMinutes} min</strong></div></header><section className="pulse-intro"><small>HELLO {session.clientName.toUpperCase()}</small><h1>How are you arriving today?</h1><p>Five quick signals help Jonas prepare the right session for you. This takes less than 30 seconds.</p></section>
    <Scale name="energy" label="Your energy right now" value={energy} onChange={setEnergy} options={[{value:1,emoji:"😫",text:"Empty"},{value:2,emoji:"😕",text:"Low"},{value:3,emoji:"🙂",text:"Okay"},{value:4,emoji:"💪",text:"Good"},{value:5,emoji:"🔥",text:"Ready"}]} />
    <Scale name="sleep" label="How was your sleep?" value={sleep} onChange={setSleep} options={[{value:1,emoji:"🥱",text:"Poor"},{value:2,emoji:"😴",text:"Light"},{value:3,emoji:"😌",text:"Okay"},{value:4,emoji:"😊",text:"Good"},{value:5,emoji:"✨",text:"Great"}]} />
    <Scale name="soreness" label="Muscle soreness" value={soreness} onChange={setSoreness} options={[{value:1,emoji:"🟢",text:"None"},{value:2,emoji:"🟠",text:"Light"},{value:3,emoji:"🔴",text:"High"}]} />
    <Scale name="stress" label="Stress level" value={stress} onChange={setStress} options={[{value:1,emoji:"🌿",text:"Low"},{value:2,emoji:"〰️",text:"Medium"},{value:3,emoji:"⚡",text:"High"}]} />
    <fieldset className="pulse-question pain-question"><legend>Any pain or unusual discomfort?</legend><div className="pain-toggle"><button type="button" className={!pain ? "selected" : ""} onClick={() => setPain(false)}>No, all good</button><button type="button" className={pain ? "selected alert" : ""} onClick={() => setPain(true)}>Yes, tell Jonas</button></div>{pain && <label>Where do you feel it?<input name="painArea" required placeholder="Example: right shoulder" maxLength={120} /></label>}</fieldset>
    <label className="pulse-note">Anything Jonas should know? <span>Optional</span><textarea name="note" maxLength={400} placeholder="Soreness, stress, a win from this week…" /></label>
    {error && <p className="pulse-error" role="alert">{error}</p>}<button className="pulse-submit" disabled={submitting}>{submitting ? "Sending to Jonas…" : "Send my Pulse"}<span>→</span></button><footer>Your answers are shared only with your coach for session preparation. This is not a medical assessment.</footer>
  </form></main>;
}
