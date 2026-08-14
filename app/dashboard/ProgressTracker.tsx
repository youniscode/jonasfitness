/* eslint-disable @next/next/no-img-element -- progress images are client-owned data URLs, not remote assets. */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Client = { id: number; name: string; currentWeight: number | null; adherence: number };
type Entry = { id: number; weight: number | null; waist: number | null; chest: number | null; hips: number | null; arm: number | null; thigh: number | null; energy: number; sleep: number; adherence: number; notes: string; photoData: string; createdAt: string };

export default function ProgressTracker({ client }: { client: Client }) {
  const [entries, setEntries] = useState<Entry[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function load() { if (client.id < 1) { setEntries([]); return; } setLoading(true); const response = await fetch(`/api/progress?clientId=${client.id}`); const result = await response.json().catch(() => ({})); if (!response.ok) setError(result.error ?? "Progress could not be loaded."); else { setEntries(result.entries ?? []); setError(""); } setLoading(false); }
  useEffect(() => {
    if (client.id < 1) return;
    let cancelled = false;
    void fetch(`/api/progress?clientId=${client.id}`).then(response => response.json().catch(() => ({})).then(result => ({ response, result }))).then(({ response, result }) => {
      if (cancelled) return;
      if (!response.ok) setError(result.error ?? "Progress could not be loaded."); else { setEntries(result.entries ?? []); setError(""); }
    }).catch(() => { if (!cancelled) setError("Progress could not be loaded."); });
    return () => { cancelled = true; };
  }, [client.id]);
  const latest = entries[0]; const weightedEntries = useMemo(() => [...entries].filter(entry => entry.weight !== null).reverse(), [entries]);
  const change = weightedEntries.length > 1 ? (weightedEntries.at(-1)!.weight! - weightedEntries[0].weight!).toFixed(1) : null;
  return <section className="progress-tracker" id="progress"><div className="progress-heading"><div><p>CLIENT PROGRESS</p><h2>Measure what matters.</h2><span>Weekly updates, measurements and photos from {client.name}.</span></div><div><Link className="refresh-button" href={client.id > 0 ? `/client?preview=${client.id}` : "/client"}>Preview portal</Link><button className="refresh-button" onClick={load}>{loading ? "Loading…" : "Refresh"}</button></div></div>
    {client.id < 1 ? <div className="progress-empty"><strong>Choose a saved client to review real progress.</strong><span>Demo clients do not have a private portal or progress history.</span></div> : error ? <div className="progress-empty"><strong>Progress is not available yet.</strong><span>{error}</span></div> : entries.length === 0 ? <div className="progress-empty"><strong>{client.name} has not shared a weekly update yet.</strong><span>Use “Preview portal” to see the client experience, then share your client portal link.</span></div> : <div className="coach-progress-layout"><article className="coach-chart-card"><p>LATEST CHECK-IN</p><div className="coach-chart-metrics"><strong>{latest.weight ? `${latest.weight} kg` : "Check-in"}</strong><span>{change ? `${Number(change) > 0 ? "+" : ""}${change} kg since first update` : `Submitted ${new Date(latest.createdAt).toLocaleDateString()}`}</span></div><CoachChart entries={weightedEntries} /><div className="coach-score-row"><span>Energy <b>{latest.energy}/10</b></span><span>Sleep <b>{latest.sleep}/10</b></span><span>Adherence <b>{latest.adherence}%</b></span></div></article><article className="coach-measure-card"><p>MEASUREMENTS · LATEST</p><div>{metric("Waist", latest.waist)}{metric("Chest", latest.chest)}{metric("Hips", latest.hips)}{metric("Arm", latest.arm)}{metric("Thigh", latest.thigh)}</div><small>{latest.notes || "No note was included with this update."}</small></article><article className="coach-photo-card"><p>RECENT PROGRESS PHOTO</p>{latest.photoData ? <img src={latest.photoData} alt={`${client.name} progress update`} /> : <div className="no-photo">No photo shared</div>}<span>{new Date(latest.createdAt).toLocaleDateString()}</span></article></div>}
  </section>;
}

function metric(label: string, value: number | null) { return <span key={label}>{label}<b>{value ? `${value} cm` : "—"}</b></span>; }

function CoachChart({ entries }: { entries: Entry[] }) {
  if (entries.length < 2) return <div className="coach-chart-empty">A second weight update will draw the trend.</div>;
  const values = entries.map(entry => entry.weight ?? 0); const low = Math.min(...values); const high = Math.max(...values); const spread = Math.max(high - low, 0.5); const points = values.map((weight, index) => `${(index / (values.length - 1)) * 100},${84 - ((weight - low) / spread) * 64}`).join(" ");
  return <div className="coach-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><small>{entries[0].weight} kg <i /> {entries.at(-1)?.weight} kg</small></div>;
}
