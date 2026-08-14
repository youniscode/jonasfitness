/* eslint-disable @next/next/no-img-element -- client-owned data URLs are compressed before storage and cannot use Next's remote image loader. */
"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Entry = { id: number; weight: number | null; waist: number | null; chest: number | null; hips: number | null; arm: number | null; thigh: number | null; energy: number; sleep: number; adherence: number; notes: string; photoData: string; createdAt: string };
type Session = { id: number; startAt: string; durationMinutes: number; readinessLevel: string };
type Programme = { title: string; goal: string; sessionsPerWeek: number; content: string };
type PortalData = { client: { name: string; goal: string; sessionsPerWeek: number; currentWeight: number | null }; programme: Programme | null; entries: Entry[]; sessions: Session[]; preview: boolean };
type ProgrammeDay = { name: string; focus: string; work: string[] };

function readDays(programme: Programme | null): ProgrammeDay[] {
  if (!programme) return [];
  try {
    const content = JSON.parse(programme.content) as Record<string, unknown>;
    const raw = Array.isArray(content.sessions) ? content.sessions : Array.isArray(content.days) ? content.days : Array.isArray(content.workouts) ? content.workouts : [];
    return raw.map((item, index) => {
      const day = item as Record<string, unknown>;
      const work = Array.isArray(day.work) ? day.work : Array.isArray(day.exercises) ? day.exercises : [];
      return { name: String(day.name ?? day.title ?? `Day ${index + 1}`), focus: String(day.focus ?? day.description ?? "Training session"), work: work.map(value => typeof value === "string" ? value : String((value as Record<string, unknown>).name ?? "Exercise")) };
    });
  } catch { return []; }
}

async function resizePhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a photo below 10 MB.");
  const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("The photo could not be read.")); reader.readAsDataURL(file); });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("The photo could not be processed.")); element.src = source; });
  const scale = Math.min(1, 1100 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  let photo = canvas.toDataURL("image/jpeg", 0.78);
  if (photo.length > 1_400_000) photo = canvas.toDataURL("image/jpeg", 0.58);
  if (photo.length > 1_500_000) throw new Error("This photo is still too large. Choose a smaller photo.");
  return photo;
}

