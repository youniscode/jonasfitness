"use client";

// Mobile-first Bodyweight page. ONE page-level KG/LB toggle controls both the
// entry form and every displayed value (a clearly defined page choice, not a
// global unit-preference architecture); storage is canonical kg and lb input
// converts at the API boundary. The chosen unit is persisted locally under the
// jonas-progress-* naming convention so it survives navigation/reload (no DB
// column, no account-wide unit architecture). Pure validation is mirrored here
// with the localized weightRequired/weightBounds copy; the server validates again.
import { useEffect, useMemo, useState } from "react";
import { useProgressLang } from "../progress-lang";
import { progressLocale } from "../progress-text";
import {
  BODYWEIGHT_KG_MAX,
  BODYWEIGHT_KG_MIN,
  buildBodyweightTrend,
  fromCanonicalKg,
  KG_PER_LB,
  type BodyweightUnit,
  type PublicBodyweightEntry,
} from "../../../lib/bodyweight";
import { persistBodyweightUnit, readStoredBodyweightUnit } from "../../../lib/bodyweight-unit-store";

const round1 = (value: number) => Math.round(value * 10) / 10;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

function localDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The stored calendar date (server stores date-only entries at UTC noon). */
function entryDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function validateEntry(weightText: string, unit: BodyweightUnit, t: { weightRequired: string; weightBounds: string }):
  | { ok: true; weightKg: number }
  | { ok: false; message: string } {
  if (weightText.trim() === "") return { ok: false, message: t.weightRequired };
  const value = Number(weightText);
  const kg = unit === "lb" ? value * KG_PER_LB : value;
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: t.weightRequired };
  if (kg < BODYWEIGHT_KG_MIN || kg > BODYWEIGHT_KG_MAX) return { ok: false, message: t.weightBounds };
  return { ok: true, weightKg: round1(kg) };
}

