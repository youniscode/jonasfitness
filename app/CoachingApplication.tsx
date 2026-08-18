"use client";

import { FormEvent, useState } from "react";
import { attributionStorageKey, type Attribution } from "./lib/attribution";
import { applyGoalSelection } from "./lib/onboarding-profile";

type Lang = "fr" | "en" | "ar";

// Canonical objective values stored on the lead (the onboarding vocabulary);
// labels are localized for the prospect. The first selection is the PRIMARY
// goal; extra selections are SECONDARY objectives.
type GoalValue = "Build muscle" | "Lose body fat" | "Get stronger" | "Improve fitness" | "Return to training" | "Improve general health" | "Other";
type ExperienceValue = "Beginner" | "1–2 years" | "3–5 years" | "6+ years";
type FormatValue = "Online" | "In person" | "Hybrid" | "To discuss";
type ContactValue = "WhatsApp" | "Email" | "Phone";

const text = {
  fr: { soon:"CANDIDATURE COACHING", ready:["Prêt à vous entraîner","avec une vraie direction ?"], readyText:"Présentez votre objectif et votre situation. Jonas étudiera personnellement votre demande.", open:"Déposer ma candidature", legal:"Deux minutes · Sans engagement · Réponse personnelle", title:"Parlons de votre objectif.", intro:"Quelques questions rapides, puis vos coordonnées. C'est tout.", contact:"VOS COORDONNÉES", name:"Nom complet", email:"E-mail", phone:"WhatsApp / téléphone", country:"Pays ou fuseau horaire", stepOf:"Étape {n} sur {total}", back:"Retour", continue:"Continuer", send:"Envoyer ma candidature", sending:"Envoi…", success:"Candidature reçue.", successText:"Merci. Jonas examinera personnellement votre demande et vous contactera selon votre préférence.", close:"Fermer",        error:"La candidature n'a pas pu être envoyée. Réessayez.", q1:"Quels sont vos objectifs ?", q1Hint:"Choisissez votre priorité principale, puis ajoutez d'autres objectifs si vous le souhaitez.", primaryBadge:"Principal", secondaryBadge:"Secondaire", q2:"Quel est votre niveau actuel ?", q3:"Combien de fois souhaitez-vous vous entraîner ?", q4:"Comment souhaitez-vous être accompagné ?", q5:"Vos coordonnées", q5Hint:"Jonas vous contactera selon votre préférence.", preference:"Contact préféré", message:"Vous voulez ajouter quelque chose ?", messageHint:"Facultatif · votre contexte, vos difficultés, ce que vous attendez d'un coach…", consent:"J'accepte que Jonas Fitness utilise ces informations uniquement pour répondre à ma demande de coaching." },
  en: { soon:"COACHING APPLICATION", ready:["Ready to train","with real direction?"], readyText:"Tell me about your goal and situation. Jonas will personally review your application.", open:"Apply for coaching", legal:"Two minutes · No commitment · Personal response", title:"Let's talk about your goal.", intro:"A few quick questions, then your details. That's it.", contact:"YOUR DETAILS", name:"Full name", email:"Email", phone:"WhatsApp / phone", country:"Country or time zone", stepOf:"Step {n} of {total}", back:"Back", continue:"Continue", send:"Send my application", sending:"Sending…", success:"Application received.", successText:"Thank you. Jonas will personally review your application and contact you using your preferred method.", close:"Close",        error:"Your application could not be sent. Please try again.", q1:"What are your goals?", q1Hint:"Choose your main priority, then add any other goals that matter to you.", primaryBadge:"Primary", secondaryBadge:"Secondary", q2:"What's your current level?", q3:"How often do you want to train?", q4:"How do you want to be coached?", q5:"Your details", q5Hint:"Jonas will contact you using your preference.", preference:"Preferred contact", message:"Anything you'd like to add?", messageHint:"Optional · your context, challenges, what you expect from a coach…", consent:"I agree that Jonas Fitness may use this information only to respond to my coaching application." },
  ar: { soon:"طلب التدريب", ready:["هل أنت مستعد للتدريب","باتجاه حقيقي؟"], readyText:"أخبرني عن هدفك ووضعك. سيراجع Jonas طلبك شخصيًا.", open:"قدّم طلب التدريب", legal:"دقيقتان · بدون التزام · رد شخصي", title:"لنتحدث عن هدفك.", intro:"بعض الأسئلة السريعة، ثم بياناتك. هذا كل شيء.", contact:"بيانات التواصل", name:"الاسم الكامل", email:"البريد الإلكتروني", phone:"واتساب / الهاتف", country:"البلد أو المنطقة الزمنية", stepOf:"الخطوة {n} من {total}", back:"رجوع", continue:"متابعة", send:"إرسال طلبي", sending:"جارٍ الإرسال…", success:"تم استلام طلبك.", successText:"شكرًا لك. سيراجع Jonas طلبك شخصيًا ويتواصل معك بالطريقة التي اخترتها.", close:"إغلاق",        error:"تعذّر إرسال الطلب. حاول مرة أخرى.", q1:"ما هي أهدافك؟", q1Hint:"اختر أولويتك الرئيسية، ثم أضف أي أهداف أخرى تهمك إن أردت.", primaryBadge:"رئيسي", secondaryBadge:"ثانوي", q2:"ما مستواك الحالي؟", q3:"كم مرة تريد التدريب أسبوعيًا؟", q4:"كيف تريد أن يُدربك المدرب؟", q5:"بيانات التواصل", q5Hint:"سيتواصل Jonas معك حسب تفضيلك.", preference:"وسيلة التواصل المفضلة", message:"هل تريد إضافة شيء؟", messageHint:"اختياري · سياقك وتحدياتك وما تتوقعه من المدرب…", consent:"أوافق على استخدام Jonas Fitness لهذه المعلومات فقط للرد على طلب التدريب." },
} as const;

