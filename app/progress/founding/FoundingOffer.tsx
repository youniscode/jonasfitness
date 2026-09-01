"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { LANGS, persistLang, readStoredLang, type Lang } from "../../lib/lang-store";

// Trilingual copy for the public Founding Access offer (fr/en/ar). French is
// the default language (matching the rest of Jonas Fitness). Inline dictionary;
// no i18n framework, no URL routing, per the app's existing convention.
const copy = {
  fr: {
    brand: "JONAS FITNESS",
    tag: "PROGRESS · ACCÈS FONDATEUR",
    kicker: "JONAS FITNESS PROGRESS",
    headline: "Arrête de deviner.",
    headline2: "Bats ton carnet d’entraînement.",
    "lede-top": "Sache ce que tu as fait la dernière fois, ce que tu essaies de battre aujourd’hui, et si tu progresses vraiment.",
    cta: "Obtenir l’accès fondateur",
    priceLine: "Accès fondateur · 19 € en paiement unique",
    problem: "LE PROBLÈME",
    problemTitle: "La plupart des pratiquants savent quels exercices ils font.",
    problemList: [
      ["Qu’est-ce que j’ai fait la dernière fois ?", ""],
      ["Ai-je progressé ?", ""],
      ["Ai-je ajouté des répétitions ?", ""],
      ["Ai-je augmenté la charge ?", ""],
      ["Quels mouvements avancent ?", ""],
      ["Quels mouvements stagnent ?", ""],
    ],
    core: "L’EXPÉRIENCE",
    coreTitle: "PRÉCÉDENT → OBJECTIF → RÉEL",
    coreItems: [
      ["Routines", "Crée un plan d’entraînement et ses exercices."],
      ["Logging rapide", "Note le poids, les reps et le RIR en quelques gestes."],
      ["Performance passée", "Vois ce que tu as soulevé la dernière fois à côté de tes séries du jour."],
      ["Fourchettes de reps", "Des objectifs clairs que tu peux atteindre."],
      ["Historique", "Tes séances, ton meilleur, ton estimé de 1RM."],
      ["Indicateurs transparents", "Des signaux que tu comprends, pas de « score IA »."],
    ],
    why: "POURQUOI JONAS FITNESS",
    whyText: "Construit sur plus de 16 ans d’expérience en musculation. Le but n’est pas que le logiciel s’entraîne à ta place, c’est de rendre tes propres données utiles.",
    offerTitle: "ACCÈS FONDATEUR",
    offerPrice: "19 € · en paiement unique",
    offerBody: "Un accès fondateur unique au produit Progress Jonas Fitness.",
    offerFuture: "Des produits ou services futurs, facultatifs, pourront être vendus séparément.",
    notIncluded: [
      "Coaching 1:1",
      "Coaching professionnel personnalisé",
      "Conseil médical ou diagnostic",
      "Service nutritionnel individualisé",
      "Garantie de résultats",
    ],
    notIncludedTitle: "CE QUI N’EST PAS INCLUS",
    faq: "FAQ",
    faqs: [
      ["Est-ce du coaching ?", "Non. Progress est un logiciel auto-dirigé d’entraînement. Il ne fournit pas de coaching professionnel personnalisé."],
      ["Est-ce un générateur d’entraînement IA ?", "Non. Il ne crée pas de programmes à ta place : il t’aide à suivre et interpréter ton propre entraînement."],
      ["Puis-je créer mes propres routines ?", "Oui. Tu construis tes routines, tes exercices et tes fourchettes de reps."],
      ["Que suit-il ?", "Poids, répétitions, RIR, fourchettes cibles, historique d’exercices et indicateurs de progression."],
      ["Est-ce un abonnement ?", "Non. Un paiement unique de 19 € pour l’accès fondateur."],
      ["Ca marche sur mobile ?", "Oui. Conçu pour être utilisé en salle, depuis ton téléphone."],
      ["Que comprend l’accès fondateur ?", "L’accès au produit Progress actuel. Des produits futurs éventuels sont vendus séparément."],
    ],
    use: "Utilisateur actuel",
    legalNote: "L’accès fondateur est un achat unique (19 €). C’est un logiciel auto-dirigé : ce n’est ni un coaching personnalisé, ni un dispositif médical, ni une rééducation.",
    signInFirst: "Connecte-toi pour continuer",
    starting: "Redirection vers le paiement…",
    footer: "© 2026 Jonas Fitness",
  },
  en: {
    brand: "JONAS FITNESS",
    tag: "PROGRESS · FOUNDING ACCESS",
    kicker: "JONAS FITNESS PROGRESS",
    headline: "Stop guessing.",
    headline2: "Beat the logbook.",
    "lede-top": "Know what you did last time, what you’re trying to beat today, and whether you’re actually progressing.",
    cta: "Get Founding Access",
    priceLine: "Founding Access · €19 one-time",
    problem: "THE PROBLEM",
    problemTitle: "Most lifters know what exercises they perform.",
    problemList: [
      ["What did I actually do last time?", ""],
      ["Did I improve?", ""],
      ["Am I adding reps?", ""],
      ["Am I adding load?", ""],
      ["Which lifts are moving?", ""],
      ["Which lifts are stalled?", ""],
    ],
    core: "THE EXPERIENCE",
    coreTitle: "PREVIOUS → TARGET → ACTUAL",
    coreItems: [
      ["Routines", "Build a routine and its exercises."],
      ["Fast logging", "Log weight, reps and RIR in a few taps."],
      ["Past performance", "See last session’s numbers beside today’s sets."],
      ["Rep ranges", "Clear targets you can actually hit."],
      ["History", "Your sessions, your bests, your e1RM."],
      ["Transparent signals", "Signals you understand, not an opaque “AI score”."],
    ],
    why: "WHY JONAS FITNESS",
    whyText: "Built on 16+ years of real bodybuilding experience. The point isn’t to let software train for you; it’s to make your own training data useful.",
    offerTitle: "FOUNDING ACCESS",
    offerPrice: "€19 · one-time",
    offerBody: "A one-time Founding Access to the Jonas Fitness Progress product.",
    offerFuture: "Optional future products or services may be sold separately.",
    notIncludedTitle: "WHAT THIS IS NOT",
    notIncluded: [
      "1:1 coaching",
      "Personalized professional coaching",
      "Medical advice or diagnosis",
      "Individualized nutrition service",
      "Guaranteed results",
    ],
    faq: "FAQ",
    faqs: [
      ["Is this coaching?", "No. Progress is self-directed training software. It does not provide personalized professional coaching."],
      ["Is this an AI workout generator?", "No. It doesn’t build your program for you; it helps you record and understand your own training."],
      ["Can I create my own routines?", "Yes. You build your routines, exercises and rep ranges."],
      ["What does it track?", "Weight, reps, RIR, target rep ranges, exercise history and progression signals."],
      ["Is this a subscription?", "No. A one-time €19 Founding Access."],
      ["Does it work on mobile?", "Yes. Designed to be used in the gym, on your phone."],
      ["What does Founding Access include?", "Access to the current Progress product. Optional future products are sold separately."],
    ],
    use: "current user",
    legalNote: "Founding Access is a one-time purchase (€19). It is self-directed software: not personalized coaching, not medical or rehabilitation software.",
    signInFirst: "Sign in to continue",
    starting: "Redirecting to checkout…",
    footer: "© 2026 Jonas Fitness",
  },
  ar: {
    brand: "JONAS FITNESS",
    tag: "PROGRESS · الوصول التأسيسي",
    kicker: "JONAS FITNESS PROGRESS",
    headline: "توقّف عن التخمين.",
    headline2: "تفوّق على سجلّك التدريبي.",
    "lede-top": "اعرف ما فعلته آخر مرة، وما تحاول تجاوزه اليوم، وما إذا كنت تتقدم فعلًا.",
    cta: "احصل على الوصول التأسيسي",
    priceLine: "الوصول التأسيسي · 19 € دفعة واحدة",
    problem: "المشكلة",
    problemTitle: "معظم المتدربين يعرفون التمارين التي يؤدونها.",
    problemList: [
      ["ما الذي فعلته آخر مرة؟", ""],
      ["هل تقدمت؟", ""],
      ["هل أضفت تكرارات؟", ""],
      ["هل أضفت وزنًا؟", ""],
      ["أي الحركات تتقدم؟", ""],
      ["أي الحركات راكدة؟", ""],
    ],
    core: "التجربة",
    coreTitle: "السابق ← الهدف ← الفعلي",
    coreItems: [
      ["الروتينات", "أنشئ خطة تدريب وتمارينها."],
      ["تسجيل سريع", "سجّل الوزن والتكرارات وRIR بلمسات قليلة."],
      ["الأداء السابق", "شاهد أرقام آخر حصة بجانب مجموعات اليوم."],
      ["نطاقات التكرار", "أهداف واضحة يمكنك تحقيقها فعلًا."],
      ["السجل", "حصصك وأفضل أرقامك وتقدير 1RM."],
      ["مؤشرات شفافة", "إشارات تفهمها، لا «درجات ذكاء اصطناعي» مبهمة."],
    ],
    why: "لماذا JONAS FITNESS",
    whyText: "مبني على أكثر من 16 عامًا من خبرة كمال الأجسام الحقيقية. الهدف ليس أن يتدرب البرنامج بدلًا منك، بل أن يجعل بياناتك التدريبية مفيدة.",
    offerTitle: "الوصول التأسيسي",
    offerPrice: "19 € · دفعة واحدة",
    offerBody: "وصول تأسيسي لمرة واحدة إلى منتج Progress من Jonas Fitness.",
    offerFuture: "قد تُباع منتجات أو خدمات مستقبلية اختيارية بشكل منفصل.",
    notIncluded: [
      "تدريب فردي 1:1",
      "تدريب شخصي احترافي مخصص",
      "نصيحة طبية أو تشخيص",
      "خدمة تغذية فردية",
      "ضمان نتائج",
    ],
    notIncludedTitle: "ما ليس هذا المنتج",
    faq: "الأسئلة الشائعة",
    faqs: [
      ["هل هذا تدريب؟", "لا. Progress برنامج تدريبي ذاتي التوجيه. لا يقدم تدريبًا شخصيًا احترافيًا مخصصًا."],
      ["هل هو مولّد تمارين بالذكاء الاصطناعي؟", "لا. لا يبني برنامجك بدلًا منك: بل يساعدك على تسجيل تدريبك وفهمه."],
      ["هل يمكنني إنشاء روتيناتي الخاصة؟", "نعم. أنت تبني روتيناتك وتمارينك ونطاقات التكرار."],
      ["ماذا يتتبع؟", "الوزن والتكرارات وRIR والنطاقات المستهدفة وسجل التمارين ومؤشرات التقدم."],
      ["هل هو اشتراك؟", "لا. دفعة واحدة بقيمة 19 € للوصول التأسيسي."],
      ["هل يعمل على الجوال؟", "نعم. صُمم ليُستخدم في صالة الألعاب من هاتفك."],
      ["ماذا يشمل الوصول التأسيسي؟", "الوصول إلى منتج Progress الحالي. أي منتجات مستقبلية اختيارية تُباع بشكل منفصل."],
    ],
    use: "المستخدم الحالي",
    legalNote: "الوصول التأسيسي هو شراء لمرة واحدة (19 €). إنه برنامج ذاتي التوجيه: ليس تدريبًا شخصيًا ولا جهازًا طبيًا ولا إعادة تأهيل.",
    signInFirst: "سجّل الدخول للمتابعة",
    starting: "جارٍ تحويلك إلى الدفع…",
    footer: "© 2026 Jonas Fitness",
  },
} as const;