export default function ClientPortal({ initialAccess, preview }: { initialAccess: boolean; preview: boolean }) {
  const [data, setData] = useState<PortalData | null>(null); const [loading, setLoading] = useState(initialAccess); const [error, setError] = useState(initialAccess ? "" : "This account is not linked to a client profile. Sign in using the same email your coach used when creating your profile.");
  const [showForm, setShowForm] = useState(false); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(""); const [photoData, setPhotoData] = useState(""); const [photoError, setPhotoError] = useState("");
  const searchParams = useSearchParams();
  const query = preview ? `?preview=${searchParams.get("preview") ?? ""}` : "";
  async function load() { setLoading(true); const r = await fetch(`/api/client-portal${query}`); const result = await r.json().catch(() => ({})); if (!r.ok) { setError(result.error ?? "Your portal could not be loaded."); setData(null); } else { setData(result); setError(""); } setLoading(false); }
  useEffect(() => {
    if (!initialAccess) return;
    let cancelled = false;
    void fetch(`/api/client-portal${query}`).then(response => response.json().catch(() => ({})).then(result => ({ response, result }))).then(({ response, result }) => {
      if (cancelled) return;
      if (!response.ok) { setError(result.error ?? "Your portal could not be loaded."); setData(null); } else { setData(result); setError(""); }
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError("Your portal could not be loaded."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [initialAccess, query]);
  const days = useMemo(() => readDays(data?.programme ?? null), [data?.programme]);
  const entries = data?.entries ?? []; const latest = entries[0]; const chartEntries = [...entries].filter(entry => entry.weight !== null).reverse();
  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setPhotoError(""); try { setPhotoData(await resizePhoto(file)); } catch (photoIssue) { setPhotoData(""); setPhotoError(photoIssue instanceof Error ? photoIssue.message : "The photo could not be prepared."); } }
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (preview) return; setSaving(true); setNotice(""); const form = new FormData(e.currentTarget); const payload = { ...Object.fromEntries(form), photoData }; const r = await fetch("/api/client-progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const result = await r.json().catch(() => ({})); if (!r.ok) { setNotice(result.error ?? "Your check-in could not be saved. Please try again."); } else { setNotice("Your update has been shared with your coach."); setShowForm(false); setPhotoData(""); await load(); } setSaving(false); }
  if (loading) return <main className="client-portal-page"><div className="portal-state"><span className="brand-mark">JF</span><h1>Opening your plan…</h1></div></main>;
  if (error || !data) return <main className="client-portal-page"><div className="portal-state"><span className="brand-mark">JF</span><p>JONAS FITNESS · CLIENT PORTAL</p><h1>We cannot find your profile.</h1><p>{error}</p><Link className="portal-button" href="/">Back to Jonas Fitness</Link></div></main>;
  const nextSession = data.sessions[0];
  return <main className="client-portal-page"><header className="client-portal-header"><Link className="brand dash-brand" href="/"><span className="brand-mark">JF</span><span>JONAS FITNESS</span></Link><div>{preview && <span className="preview-pill">COACH PREVIEW</span>}<UserButton /></div></header><section className="client-portal-content">
    <div className="client-welcome"><div><p>YOUR COACHING SPACE</p><h1>Hi, {data.client.name.split(" ")[0]}.</h1><span>Your plan, progress and weekly check-ins in one place.</span></div><button className="portal-button" onClick={() => setShowForm(true)} disabled={preview}>{preview ? "Preview mode" : "Share weekly update"}<span>→</span></button></div>
    {notice && <p className="portal-notice">✓ {notice}</p>}
    <section className="portal-overview"><article><small>CURRENT GOAL</small><strong>{data.client.goal}</strong><span>{data.client.sessionsPerWeek} sessions each week</span></article><article><small>LATEST WEIGHT</small><strong>{latest?.weight ? `${latest.weight} kg` : data.client.currentWeight ? `${data.client.currentWeight} kg` : "—"}</strong><span>{latest ? `Updated ${new Date(latest.createdAt).toLocaleDateString()}` : "Add your first update"}</span></article><article><small>NEXT SESSION</small><strong>{nextSession ? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(nextSession.startAt)) : "Not scheduled"}</strong><span>{nextSession ? `${nextSession.durationMinutes} minutes · Pulse Check before training` : "Your coach will confirm"}</span></article></section>
    <section className="portal-grid"><article className="portal-card plan-card"><div className="portal-card-head"><div><p>CURRENT PROGRAMME</p><h2>{data.programme?.title ?? "Your programme is being prepared"}</h2></div><span>{days.length || data.client.sessionsPerWeek} DAYS</span></div>{days.length ? <div className="portal-days">{days.map((day, index) => <details key={`${day.name}-${index}`} open={index === 0}><summary><span>DAY {String(index + 1).padStart(2, "0")}</span><strong>{day.name}</strong><small>{day.focus}</small></summary><ul>{day.work.map((exercise, workIndex) => <li key={`${exercise}-${workIndex}`}><i>{String(workIndex + 1).padStart(2, "0")}</i>{exercise}</li>)}</ul></details>)}</div> : <p className="portal-empty">Your coach will publish your training plan here.</p>}</article>
      <article className="portal-card progress-card"><div className="portal-card-head"><div><p>PROGRESS</p><h2>Keep the signal clear.</h2></div><span>{entries.length} UPDATES</span></div><WeightChart entries={chartEntries} />{latest && <div className="latest-metrics"><span>Energy <b>{latest.energy}/10</b></span><span>Sleep <b>{latest.sleep}/10</b></span><span>Adherence <b>{latest.adherence}%</b></span></div>}<button className="text-action" onClick={() => setShowForm(true)} disabled={preview}>Add this week’s update <span>→</span></button></article>
    </section>
    <section className="portal-card progress-history"><div className="portal-card-head"><div><p>YOUR HISTORY</p><h2>Every check-in, visible.</h2></div></div>{entries.length === 0 ? <p className="portal-empty">Your first weekly update will appear here.</p> : <div className="history-list">{entries.map(entry => <article key={entry.id}><div className="history-date"><strong>{new Date(entry.createdAt).toLocaleDateString(undefined, { day: "2-digit" })}</strong><span>{new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short" }).toUpperCase()}</span></div>{entry.photoData && <img src={entry.photoData} alt={`Progress update from ${new Date(entry.createdAt).toLocaleDateString()}`} />}<div><strong>{entry.weight ? `${entry.weight} kg` : "Progress update"}</strong><p>{entry.notes || "No note added."}</p><small>Energy {entry.energy}/10 · Sleep {entry.sleep}/10 · Adherence {entry.adherence}%</small></div></article>)}</div>}</section>
  </section>
  {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}><form className="portal-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="portal-form-head"><div><p>WEEKLY PROGRESS UPDATE</p><h2>How did this week feel?</h2></div><button type="button" aria-label="Close" onClick={() => setShowForm(false)}>×</button></div><div className="form-pair"><label>Weight (kg)<input name="weight" type="number" step="0.1" defaultValue={data.client.currentWeight ?? ""} /></label><label>Adherence %<input name="adherence" type="number" min="0" max="100" defaultValue={latest?.adherence ?? 80} required /></label><label>Energy / 10<input name="energy" type="number" min="1" max="10" defaultValue={latest?.energy ?? 7} required /></label><label>Sleep / 10<input name="sleep" type="number" min="1" max="10" defaultValue={latest?.sleep ?? 7} required /></label></div><p className="measure-label">Optional measurements (cm)</p><div className="measure-grid"><label>Waist<input name="waist" type="number" step="0.1" /></label><label>Chest<input name="chest" type="number" step="0.1" /></label><label>Hips<input name="hips" type="number" step="0.1" /></label><label>Arm<input name="arm" type="number" step="0.1" /></label><label>Thigh<input name="thigh" type="number" step="0.1" /></label></div><label className="photo-input">Progress photo <span>Optional · compressed before saving</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} />{photoData && <img src={photoData} alt="Selected progress preview" />}</label>{photoError && <p className="form-error">{photoError}</p>}<label>Note for your coach<textarea name="notes" placeholder="Wins, challenges, recovery, questions…" /></label><button className="portal-button" disabled={saving}>{saving ? "Saving your update…" : "Share with coach"}<span>→</span></button></form></div>}
  </main>;
}

function WeightChart({ entries }: { entries: Entry[] }) {
  if (entries.length < 2) return <div className="weight-chart empty"><strong>{entries.length === 1 ? `${entries[0].weight} kg` : "No trend yet"}</strong><span>Two weight updates will show your progress line.</span></div>;
  const values = entries.map(entry => entry.weight ?? 0); const low = Math.min(...values); const high = Math.max(...values); const spread = Math.max(high - low, 0.5);
  const points = values.map((weight, index) => `${(index / (values.length - 1)) * 100},${86 - ((weight - low) / spread) * 70}`).join(" ");
  return <div className="weight-chart"><div><strong>{entries.at(-1)?.weight} kg</strong><span>Latest recorded weight</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Weight trend"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.3" vectorEffect="non-scaling-stroke" /></svg><small>{entries[0]?.weight} kg <i /> {entries.at(-1)?.weight} kg</small></div>;
}