const choices: Record<Lang, { goals: [GoalValue, string][]; experience: [ExperienceValue, string][]; days: number[]; formats: [FormatValue, string][]; contacts: [ContactValue, string][] }> = {
  fr: {
    goals: [["Build muscle","Prendre du muscle"],["Lose body fat","Perdre du gras"],["Get stronger","Devenir plus fort"],["Improve fitness","Améliorer ma condition physique"],["Return to training","Reprendre le sport"],["Improve general health","Améliorer ma santé générale"],["Other","Autre"]],
    experience: [["Beginner","Je débute"],["1–2 years","Intermédiaire"],["3–5 years","Confirmé"],["6+ years","Avancé"]],
    days: [2, 3, 4, 5, 6],
    formats: [["Online","En ligne"],["In person","En présentiel"],["Hybrid","Hybride"],["To discuss","Je veux en discuter"]],
    contacts: [["WhatsApp","WhatsApp"],["Email","E-mail"],["Phone","Téléphone"]],
  },
  en: {
    goals: [["Build muscle","Build muscle"],["Lose body fat","Lose body fat"],["Get stronger","Get stronger"],["Improve fitness","Improve my fitness"],["Return to training","Return to training"],["Improve general health","Improve my general health"],["Other","Something else"]],
    experience: [["Beginner","Beginner"],["1–2 years","Intermediate"],["3–5 years","Advanced"],["6+ years","Very experienced"]],
    days: [2, 3, 4, 5, 6],
    formats: [["Online","Online"],["In person","In person"],["Hybrid","Hybrid"],["To discuss","I want to discuss it"]],
    contacts: [["WhatsApp","WhatsApp"],["Email","Email"],["Phone","Phone"]],
  },
  ar: {
    goals: [["Build muscle","بناء العضلات"],["Lose body fat","خسارة الدهون"],["Get stronger","زيادة القوة"],["Improve fitness","تحسين لياقتي"],["Return to training","العودة إلى التدريب"],["Improve general health","تحسين صحتي العامة"],["Other","شيء آخر"]],
    experience: [["Beginner","مبتدئ"],["1–2 years","متوسط"],["3–5 years","متقدم"],["6+ years","ذو خبرة كبيرة"]],
    days: [2, 3, 4, 5, 6],
    formats: [["Online","عن بُعد"],["In person","حضوري"],["Hybrid","هجين"],["To discuss","أريد مناقشة ذلك"]],
    contacts: [["WhatsApp","واتساب"],["Email","البريد الإلكتروني"],["Phone","الهاتف"]],
  },
};

const TOTAL_STEPS = 5;

function storedAttribution(): Attribution | null {
  try { const value = localStorage.getItem(attributionStorageKey); return value ? JSON.parse(value) as Attribution : null; } catch { return null; }
}