export default function FoundingOffer() {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const t = copy[lang];
  const { isSignedIn } = useAuth();
  const { redirectToSignIn } = useClerk();
  const [state, setState] = useState<"idle" | "signing" | "checkout">("idle");
  const rtl = lang === "ar";

  // First-party funnel: fire the server-authenticated `founding_offer_viewed`
  // once per mount (the server dedupes per day and only records signed-in views;
  // anonymous visitors are deliberately not fingerprinted or cookie-tracked).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void fetch("/api/progress/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName: "founding_offer_viewed" }),
    }).catch(() => {});
  }, []);

  function switchLang(next: Lang) {
    setLang(next);
    persistLang(next);
  }

  async function handleBuy() {
    // Anonymous visitors go through Clerk first (the project's sign-in flow),
    // preserving the return path so they land back here authenticated and can
    // then proceed to checkout. When paywall is disabled in dev, a signed-in
    // anonymous user already sees Progress, so the offer buy is still shown.
    if (!isSignedIn) {
      setState("signing");
      await redirectToSignIn({ redirectUrl: "/progress/founding" });
      return; // redirect() maps to the Clerk sign-in; we don't continue here
    }
    setState("checkout");
    try {
      const response = await fetch("/api/progress/checkout", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { url?: string; error?: string; status?: string };
      if (!response.ok || !data.url) {
        if (data.status === "entitled") { window.location.href = "/progress"; return; }
        alert(data.error ?? "Could not start checkout.");
        setState("idle");
        return;
      }
      window.location.href = data.url;
    } catch {
      alert("Could not start checkout.");
      setState("idle");
    }
  }

  return <section dir={rtl ? "rtl" : "ltr"} className={`founding ${rtl ? "rtl-site" : ""}`}>
    <header className="founding-nav">
      <Link className="founding-brand" href="/"><span className="brand-mark">JF</span><span>{t.brand}</span></Link>
      <div className="founding-lang" aria-label="Language">{(LANGS as Lang[]).map((l) => <button key={l} type="button" className={lang === l ? "active" : ""} onClick={() => switchLang(l)}>{l.toUpperCase()}</button>)}</div>
    </header>

    <section className="found-hero">
      <p className="found-kicker"><span />{t.kicker}</p>
      <h1><em>{t.headline}</em><br />{t.headline2}</h1>
      <p className="found-lede">{t["lede-top"]}</p>
      <div className="found-actions">
        <button className="found-cta" type="button" onClick={handleBuy} disabled={state !== "idle"}>{state === "checkout" ? t.starting : state === "signing" ? t.signInFirst : t.cta}<span>→</span></button>
        <span className="found-price">{t.priceLine}</span>
      </div>
    </section>

    <section className="found-problem">
      <p className="found-eyebrow">{t.problem}</p>
      <h2>{t.problemTitle}</h2>
      <p>Fewer still can answer:</p>
      <div className="found-problem-list">{t.problemList.map(([q]) => <span key={q}>· {q}</span>)}</div>
    </section>

    <section className="found-core">
      <div className="found-core-inner">
        <p className="found-eyebrow deep">{t.core}</p>
        <h2>{t.coreTitle}</h2>
        <div className="core-grid">{t.coreItems.map(([a, b]) => <article key={a}><strong>{a}</strong><span>{b}</span></article>)}</div>
      </div>
    </section>

    <section className="found-why">
      <p className="found-eyebrow">{t.why}</p>
      <p className="found-why-text">{t.whyText}</p>
    </section>

    <section className="found-offer" id="offer">
      <p className="found-kicker light"><span />{t.offerTitle}</p>
      <strong className="found-price-big">{t.offerPrice}</strong>
      <p className="found-offer-body">{t.offerBody}</p>
      <p className="found-offer-future">{t.offerFuture}</p>
      <h3>{t.notIncludedTitle}</h3>
      <ul className="found-not-included">{t.notIncluded.map((i) => <li key={i}>{i}</li>)}</ul>
      <button className="found-cta" type="button" onClick={handleBuy} disabled={state !== "idle"}>{t.cta}<span>→</span></button>
    </section>

    <section className="found-faq">
      <p className="found-eyebrow deep">{t.faq}</p>
      <div className="faq-list">{t.faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
    </section>

    <footer className="found-footer">
      <p>{t.legalNote}</p>
      <nav className="found-legal-links">
        <Link href="/legal">Legal</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/refunds">Refunds</Link>
      </nav>
      <span>{t.footer}</span>
    </footer>
  </section>;
}