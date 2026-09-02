"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProgressLang } from "../progress-lang";
import { progressLocale } from "../progress-text";
import { exerciseDisplayName } from "../../../lib/exercise-catalogue";

type Point = { workoutId: number; workoutTitle: string; date: string; sets: number; bestWeight: number; bestReps: number; averageRir: number | null; volume: number; bestSetVolume: number; estimatedOneRepMax: number; bestSet: { weight: number; reps: number; rir: string; estimatedOneRepMax: number } };
type Item = { key: string; name: string; nameFr?: string; nameAr?: string; sessions: number; latestDate: string; records: { heaviestWeight: number; bestReps: number; bestSetVolume: number; bestSessionVolume: number; estimatedOneRepMax: number }; trend: { weight: number; estimatedOneRepMax: number }; points: Point[] };

async function fetchItems(): Promise<Item[]> {
  const response = await fetch("/api/progress/history");
  const data = await response.json().catch(() => ({ exercises: [] })) as { exercises: Item[] };
  return data.exercises;
}

function Chart({ points, locale, t }: { points: Point[]; locale: string; t: { sessions: string; max: string; trendHint: string; trendOneMore: string; trendAria: string } }) {
  if (points.length < 2) return <div className="progress-chart-empty"><strong>{points.length === 1 ? `${points[0].estimatedOneRepMax} kg` : "-"}</strong><span>{points.length === 1 ? t.trendOneMore : t.trendHint}</span></div>;
  const values = points.map((p) => p.estimatedOneRepMax);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(high - low, 0.5);
  const polyline = points.map((p, i) => `${(i / (points.length - 1)) * 96 + 2},${86 - ((p.estimatedOneRepMax - low) / spread) * 70}`).join(" ");
  return (
    <div className="progress-chart">
      <div className="progress-chart-head"><b>{t.max} · {Math.round(low)}–{Math.round(high)}</b><span>{points.length} {t.sessions.toLowerCase()}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={t.trendAria}><path d="M2 16H96M2 52H96M2 88H96" className="progress-chart-grid" /><polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" /></svg>
      <div className="progress-chart-dates"><span>{new Date(points[0].date).toLocaleDateString(locale)}</span><span>{new Date(points.at(-1)!.date).toLocaleDateString(locale)}</span></div>
    </div>
  );
}

export default function HistoryPanel({ initialKey }: { initialKey?: string }) {
  const { lang, t } = useProgressLang();
  const locale = progressLocale(lang);
  const [items, setItems] = useState<Item[]>([]);
  const [key, setKey] = useState(initialKey ?? "");
  const [error, setError] = useState("");
  const fmt = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  useEffect(() => {
    fetchItems().then((list) => {
      setItems(list);
      if (!key && list.length) setKey(list[0].key);
    }).catch(() => setError(t.error));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [t.error]);

  const selected = items.find((item) => item.key === key) ?? null;

  return (
    <section className="progress-base">
      <div className="progress-dash-head"><div><p>{t.kicker}</p><h1>{t.historyTitle}</h1><span>{t.historyIntro}</span></div></div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="progress-empty"><strong>{t.noHistory}</strong><span>{t.noHistoryHint}</span><Link className="progress-cta" href="/progress/routines">{t.createRoutine}<span>→</span></Link></div>
      ) : (
        <>
          <label className="progress-history-select">{t.perExercise}<select value={selected?.key ?? ""} onChange={(e) => setKey(e.target.value)}>{items.map((item) => <option key={item.key} value={item.key}>{exerciseDisplayName(item, lang)}</option>)}</select></label>
          {selected && (
            <div className="progress-history-layout">
              <div className="progress-records">
                <article><small>{t.load}</small><strong>{fmt(selected.records.heaviestWeight)} kg</strong></article>
                <article className="lime"><small>{t.max}</small><strong>{fmt(selected.records.estimatedOneRepMax)} kg</strong></article>
                <article><small>{t.volumeBest}</small><strong>{fmt(selected.records.bestSessionVolume)} kg</strong></article>
                <article><small>{t.setsBest}</small><strong>{selected.records.bestReps}</strong></article>
              </div>
              <div className="progress-history-main">
                <Chart points={selected.points} locale={locale} t={t} />
                <div className="progress-history-recent">
                  <p>{t.recentSessions}</p>
                  {selected.points.toReversed().slice(0, 6).map((point) => (
                    <div key={point.workoutId}><span><b>{new Date(point.date).toLocaleDateString(locale)}</b><small>{point.workoutTitle}</small></span><strong>{fmt(point.bestSet.weight)} kg × {point.bestSet.reps}<small>{point.sets} {t.sets.toLowerCase()}</small></strong></div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}