export default function CoachingApplication({ lang }: { lang: Lang }) {
  const t = text[lang]; const options = choices[lang];
  const [open, setOpen] = useState(false); const [sending, setSending] = useState(false); const [success, setSuccess] = useState(false); const [error, setError] = useState(""); const [startedAt, setStartedAt] = useState(() => Date.now());
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<{ primary: string; secondary: string[] }>({ primary: "", secondary: [] });
  const [experience, setExperience] = useState<ExperienceValue | "">("");
  const [trainingDays, setTrainingDays] = useState(3);
  const [format, setFormat] = useState<FormatValue | "">("");
  const [contact, setContact] = useState<ContactValue>("WhatsApp");
  function show() { setStartedAt(Date.now()); setSuccess(false); setError(""); setStep(0); setGoals({ primary: "", secondary: [] }); setExperience(""); setTrainingDays(3); setFormat(""); setContact("WhatsApp"); setOpen(true); }
  function applyGoal(value: string) { setGoals((current) => applyGoalSelection(current, value)); }
  function next() { if (step === 0 && !goals.primary) return; if (step === 1 && !experience) return; if (step === 2 && !trainingDays) return; if (step === 3 && !format) return; setError(""); setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError(""); const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"), email: form.get("email"), phone: form.get("phone"), country: form.get("country"),
      goal: goals.primary || "Improve fitness", secondaryGoals: goals.secondary, experience: experience || "", trainingDays, coachingFormat: format || "Online",
      contactPreference: contact, message: form.get("message"), preferredLanguage: lang, consent: form.get("consent") === "on",
      startedAt, attribution: storedAttribution(),
    };
    try { const response = await fetch("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? t.error); setSuccess(true); }
    catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
    finally { setSending(false); }
  }
  const selected = (value: string, current: string) => (value === current ? " selected" : "");
  return <><section className="early-section" id="early-access"><p className="eyebrow"><span/>{t.soon}</p><h2>{t.ready[0]}<br/><em>{t.ready[1]}</em></h2><p>{t.readyText}</p><button className="button button-light" type="button" onClick={show}>{t.open}<span>→</span></button><small>{t.legal}</small></section>
    {open ? <div className="application-backdrop" role="presentation" onMouseDown={() => setOpen(false)}><section className="application-modal" role="dialog" aria-modal="true" aria-labelledby="application-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p>JONAS FITNESS · {t.soon}</p><h2 id="application-title">{success ? t.success : t.title}</h2><span>{success ? t.successText : t.intro}</span></div><button type="button" aria-label={t.close} onClick={() => setOpen(false)}>×</button></header>{success ? <div className="application-success"><i>✓</i><button type="button" className="button" onClick={() => setOpen(false)}>{t.close}<span>→</span></button></div> : <form onSubmit={submit} className="application-wizard"><input className="application-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/>
      <div className="application-progress"><span style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} /></div>
      {step === 0 ? <fieldset className="application-step"><legend>{t.q1}<small>{t.q1Hint}</small></legend><div className="application-card-grid">{options.goals.map(([value, label]) => { const isPrimary = goals.primary === value; const isSecondary = goals.secondary.includes(value); const badge = isPrimary ? t.primaryBadge : isSecondary ? t.secondaryBadge : null; return <button type="button" key={value} className={`application-card${isPrimary ? " primary" : isSecondary ? " secondary" : ""}`} onClick={() => applyGoal(value)}>{label}{badge ? <em>{badge}</em> : null}</button>; })}</div></fieldset> : null}
      {step === 1 ? <fieldset className="application-step"><legend>{t.q2}</legend><div className="application-card-grid">{options.experience.map(([value, label], index) => <button type="button" key={`${value}-${index}`} className={`application-card${selected(value, experience)}`} onClick={() => setExperience(value)}>{label}</button>)}</div></fieldset> : null}
      {step === 2 ? <fieldset className="application-step"><legend>{t.q3}</legend><div className="application-card-grid days">{options.days.map((day) => <button type="button" key={day} className={`application-card${trainingDays === day ? " selected" : ""}`} onClick={() => setTrainingDays(day)}>{day}×</button>)}</div></fieldset> : null}
      {step === 3 ? <fieldset className="application-step"><legend>{t.q4}</legend><div className="application-card-grid">{options.formats.map(([value, label]) => <button type="button" key={value} className={`application-card${selected(value, format)}`} onClick={() => setFormat(value)}>{label}</button>)}</div></fieldset> : null}
      {step === 4 ? <fieldset className="application-step"><legend>{t.q5}<small>{t.q5Hint}</small></legend><div className="application-grid"><label>{t.name}<input name="name" required autoComplete="name"/></label><label>{t.email}<input name="email" required type="email" autoComplete="email"/></label><label>{t.phone}<input name="phone" type="tel" autoComplete="tel"/></label><label>{t.country}<input name="country" required autoComplete="country-name" placeholder={lang === "fr" ? "France · Europe/Paris" : lang === "ar" ? "الإمارات · Asia/Dubai" : "France · Europe/Paris"}/></label><label>{t.preference}<select name="contactPreference" value={contact} onChange={(event) => setContact(event.target.value as ContactValue)}>{options.contacts.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label>{t.message}<textarea name="message" placeholder={t.messageHint}/></label></fieldset> : null}
      <div className="application-nav"><button type="button" className="application-nav-back" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>{t.back}</button>{step < 4
        ? <button type="button" className="application-submit" onClick={next}>{t.continue}<span>→</span></button>
        : <button className="application-submit" disabled={sending}>{sending ? t.sending : t.send}<span>→</span></button>}</div>
      {step === 4 && <><label className="application-consent"><input type="checkbox" name="consent" required/><span>{t.consent}</span></label>{error ? <p className="application-error" role="alert">{error}</p> : null}</>}
      <p className="application-step-count">{t.stepOf.replace("{n}", String(step + 1)).replace("{total}", String(TOTAL_STEPS))}</p>
    </form>}</section></div> : null}
  </>;
}
