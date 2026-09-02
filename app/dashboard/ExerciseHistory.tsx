"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExerciseHistoryItem, ExerciseHistoryPoint } from "../lib/exercise-history";

type Client = { id: number; name: string };
const number = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);

function HistoryChart({ points }: { points: ExerciseHistoryPoint[] }) {
  const values = points.map((point) => point.estimatedOneRepMax);
  if (values.length < 2) return <div className="exercise-history-empty-chart"><strong>Baseline recorded</strong><span>Complete this exercise again to reveal its performance line.</span></div>;
  const low = Math.min(...values); const high = Math.max(...values); const spread = Math.max(high - low, 1);
  const coordinates = values.map((value, index) => `${4 + (index / (values.length - 1)) * 92},${88 - ((value - low) / spread) * 72}`).join(" ");
  return <div className="exercise-history-chart"><div className="chart-labels"><span>{number(high)} kg</span><span>{number(low)} kg</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Estimated one repetition maximum trend"><path d="M4 16H96M4 52H96M4 88H96" className="history-grid"/><polyline points={coordinates} fill="none" vectorEffect="non-scaling-stroke"/><g>{coordinates.split(" ").map((coordinate, index) => { const [cx, cy] = coordinate.split(","); return <circle key={`${cx}-${cy}-${index}`} cx={cx} cy={cy} r="1.8"/>; })}</g></svg><div className="chart-dates"><span>{new Date(points[0].date).toLocaleDateString()}</span><span>{new Date(points.at(-1)!.date).toLocaleDateString()}</span></div></div>;
}

export default function ExerciseHistory({ client }: { client: Client }) {
  const [items, setItems] = useState<ExerciseHistoryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (client.id < 1) { setItems([]); setSelectedKey(""); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/exercise-history?clientId=${client.id}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Exercise history could not be loaded.");
      const exercises = result.exercises as ExerciseHistoryItem[];
      setItems(exercises); setSelectedKey((current) => exercises.some((item) => item.key === current) ? current : exercises[0]?.key ?? "");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Exercise history could not be loaded."); }
    finally { setLoading(false); }
  }, [client.id]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const selected = useMemo(() => items.find((item) => item.key === selectedKey) ?? items[0], [items, selectedKey]);
  if (client.id < 1) return null;
  return <section className="exercise-history" id="exercise-history"><header><div><p>EXERCISE HISTORY · PERSONAL RECORDS</p><h2>Every lift tells a story.</h2><span>Track load, volume and estimated strength across coach-led and independent workouts for {client.name}.</span></div><button className="refresh-button" onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></header>
    {error ? <p className="form-error">{error}</p> : selected ? <><div className="exercise-history-toolbar"><label>Exercise<select value={selected.key} onChange={(event) => setSelectedKey(event.target.value)}>{items.map((item) => <option value={item.key} key={item.key}>{item.name} · {item.sessions} session{item.sessions === 1 ? "" : "s"}</option>)}</select></label><span><b>{selected.trend.estimatedOneRepMax > 0 ? "+" : ""}{number(selected.trend.estimatedOneRepMax)} kg</b> estimated strength vs last session</span></div>
      <div className="exercise-record-grid"><article><small>HEAVIEST LOAD</small><strong>{number(selected.records.heaviestWeight)} kg</strong><span>Personal record</span></article><article><small>ESTIMATED 1RM</small><strong>{number(selected.records.estimatedOneRepMax)} kg</strong><span>Epley estimate</span></article><article><small>BEST SESSION VOLUME</small><strong>{number(selected.records.bestSessionVolume)} kg</strong><span>Completed sets only</span></article><article><small>BEST REPS</small><strong>{selected.records.bestReps}</strong><span>At a recorded load</span></article></div>
      <div className="exercise-history-body"><article><div className="history-panel-head"><div><small>STRENGTH TREND</small><h3>{selected.name}</h3></div><b>{selected.sessions} sessions</b></div><HistoryChart points={selected.points}/></article><article><div className="history-panel-head"><div><small>RECENT PERFORMANCE</small><h3>Session by session.</h3></div></div><div className="exercise-history-list">{selected.points.toReversed().slice(0, 7).map((point, index) => <div key={point.workoutId}><span><b>{new Date(point.date).toLocaleDateString()}</b><small>{point.workoutTitle}</small></span><span><b>{number(point.bestSet.weight)} kg × {point.bestSet.reps}</b><small>{point.sets} sets · {number(point.volume)} kg · RIR {point.averageRir ?? "-"}</small></span>{index === 0 && <em>LATEST</em>}</div>)}</div></article></div></> : <div className="progress-empty"><strong>No exercise records yet.</strong><span>Complete a workout with at least one set to create the first baseline.</span></div>}
  </section>;
}
