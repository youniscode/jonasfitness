"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReminderLanguage, ReminderMessages } from "../lib/reminders";

type NotificationItem = { id: number; kind: string; severity: "high" | "medium" | "info"; title: string; message: string; actionHref: string; clientId: number | null; leadId: number | null; scheduledFor: string | null; readAt: string | null; createdAt: string };
type Communication = { id: number; recipientName: string; recipientAddress: string; channel: string; language: string; subject: string; message: string; status: string; relatedType: string; relatedId: number | null; relatedKey: string; createdAt: string };
type Reminder = { id: string; relatedType: "session_reminder" | "lead_follow_up"; relatedId: number; relatedKey: string; clientId: number | null; leadId: number | null; recipientName: string; phone: string; email: string; preferredLanguage: ReminderLanguage; subject: string; scheduledFor: string | null; messages: ReminderMessages; latestCommunication: Communication | null };
type Briefing = { sessions: number; consultations: number; pulseAlerts: number; followUps: number; clientReviews: number };
type Payload = { generatedAt: string; briefing: Briefing; notifications: NotificationItem[]; reminders: Reminder[]; communications: Communication[] };

const emptyPayload: Payload = { generatedAt: "", briefing: { sessions: 0, consultations: 0, pulseAlerts: 0, followUps: 0, clientReviews: 0 }, notifications: [], reminders: [], communications: [] };
const languageLabels: Record<ReminderLanguage, string> = { fr: "FR", en: "EN", ar: "AR" };

function formatDate(value: string | null) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function phoneForWhatsApp(value: string) {
  return value.replace(/[^\d]/g, "").replace(/^00/, "");
}

function notificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export default function CoachNotifications({ onSelectClient }: { onSelectClient: (clientId: number, target: string) => void }) {
  const [data, setData] = useState<Payload>(emptyPayload);
  const [tab, setTab] = useState<"alerts" | "reminders" | "history">("alerts");
  const [languages, setLanguages] = useState<Record<string, ReminderLanguage>>({});
  const [permission, setPermission] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const showDeviceNotifications = useCallback(async (payload: Payload) => {
    if (!("Notification" in window) || Notification.permission !== "granted" || localStorage.getItem("jonas-phone-alerts") !== "enabled") return;
    const stored = JSON.parse(localStorage.getItem("jonas-seen-notifications-v1") ?? "[]") as number[];
    const seen = new Set(stored);
    const fresh = payload.notifications.filter((item) => !item.readAt && item.kind !== "daily_briefing" && item.severity !== "info" && !seen.has(item.id));
    if (!fresh.length) return;
    const registration = await navigator.serviceWorker?.ready.catch(() => null);
    for (const item of fresh.slice(0, 3)) {
      if (registration) await registration.showNotification(item.title, { body: item.message, icon: "/icon", badge: "/icon", tag: `jonas-${item.id}`, data: { url: `/dashboard${item.actionHref}` } });
      else new Notification(item.title, { body: item.message, icon: "/icon", tag: `jonas-${item.id}` });
      seen.add(item.id);
    }
    localStorage.setItem("jonas-seen-notifications-v1", JSON.stringify([...seen].slice(-200)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/coach-notifications", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load reminders.");
      const next = payload as Payload;
      setData(next);
      setLanguages((current) => {
        const updated = { ...current };
        next.reminders.forEach((reminder) => { updated[reminder.id] ??= reminder.preferredLanguage; });
        return updated;
      });
      await showDeviceNotifications(next);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not load reminders."); }
    finally { setLoading(false); }
  }, [showDeviceNotifications]);

  useEffect(() => {
    const first = window.setTimeout(() => { setPermission(notificationPermission()); void load(); }, 0);
    const refresh = window.setInterval(() => { void load(); }, 3 * 60 * 1000);
    return () => { window.clearTimeout(first); window.clearInterval(refresh); };
  }, [load]);

  const unread = data.notifications.filter((item) => !item.readAt).length;
  const urgent = data.notifications.filter((item) => !item.readAt && item.severity === "high").length;
  const sortedNotifications = useMemo(() => [...data.notifications].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || b.createdAt.localeCompare(a.createdAt)), [data.notifications]);

  async function enablePhoneAlerts() {
    if (!("Notification" in window)) { setNotice("Browser notifications are not supported on this device."); return; }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      localStorage.setItem("jonas-phone-alerts", "enabled");
      setNotice("Phone alerts enabled. New important alerts will appear when Jonas Progress synchronises.");
      await showDeviceNotifications(data);
    } else setNotice("Notifications remain off. You can still use every in-app reminder.");
  }

  async function changeNotification(id: number, action: "read" | "dismiss") {
    setBusy(`${action}-${id}`);
    try {
      const response = await fetch("/api/coach-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Notification could not be updated.");
      setData((current) => action === "dismiss"
        ? { ...current, notifications: current.notifications.filter((item) => item.id !== id) }
        : { ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, readAt: payload.notification.readAt } : item) });
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Notification could not be updated."); }
    finally { setBusy(""); }
  }

  async function markAllRead() {
    setBusy("all");
    try {
      const response = await fetch("/api/coach-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read_all" }) });
      if (!response.ok) throw new Error("Notifications could not be updated.");
      const readAt = new Date().toISOString();
      setData((current) => ({ ...current, notifications: current.notifications.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) }));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Notifications could not be updated."); }
    finally { setBusy(""); }
  }

  function openNotification(item: NotificationItem) {
    if (!item.readAt) void changeNotification(item.id, "read");
    if (item.clientId) onSelectClient(item.clientId, item.actionHref);
    else document.querySelector(item.actionHref)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function recordCommunication(reminder: Reminder, status: "prepared" | "opened" | "sent", channel: "copy" | "whatsapp" | "email") {
    const language = languages[reminder.id] ?? reminder.preferredLanguage;
    const key = `${status}-${channel}-${reminder.id}`;
    setBusy(key);
    try {
      const response = await fetch("/api/coach-notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relatedType: reminder.relatedType, relatedId: reminder.relatedId, relatedKey: reminder.relatedKey, status, channel, language, subject: reminder.subject, message: reminder.messages[language] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Communication could not be recorded.");
      setData((current) => ({
        ...current,
        reminders: current.reminders.map((item) => item.id === reminder.id ? { ...item, latestCommunication: payload.communication } : item),
        communications: [payload.communication, ...current.communications],
      }));
      setNotice(status === "sent" ? `Marked sent to ${reminder.recipientName}.` : status === "opened" ? `WhatsApp opened for ${reminder.recipientName}.` : "Message copied.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Communication could not be recorded."); }
    finally { setBusy(""); }
  }

  async function copyReminder(reminder: Reminder) {
    const language = languages[reminder.id] ?? reminder.preferredLanguage;
    try {
      await navigator.clipboard.writeText(reminder.messages[language]);
      await recordCommunication(reminder, "prepared", "copy");
    } catch { setError("The message could not be copied. Open WhatsApp instead."); }
  }

  function openWhatsApp(reminder: Reminder) {
    const language = languages[reminder.id] ?? reminder.preferredLanguage;
    const number = phoneForWhatsApp(reminder.phone);
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(reminder.messages[language])}`, "_blank", "noopener,noreferrer");
    void recordCommunication(reminder, "opened", "whatsapp");
  }

  function openEmail(reminder: Reminder) {
    const language = languages[reminder.id] ?? reminder.preferredLanguage;
    window.location.href = `mailto:${reminder.email}?subject=${encodeURIComponent(reminder.subject)}&body=${encodeURIComponent(reminder.messages[language])}`;
    void recordCommunication(reminder, "opened", "email");
  }

  return <section className="coach-notifications" id="coach-notifications">
    <header className="notification-heading">
      <div className="notification-title"><span className={urgent ? "notification-bell urgent" : "notification-bell"}>♢{unread ? <b>{unread}</b> : null}</span><div><p>SMART REMINDERS</p><h2>Stay ahead without chasing.</h2><span>Free in-app alerts, multilingual messages and a complete contact trail.</span></div></div>
      <div className="notification-heading-actions"><button type="button" className="notification-enable" onClick={() => void enablePhoneAlerts()}>{permission === "granted" ? "Phone alerts on ✓" : "Enable phone alerts"}</button><button type="button" onClick={() => void load()}>{loading ? "Syncing…" : "Refresh"}</button></div>
    </header>

    {notice ? <p className="notification-notice">✓ {notice}</p> : null}
    {error ? <p className="notification-error" role="alert">{error}</p> : null}

    <div className="daily-briefing">
      <div><p>DAILY BRIEFING</p><strong>{urgent ? `${urgent} urgent ${urgent === 1 ? "alert" : "alerts"}` : "No urgent alerts"}</strong><span>{data.briefing.sessions} sessions · {data.briefing.consultations} consultations · {data.briefing.followUps} follow-ups · {data.briefing.clientReviews} client reviews</span></div>
      <div className="briefing-score"><small>PULSE</small><strong>{data.briefing.pulseAlerts}</strong><span>{data.briefing.pulseAlerts ? "prepare now" : "all clear"}</span></div>
    </div>

    <nav className="notification-tabs" aria-label="Reminder views">
      <button type="button" className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>Alerts <span>{unread}</span></button>
      <button type="button" className={tab === "reminders" ? "active" : ""} onClick={() => setTab("reminders")}>Send reminders <span>{data.reminders.length}</span></button>
      <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Contact history <span>{data.communications.length}</span></button>
    </nav>

    {tab === "alerts" ? <div className="notification-panel">
      <div className="notification-panel-head"><span>{data.notifications.length} current notifications</span>{unread ? <button type="button" disabled={busy === "all"} onClick={() => void markAllRead()}>{busy === "all" ? "Saving…" : "Mark all read"}</button> : null}</div>
      {sortedNotifications.length ? <div className="notification-list">{sortedNotifications.map((item) => <article className={`${item.severity} ${item.readAt ? "read" : "unread"}`} key={item.id}>
        <button type="button" className="notification-open" onClick={() => openNotification(item)}><i /><span><small>{item.kind.replaceAll("_", " ")} · {formatDate(item.scheduledFor)}</small><strong>{item.title}</strong><em>{item.message}</em></span><b>→</b></button>
        <button type="button" className="notification-dismiss" aria-label={`Dismiss ${item.title}`} disabled={busy === `dismiss-${item.id}`} onClick={() => void changeNotification(item.id, "dismiss")}>×</button>
      </article>)}</div> : <div className="notification-empty"><strong>You are caught up.</strong><span>New coaching activity will appear here automatically.</span></div>}
    </div> : null}

    {tab === "reminders" ? <div className="notification-panel" id="client-reminders">
      {data.reminders.length ? <div className="reminder-list">{data.reminders.map((reminder) => {
        const language = languages[reminder.id] ?? reminder.preferredLanguage;
        const communication = reminder.latestCommunication;
        return <article className={communication?.status === "sent" ? "sent" : ""} key={reminder.id}>
          <header><div><small>{reminder.relatedType === "session_reminder" ? "SESSION REMINDER" : "LEAD FOLLOW-UP"}</small><h3>{reminder.recipientName}</h3><span>{formatDate(reminder.scheduledFor)} · {reminder.phone || reminder.email || "No contact saved"}</span></div>{communication ? <b>{communication.status.toUpperCase()} · {formatDate(communication.createdAt)}</b> : <b>NOT CONTACTED</b>}</header>
          <div className="reminder-language">{(["fr", "en", "ar"] as ReminderLanguage[]).map((item) => <button type="button" className={language === item ? "active" : ""} onClick={() => setLanguages((current) => ({ ...current, [reminder.id]: item }))} key={item}>{languageLabels[item]}</button>)}</div>
          <p dir={language === "ar" ? "rtl" : "ltr"}>{reminder.messages[language]}</p>
          <div className="reminder-actions"><button type="button" onClick={() => void copyReminder(reminder)}>Copy</button>{reminder.email ? <button type="button" onClick={() => openEmail(reminder)}>Email</button> : null}<button type="button" className="whatsapp" onClick={() => openWhatsApp(reminder)}>WhatsApp ↗</button><button type="button" className="mark-sent" disabled={busy === `sent-whatsapp-${reminder.id}` || communication?.status === "sent"} onClick={() => void recordCommunication(reminder, "sent", "whatsapp")}>{communication?.status === "sent" ? "Sent ✓" : "Mark sent"}</button></div>
        </article>;
      })}</div> : <div className="notification-empty"><strong>No reminders waiting.</strong><span>Session and lead reminders appear here at the right time.</span></div>}
    </div> : null}

    {tab === "history" ? <div className="notification-panel">
      {data.communications.length ? <div className="communication-list">{data.communications.map((item) => <article key={item.id}><span className={`communication-channel ${item.channel}`}>{item.channel.slice(0, 2).toUpperCase()}</span><div><small>{item.channel.toUpperCase()} · {item.language.toUpperCase()} · {item.status.toUpperCase()}</small><strong>{item.recipientName}</strong><em>{item.subject}</em></div><time>{formatDate(item.createdAt)}</time></article>)}</div> : <div className="notification-empty"><strong>No communication recorded yet.</strong><span>Prepared, opened and sent reminders will build the client contact trail.</span></div>}
    </div> : null}
  </section>;
}
