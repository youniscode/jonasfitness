/* eslint-disable @next/next/no-img-element -- progress images are client-owned data URLs, not remote assets. */
"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { estimateLeanMassKg } from "../lib/body-measurements";

type Client = { id: number; name: string; currentWeight: number | null; adherence: number };
type Entry = { id: number; weight: number | null; waist: number | null; chest: number | null; hips: number | null; arm: number | null; thigh: number | null; energy: number; sleep: number; adherence: number; notes: string; photoData: string; createdAt: string };

type MeasurementValues = { weightKg: number | null; bodyFatPercent: number | null; leanMassKg: number | null; waistCm: number | null; chestCm: number | null; hipsCm: number | null; armCm: number | null; thighCm: number | null };
type Measurement = MeasurementValues & { id: number; measuredAt: string; source: string; notes: string };
type MeasurementRow = MeasurementValues & { id: number; measuredAt: string };
type MeasurementDelta = { value: number | null; change: number | null };
type MeasurementTrend = {
  count: number;
  latest: MeasurementRow | null;
  previous: MeasurementRow | null;
  deltas: Record<keyof MeasurementValues, MeasurementDelta>;
  leanMass: { leanMassKg: number | null; estimated: boolean; source: "measured" | "derived" | "missing" };
};

const EMPTY_TREND: MeasurementTrend = {
  count: 0, latest: null, previous: null,
  deltas: { weightKg: { value: null, change: null }, bodyFatPercent: { value: null, change: null }, leanMassKg: { value: null, change: null }, waistCm: { value: null, change: null }, chestCm: { value: null, change: null }, hipsCm: { value: null, change: null }, armCm: { value: null, change: null }, thighCm: { value: null, change: null } },
  leanMass: { leanMassKg: null, estimated: false, source: "missing" },
};

// Matches the Phase 1A domain bounds (server validation remains authoritative).
const FIELD_BOUNDS: Record<"weightKg" | "bodyFatPercent" | "leanMassKg" | "waistCm" | "chestCm" | "hipsCm" | "armCm" | "thighCm", { min: number; max: number }> = {
  weightKg: { min: 25, max: 400 },
  bodyFatPercent: { min: 3, max: 70 },
  leanMassKg: { min: 15, max: 250 },
  waistCm: { min: 40, max: 250 },
  chestCm: { min: 50, max: 250 },
  hipsCm: { min: 50, max: 250 },
  armCm: { min: 15, max: 80 },
  thighCm: { min: 25, max: 120 },
};