export default function BodyweightPanel() {
  const { lang, t } = useProgressLang();
  const locale = progressLocale(lang);
  const [entries, setEntries] = useState<PublicBodyweightEntry[] | null>(null);
  const [unit, setUnit] = useState<BodyweightUnit>(() => readStoredBodyweightUnit());
  const [error, setError] = useState("");
  // Add form
  const [date, setDate] = useState(() => localDateInput(new Date()));
  const [weight, setWeight] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Edit / delete
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = async () => {
    const data = await json<{ entries: PublicBodyweightEntry[] }>("/api/progress/bodyweight");
    setEntries(data.entries);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await json<{ entries: PublicBodyweightEntry[] }>("/api/progress/bodyweight");
        if (!cancelled) setEntries(data.entries);
      } catch {
        if (!cancelled) setError(t.error);
      }
    })();
    return () => { cancelled = true; };
  }, [t.error]);

  const trend = useMemo(() => buildBodyweightTrend(entries ?? []), [entries]);
  const displayWeight = (weightKg: number) => round1(fromCanonicalKg(weightKg, unit));

  const fmtWeight = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  const submit = async () => {
    const validated = validateEntry(weight, unit, t);
    if (!validated.ok) { setFormError(validated.message); return; }
    setBusy(true);
    setFormError("");
    try {
      await json("/api/progress/bodyweight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight: Number(weight), unit, measuredAt: date }),
      });
      setWeight("");
      await load();
    } catch {
      setFormError(t.error);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (entry: PublicBodyweightEntry) => {
    setEditingId(entry.id);
    setEditDate(entryDateInput(entry.measuredAt));
    setEditWeight(String(displayWeight(entry.weightKg)));
    setFormError("");
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const validated = validateEntry(editWeight, unit, t);
    if (!validated.ok) { setFormError(validated.message); return; }
    setBusy(true);
    setFormError("");
    try {
      await json(`/api/progress/bodyweight/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingId, weight: Number(editWeight), unit, measuredAt: editDate }),
      });
      setEditingId(null);
      await load();
    } catch {
      setFormError(t.error);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deletingId === null) return;
    setBusy(true);
    setFormError("");
    try {
      await json(`/api/progress/bodyweight/${deletingId}`, { method: "DELETE" });
      setDeletingId(null);
      await load();
    } catch {
      setFormError(t.error);
    } finally {
      setBusy(false);
    }
  };

  const points = trend.points.map((point) => ({ ...point, displayKg: displayWeight(point.weightKg) }));
  const chartValues = points.map((point) => point.displayKg);
  const chartLow = chartValues.length ? Math.min(...chartValues) : 0;
  const chartHigh = chartValues.length ? Math.max(...chartValues) : 0;
  const spread = Math.max(chartHigh - chartLow, 0.5);
  const polyline = points.map((point, index) => `${(index / Math.max(points.length - 1, 1)) * 96 + 2},${86 - ((point.displayKg - chartLow) / spread) * 70}`).join(" ");

  const changeValue = trend.changeKg !== null ? displayWeight(trend.changeKg) : null;

  // The add-entry form is ONE implementation shared by the populated page (its
  // "add measurement" panel) and the zero-entry state (shown directly under
  // the empty message so the page ends naturally above the fixed nav).
  const unitToggle = (
    <div className="progress-bw-unit" role="group" aria-label={t.unit}>
      {(["kg", "lb"] as const).map((choice) => <button key={choice} type="button" className={unit === choice ? "active" : ""} onClick={() => { setUnit(choice); persistBodyweightUnit(choice); setEditingId(null); }}>{choice === "kg" ? t.kg : t.lb}</button>)}
    </div>
  );
  const weightFields = (
    <div className="progress-bw-form">
      <label>{t.measurementDate}<input type="date" value={date} max={localDateInput(new Date())} onChange={(e) => setDate(e.target.value)} /></label>
      <label>{t.weightField}<input type="text" inputMode="decimal" placeholder="80" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
      <button type="button" className="progress-cta" disabled={busy} onClick={() => { void submit(); }}>{t.add}<span>→</span></button>
    </div>
  );
  const addEntryPanel = (
    <section className="progress-panel">
      <div className="progress-panel-head"><div><p>{t.addMeasurement}</p></div></div>
      {unitToggle}
      {weightFields}
      {formError && <p className="progress-error" role="alert">{formError}</p>}
    </section>
  );

  return (
    <section className="progress-base">
      <div className="progress-dash-head"><div><p>{t.kicker}</p><h1>{t.bodyweightTitle}</h1><span>{t.bodyweightIntro}</span></div></div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      {entries === null ? null : entries.length === 0 ? (
        <div className="progress-bw-empty">
          <div className="progress-empty"><strong>{t.noEntries}</strong><span>{t.noEntriesHint}</span></div>
          {addEntryPanel}
        </div>
      ) : (
        <>
          <div className="progress-bw-latest">
            <div>
              <small>{t.latest}</small>
              <strong>{fmtWeight(trend.latest ? displayWeight(trend.latest.weightKg) : 0)} <i>{unit}</i></strong>
              <span>{trend.latest ? fmtDate(trend.latest.measuredAt) : ""}</span>
            </div>
            {changeValue !== null && (
              <div className="progress-bw-delta">
                <small>{t.change}</small>
                <strong className={trend.changeKg === null || trend.changeKg >= 0 ? "" : "down"}>{trend.changeKg !== null && trend.changeKg > 0 ? "+" : ""}{fmtWeight(Math.abs(changeValue))} <i>{unit}</i></strong>
              </div>
            )}
          </div>
          <div className="progress-dash-grid">
            <section className="progress-panel">
              <div className="progress-panel-head"><div><p>{t.historyLabel}</p></div></div>
              {points.length < 2
                ? <div className="progress-chart-empty"><strong>{points.length === 1 ? `${fmtWeight(chartValues[0])} ${unit}` : "-"}</strong><span>{t.trendOneMore}</span></div>
                : <div className="progress-chart"><div className="progress-chart-head"><b>{fmtWeight(chartLow)}–{fmtWeight(chartHigh)} {unit}</b><span>{points.length} {t.sessions.toLowerCase()}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={t.trendAria}><path d="M2 16H96M2 52H96M2 88H96" className="progress-chart-grid" /><polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" /></svg><div className="progress-chart-dates"><span>{fmtDate(points[0].measuredAt)}</span><span>{fmtDate(points[points.length - 1].measuredAt)}</span></div></div>}
            </section>
            {addEntryPanel}
          </div>
          <section className="progress-panel">
            <div className="progress-panel-head"><div><p>{t.historyLabel}</p></div></div>
            <div className="progress-bw-list">
              {[...trend.points].reverse().map((entry) => (
                <div key={entry.id} className="progress-bw-row">
                  {editingId === entry.id ? (
                    <div className="progress-bw-edit">
                      <label>{t.measurementDate}<input type="date" value={editDate} max={localDateInput(new Date())} onChange={(e) => setEditDate(e.target.value)} /></label>
                      <label>{t.weightField}<input type="text" inputMode="decimal" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} /></label>
                      <div className="progress-bw-row-actions">
                        <button type="button" className="progress-cta" disabled={busy} onClick={() => { void saveEdit(); }}>{t.save}<span>→</span></button>
                        <button type="button" className="progress-ghost" disabled={busy} onClick={() => setEditingId(null)}>{t.cancel}</button>
                      </div>
                    </div>
                  ) : deletingId === entry.id ? (
                    <div className="progress-bw-confirm">
                      <strong>{t.deleteEntryTitle}</strong>
                      <span>{t.deleteEntryBody}</span>
                      <div className="progress-bw-row-actions">
                        <button type="button" className="progress-ghost danger" disabled={busy} onClick={() => { void confirmDelete(); }}>{t.delete}</button>
                        <button type="button" className="progress-ghost" disabled={busy} onClick={() => setDeletingId(null)}>{t.cancel}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span><b>{fmtWeight(displayWeight(entry.weightKg))} {unit}</b><small>{fmtDate(entry.measuredAt)}</small></span>
                      <div className="progress-bw-row-actions">
                        <button type="button" className="progress-ghost" onClick={() => startEdit(entry)}>{t.edit}</button>
                        <button type="button" className="progress-ghost danger" onClick={() => { setDeletingId(entry.id); setEditingId(null); }}>{t.delete}</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}