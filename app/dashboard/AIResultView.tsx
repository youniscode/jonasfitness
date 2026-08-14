"use client";

import { useState } from "react";

type Mode = "programme" | "nutrition" | "chat";
type Props = { result: unknown; mode: Mode; clientId: number; clientName: string; goal: string; sessionsPerWeek: number; notice: string };
type Data = Record<string, unknown>;

function record(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function programmeSessions(data: Data, days: number) {
  const raw = [data.sessions, data.days, data.workouts, data.programme, data.program].find(Array.isArray);
  const sessions = Array.isArray(raw) ? raw.map(record).map((session, index) => ({
    ...session,
    name: text(session.name, text(session.title, `Session ${index + 1}`)),
    focus: text(session.focus, text(session.goal, "Progressive training session")),
    work: strings(session.work).length ? strings(session.work) : strings(session.exercises).length ? strings(session.exercises) : strings(session.movements),
  })) : [];
  if (sessions.length) return sessions;
  return Array.from({ length: days }, (_, index) => ({ name: `Session ${index + 1}`, focus: "Coach-selected progression", work: ["Main movement · 3×5–8", "Secondary movement · 3×8–12", "Accessory work · 3×10–15"] }));
}

export default function AIResultView({ result, mode, clientId, clientName, goal, sessionsPerWeek, notice }: Props) {
  const [message, setMessage] = useState(""); const data = record(result);
  async function copyResult() { await navigator.clipboard.writeText(JSON.stringify(result, null, 2)); setMessage("Copied to clipboard"); }
  async function saveProgramme() {
    if (clientId < 1) { setMessage("Add a real client before saving this programme"); return; }
    setMessage("Saving…");
    const response = await fetch("/api/programmes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, title: text(data.title, "AI programme"), goal, sessionsPerWeek, content: result }) });
    const payload = await response.json(); setMessage(response.ok ? `Approved and saved for ${clientName}` : payload.error ?? "Could not save programme");
  }

  if (mode === "programme") {
    const sessions = programmeSessions(data, sessionsPerWeek);
    return <section className="ai-result programme-result">
      <div className="result-kicker"><span>PROGRAMME READY</span><i>{sessions.length} sessions</i></div>
      <h3>{text(data.title, `${sessionsPerWeek}-day ${goal} programme`)}</h3>
      <p className="result-overview">{text(data.overview, "A coach-ready training draft built from the selected goal and schedule.")}</p>
      <div className="session-grid">{sessions.map((session, index) => <article className="session-card" key={`${text(session.name)}-${index}`}>
        <div><span>DAY {String(index + 1).padStart(2, "0")}</span><b>{index === 0 ? "START" : "SESSION"}</b></div>
        <h4>{text(session.name, `Session ${index + 1}`)}</h4><p>{text(session.focus, "Progressive training session")}</p>
        <ul>{strings(session.work).map((exercise, exerciseIndex) => <li key={`${exercise}-${exerciseIndex}`}><i>{exerciseIndex + 1}</i><span>{exercise}</span></li>)}</ul>
      </article>)}</div>
      <div className="result-actions"><button type="button" onClick={saveProgramme}>Approve & save <span>✓</span></button><button type="button" className="secondary" onClick={copyResult}>Copy programme <span>□</span></button></div>
      {message && <p className="result-message">{message}</p>}<small>{notice}</small>
    </section>;
  }

  if (mode === "nutrition") {
    const items = strings(data.items); const checks = strings(data.coachChecks);
    return <section className="ai-result nutrition-result"><div className="result-kicker"><span>NUTRITION FRAMEWORK</span><i>Coach review</i></div><h3>{text(data.headline, "Practical nutrition guidance")}</h3>
      <div className="guidance-list">{items.map((item, index) => <p key={item}><i>{String(index + 1).padStart(2, "0")}</i><span>{item}</span></p>)}</div>
      {checks.length > 0 && <div className="coach-checks"><strong>Before sharing with the client</strong>{checks.map(check => <p key={check}>✓ {check}</p>)}</div>}
      <div className="result-actions"><button type="button" onClick={copyResult}>Copy guidance <span>□</span></button></div>{message && <p className="result-message">{message}</p>}<small>{notice}</small>
    </section>;
  }

  return <section className="ai-result chat-result"><div className="result-kicker"><span>CLIENT RESPONSE DRAFT</span><i>Not sent</i></div><h3>Ready for your review</h3>
    <div className="message-bubble"><span>JF</span><p>{text(data.reply, "Review the client’s recent progress and adjust one variable at a time.")}</p></div>
    {text(data.coachReview) && <div className="coach-review"><strong>Coach note</strong><p>{text(data.coachReview)}</p></div>}
    <div className="result-actions"><button type="button" onClick={copyResult}>Copy response <span>□</span></button></div>{message && <p className="result-message">{message}</p>}<small>{notice}</small>
  </section>;
}