function numberOrEmpty(value: FormDataEntryValue | null): string | number {
  const text = String(value ?? "").trim();
  return text === "" ? "" : Number(text);
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ProgressTracker({ client, onWeightChange }: { client: Client; onWeightChange?: (weightKg: number | null) => void }) {
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

  // ---------- Body composition ----------
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [trend, setTrend] = useState<MeasurementTrend>(EMPTY_TREND);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const [showBodyForm, setShowBodyForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [previewWeight, setPreviewWeight] = useState("");
  const [previewBodyFat, setPreviewBodyFat] = useState("");

  async function loadBody() {
    if (client.id < 1) { setMeasurements([]); setTrend(EMPTY_TREND); return; }
    setBodyLoading(true);
    try {
      const response = await fetch(`/api/body-measurements?clientId=${client.id}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setBodyError(result.error ?? "Body composition could not be loaded."); setMeasurements([]); setTrend(EMPTY_TREND); }
      else { setMeasurements(result.measurements ?? []); setTrend(result.trend ?? EMPTY_TREND); setBodyError(""); }
    } catch { setBodyError("Body composition could not be loaded."); }
    setBodyLoading(false);
  }
  useEffect(() => {
    if (client.id < 1) return;
    let cancelled = false;
    void fetch(`/api/body-measurements?clientId=${client.id}`).then(response => response.json().catch(() => ({})).then(result => ({ response, result }))).then(({ response, result }) => {
      if (cancelled) return;
      if (!response.ok) { if (!cancelled) { setBodyError(result.error ?? "Body composition could not be loaded."); setMeasurements([]); setTrend(EMPTY_TREND); } }
      else { setMeasurements(result.measurements ?? []); setTrend(result.trend ?? EMPTY_TREND); setBodyError(""); }
    }).catch(() => { if (!cancelled) setBodyError("Body composition could not be loaded."); });
    return () => { cancelled = true; };
  }, [client.id]);

  // Informational lean-mass preview while filling the form — never persisted.
  const estimate = useMemo(() => {
    const weight = Number(previewWeight);
    const bodyFat = Number(previewBodyFat);
    if (!previewWeight.trim() || !previewBodyFat.trim() || !Number.isFinite(weight) || !Number.isFinite(bodyFat)) return null;
    return estimateLeanMassKg(weight, bodyFat);
  }, [previewWeight, previewBodyFat]);

  async function submitBodyMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      clientId: client.id,
      measuredAt: String(form.get("measuredAt") ?? ""),
      weightKg: numberOrEmpty(form.get("weightKg")),
      bodyFatPercent: numberOrEmpty(form.get("bodyFatPercent")),
      leanMassKg: numberOrEmpty(form.get("leanMassKg")),
      waistCm: numberOrEmpty(form.get("waistCm")),
      chestCm: numberOrEmpty(form.get("chestCm")),
      hipsCm: numberOrEmpty(form.get("hipsCm")),
      armCm: numberOrEmpty(form.get("armCm")),
      thighCm: numberOrEmpty(form.get("thighCm")),
      notes: String(form.get("notes") ?? ""),
    };
    setSaving(true);
    try {
      const response = await fetch("/api/body-measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The measurement could not be saved.");
      setShowBodyForm(false);
      setFormError("");
      setPreviewWeight("");
      setPreviewBodyFat("");
      await loadBody();
      // Surface the synced roster weight (unchanged for weightless/backdated entries).
      if (typeof result.currentWeight === "number" || result.currentWeight === null) {
        if (result.currentWeight !== client.currentWeight) onWeightChange?.(result.currentWeight);
      }
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "The measurement could not be saved.");
    } finally { setSaving(false); }
  }

  const compositionMetric = (label: string, value: number | null, unit: string, change: number | null) => (
    <div className="composition-metric" key={label}><span>{label}</span><b>{value !== null && value !== undefined ? `${value} ${unit}` : "—"}</b><em>{change !== null && change !== undefined ? `${change > 0 ? "+" : ""}${change} ${unit} vs previous` : "—"}</em></div>
  );

  return <section className="progress-tracker" id="progress"><div className="progress-heading"><div><p>CLIENT PROGRESS</p><h2>Measure what matters.</h2><span>Weekly updates, measurements and photos from {client.name}.</span></div><div><Link className="refresh-button" href={client.id > 0 ? `/client?preview=${client.id}` : "/client"}>Preview portal</Link><button className="refresh-button" onClick={load}>{loading ? "Loading…" : "Refresh"}</button></div></div>
    {client.id < 1 ? <div className="progress-empty"><strong>Choose a saved client to review real progress.</strong><span>Demo clients do not have a private portal or progress history.</span></div> : error ? <div className="progress-empty"><strong>Progress is not available yet.</strong><span>{error}</span></div> : entries.length === 0 ? <div className="progress-empty"><strong>{client.name} has not shared a weekly update yet.</strong><span>Use “Preview portal” to see the client experience, then share your client portal link.</span></div> : <div className="coach-progress-layout"><article className="coach-chart-card"><p>LATEST CHECK-IN</p><div className="coach-chart-metrics"><strong>{latest.weight ? `${latest.weight} kg` : "Check-in"}</strong><span>{change ? `${Number(change) > 0 ? "+" : ""}${change} kg since first update` : `Submitted ${new Date(latest.createdAt).toLocaleDateString()}`}</span></div><CoachChart entries={weightedEntries} /><div className="coach-score-row"><span>Energy <b>{latest.energy}/10</b></span><span>Sleep <b>{latest.sleep}/10</b></span><span>Adherence <b>{latest.adherence}%</b></span></div></article><article className="coach-measure-card"><p>MEASUREMENTS · LATEST</p><div>{metric("Waist", latest.waist)}{metric("Chest", latest.chest)}{metric("Hips", latest.hips)}{metric("Arm", latest.arm)}{metric("Thigh", latest.thigh)}</div><small>{latest.notes || "No note was included with this update."}</small></article><article className="coach-photo-card"><p>RECENT PROGRESS PHOTO</p>{latest.photoData ? <img src={latest.photoData} alt={`${client.name} progress update`} /> : <div className="no-photo">No photo shared</div>}<span>{new Date(latest.createdAt).toLocaleDateString()}</span></article></div>}

    <div className="body-composition">
      <div className="body-composition-heading"><div><p>BODY COMPOSITION</p><h3>Dedicated measurement history.</h3><span>Coach-recorded body measurements, separate from weekly progress updates. Missing values stay missing — nothing is shown as zero.</span></div><div><button className="refresh-button" disabled={client.id < 1 || saving} onClick={() => { setFormError(""); setPreviewWeight(""); setPreviewBodyFat(""); setShowBodyForm(true); }}>Add measurement</button></div></div>
      {bodyLoading && measurements.length === 0 ? <div className="progress-empty"><strong>Loading body composition…</strong></div>
        : client.id < 1 ? <div className="composition-empty"><strong>Choose a saved client.</strong><span>Demo clients do not have a body-composition ledger.</span></div>
          : bodyError ? <div className="composition-empty"><strong>Body composition is not available yet.</strong><span>{bodyError}</span></div>
            : measurements.length === 0 ? <div className="composition-empty"><strong>No body measurements recorded yet.</strong><span>Record the first measurement for {client.name} to start the history.</span></div>
              : <div className="body-composition-layout">
                  <article className="composition-card"><p>LATEST MEASUREMENT · {new Date(trend.latest?.measuredAt ?? measurements[0].measuredAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
                    <div className="composition-grid">
                      {compositionMetric("Weight", trend.latest?.weightKg ?? null, "kg", trend.deltas.weightKg.change)}
                      {compositionMetric("Body fat", trend.latest?.bodyFatPercent ?? null, "%", trend.deltas.bodyFatPercent.change)}
                      {trend.leanMass.source === "derived"
                        ? compositionMetric("Estimated lean mass", trend.leanMass.leanMassKg, "kg", null)
                        : compositionMetric("Lean mass", trend.latest?.leanMassKg ?? null, "kg", trend.deltas.leanMassKg.change)}
                      {compositionMetric("Waist", trend.latest?.waistCm ?? null, "cm", trend.deltas.waistCm.change)}
                      {compositionMetric("Chest", trend.latest?.chestCm ?? null, "cm", trend.deltas.chestCm.change)}
                      {compositionMetric("Hips", trend.latest?.hipsCm ?? null, "cm", trend.deltas.hipsCm.change)}
                      {compositionMetric("Arm", trend.latest?.armCm ?? null, "cm", trend.deltas.armCm.change)}
                      {compositionMetric("Thigh", trend.latest?.thighCm ?? null, "cm", trend.deltas.thighCm.change)}
                    </div>
                    <p className="composition-date">{trend.leanMass.source === "derived" ? `Lean mass estimated from weight + body fat — not a measured value.` : `Source: ${measurements[0].source.replace("_", " ")}`}</p>
                  </article>
                  <article className="composition-card"><p>HISTORY</p>
                    <div className="history-scroll"><div className="history-grid"><div className="history-head"><span>Date</span><span>Weight</span><span>Body fat</span><span>Waist</span><span>Lean mass</span></div>
                      {measurements.slice(0, 10).map(entry => <div className="history-row" key={entry.id}><span className="history-date">{new Date(entry.measuredAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span><span>{entry.weightKg !== null ? `${entry.weightKg} kg` : "—"}</span><span>{entry.bodyFatPercent !== null ? `${entry.bodyFatPercent}%` : "—"}</span><span>{entry.waistCm !== null ? `${entry.waistCm} cm` : "—"}</span><span>{entry.leanMassKg !== null ? `${entry.leanMassKg} kg` : "—"}</span></div>)}
                    </div></div>
                    {measurements.length > 10 && <p className="composition-more">{measurements.length} total — latest {10} shown.</p>}
                  </article>
                </div>}
    </div>

    {showBodyForm && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowBodyForm(false)}><form className="modal onboarding-form coach-onboarding-form body-form" onSubmit={submitBodyMeasurement} onMouseDown={event => event.stopPropagation()}>
      <div className="portal-form-head"><div><p>BODY COMPOSITION · {client.name}</p><h2>Add a measurement.</h2></div><button type="button" aria-label="Close" onClick={() => setShowBodyForm(false)}>×</button></div>
      <label>Measurement date<input name="measuredAt" type="date" defaultValue={todayInput()} max={todayInput()} required /></label>
      <div className="form-pair"><label>Weight (kg)<input name="weightKg" type="number" step="0.1" min={FIELD_BOUNDS.weightKg.min} max={FIELD_BOUNDS.weightKg.max} placeholder="—" onChange={event => setPreviewWeight(event.target.value)} /></label><label>Body fat (%)<input name="bodyFatPercent" type="number" step="0.1" min={FIELD_BOUNDS.bodyFatPercent.min} max={FIELD_BOUNDS.bodyFatPercent.max} placeholder="—" onChange={event => setPreviewBodyFat(event.target.value)} /></label></div>
      {estimate && <p className="estimate-hint">Estimated lean mass: {estimate.leanMassKg.toFixed(1)} kg — preview only, never saved as a measured value.</p>}
      <div className="form-pair"><label>Lean mass (kg)<input name="leanMassKg" type="number" step="0.1" min={FIELD_BOUNDS.leanMassKg.min} max={FIELD_BOUNDS.leanMassKg.max} placeholder="—" /></label><label>Waist (cm)<input name="waistCm" type="number" step="0.1" min={FIELD_BOUNDS.waistCm.min} max={FIELD_BOUNDS.waistCm.max} placeholder="—" /></label></div>
      <div className="form-pair"><label>Chest (cm)<input name="chestCm" type="number" step="0.1" min={FIELD_BOUNDS.chestCm.min} max={FIELD_BOUNDS.chestCm.max} placeholder="—" /></label><label>Hips (cm)<input name="hipsCm" type="number" step="0.1" min={FIELD_BOUNDS.hipsCm.min} max={FIELD_BOUNDS.hipsCm.max} placeholder="—" /></label></div>
      <div className="form-pair"><label>Arm (cm)<input name="armCm" type="number" step="0.1" min={FIELD_BOUNDS.armCm.min} max={FIELD_BOUNDS.armCm.max} placeholder="—" /></label><label>Thigh (cm)<input name="thighCm" type="number" step="0.1" min={FIELD_BOUNDS.thighCm.min} max={FIELD_BOUNDS.thighCm.max} placeholder="—" /></label></div>
      <label>Notes<textarea name="notes" placeholder="Context for this measurement…" /></label>
      <small>Every field is optional, but at least one measurement is required. Only what you actually measured is saved.</small>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="generate" disabled={saving}>{saving ? "Saving…" : "Save measurement"} <span>→</span></button>
    </form></div>}
  </section>;
}

function metric(label: string, value: number | null) { return <span key={label}>{label}<b>{value ? `${value} cm` : "—"}</b></span>; }

function CoachChart({ entries }: { entries: Entry[] }) {
  if (entries.length < 2) return <div className="coach-chart-empty">A second weight update will draw the trend.</div>;
  const values = entries.map(entry => entry.weight ?? 0); const low = Math.min(...values); const high = Math.max(...values); const spread = Math.max(high - low, 0.5); const points = values.map((weight, index) => `${(index / (values.length - 1)) * 100},${84 - ((weight - low) / spread) * 64}`).join(" ");
  return <div className="coach-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><small>{entries[0].weight} kg <i /> {entries.at(-1)?.weight} kg</small></div>;
}
