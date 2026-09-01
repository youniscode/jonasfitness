"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useProgressLang } from "../progress-lang";
import { progressLocale } from "../progress-text";

type Routine = { id: number; name: string; notes: string; createdAt: string; updatedAt: string; exercises: { id: number }[] };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

export default function RoutinesView() {
  const { lang, t } = useProgressLang();
  const locale = progressLocale(lang);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Inline-effect fetch to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/progress/routines").then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })) as Promise<{ response: Response; data: { routines?: Routine[]; error?: string } }>).then(({ response, data }) => {
      if (cancelled) return;
      if (!response.ok) { setError(data?.error ?? t.error); setRoutines([]); }
      else { setRoutines(data?.routines ?? []); setError(""); }
    }).catch(() => { if (!cancelled) setError(t.error); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t.error]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Capture the form element BEFORE the await: React nulls event.currentTarget
    // once the handler yields, so touching it after the POST would throw.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    setCreating(true);
    try {
      const data = await json<{ routine: Routine }>("/api/progress/routines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      formElement.reset();
      setError("");
      // Navigate straight to the new routine to add exercises.
      window.location.href = `/progress/routines/${data.routine.id}`;
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : t.error);
    } finally { setCreating(false); }
  }

  return (
    <section className="progress-base">
      <div className="progress-dash-head">
        <div><p>{t.kicker}</p><h1>{t.routinesTitle}</h1><span>{t.routinesIntro}</span></div>
      </div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      <form className="progress-create-routine" onSubmit={create}>
        <label>{t.newRoutine}<input name="name" placeholder={t.routinePlaceholder} maxLength={80} /></label>
        <button className="progress-cta" disabled={creating}>{t.add}<span>+</span></button>
      </form>

      {loading ? <p className="progress-muted">{t.saving}</p> : routines.length === 0
        ? <div className="progress-empty"><strong>{t.noRoutines}</strong><span>{t.noRoutinesHint}</span></div>
        : <div className="progress-routine-list">
            {routines.map((routine) => (
              <Link key={routine.id} href={`/progress/routines/${routine.id}`} className="progress-routine-card">
                <span><small>{routine.exercises.length} {t.exercises.toLowerCase()}</small><strong>{routine.name}</strong>{routine.notes && <span>{routine.notes}</span>}</span>
                <span>{new Date(routine.updatedAt).toLocaleDateString(locale)}{routine.exercises.length > 0 ? ` · ${routine.exercises.length} ex` : ""}</span>
              </Link>
            ))}
          </div>}
    </section>
  );
}