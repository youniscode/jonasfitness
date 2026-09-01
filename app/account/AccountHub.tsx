"use client";

import Link from "next/link";
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { LANGS, persistLang, readStoredLang, type Lang } from "../lib/lang-store";

const copy = {
  fr: {
    kicker: "MON ESPACE",
    title: "Mon espace",
    intro: "Choisis où tu veux continuer.",
    progressTitle: "Jonas Progress",
    progressDesc: "Planifie tes routines, enregistre tes séances et suis ta progression.",
    openProgress: "Ouvrir Progress",
    getProgress: "Obtenir Jonas Progress",
    price: "19 € une seule fois",
    coachingTitle: "Coaching avec Jonas",
    coachingDesc: "Un accompagnement personnalisé avec Jonas pour ton entraînement, ta progression et tes objectifs.",
    openCoaching: "Ouvrir mon coaching",
    applyCoaching: "Postuler au coaching",
    signOut: "Se déconnecter",
    home: "Accueil",
    legalLinks: ["Légal", "Confidentialité", "Conditions", "Remboursements"],
    footer: "© 2026 Jonas Progress",
  },
  en: {
    kicker: "MY SPACE",
    title: "My space",
    intro: "Choose where you want to continue.",
    progressTitle: "Jonas Progress",
    progressDesc: "Plan your routines, log your workouts and track your progression.",
    openProgress: "Open Progress",
    getProgress: "Get Jonas Progress",
    price: "€19 one-time",
    coachingTitle: "Coaching with Jonas",
    coachingDesc: "Personalized coaching with Jonas for your training, progression and goals.",
    openCoaching: "Open coaching",
    applyCoaching: "Apply for coaching",
    signOut: "Sign out",
    home: "Home",
    legalLinks: ["Legal", "Privacy", "Terms", "Refunds"],
    footer: "© 2026 Jonas Progress",
  },
  ar: {
    kicker: "مساحتي",
    title: "مساحتي",
    intro: "اختر من أين تريد المتابعة.",
    progressTitle: "Jonas Progress",
    progressDesc: "خطط لروتيناتك، سجّل جلساتك وتابع تقدّمك.",
    openProgress: "افتح Progress",
    getProgress: "احصل على Jonas Progress",
    price: "19 € دفعة واحدة",
    coachingTitle: "التدريب مع Jonas",
    coachingDesc: "مرافقة شخصية مع Jonas لتدريبك وتقدّمك وأهدافك.",
    openCoaching: "افتح التدريب",
    applyCoaching: "قدّم طلبك للتدريب",
    signOut: "تسجيل الخروج",
    home: "الرئيسية",
    legalLinks: ["قانوني", "الخصوصية", "الشروط", "الاسترداد"],
    footer: "© 2026 Jonas Progress",
  },
} as const;

/** Light "My space" service hub: what do I have access to, where can I go next. */
export default function AccountHub({ progressEntitled, coachingProfile }: { progressEntitled: boolean; coachingProfile: boolean }) {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const { signOut } = useClerk();
  const t = copy[lang];
  const rtl = lang === "ar";

  function switchLang(next: Lang) {
    setLang(next);
    persistLang(next);
  }

  function handleSignOut() {
    // Standard Clerk sign-out; returns the visitor to the public homepage.
    void signOut({ redirectUrl: "/" });
  }

  return (
    <section dir={rtl ? "rtl" : "ltr"} className={`account ${rtl ? "rtl-site" : ""}`}>
      <header className="account-nav">
        <Link className="account-brand" href="/" aria-label={t.home}><span className="brand-mark">JP</span><span>JONAS PROGRESS</span></Link>
        <div className="account-actions">
          <button className="account-signout" type="button" onClick={handleSignOut}>{t.signOut}</button>
          <div className="account-lang" aria-label="Language">{(LANGS as Lang[]).map((l) => <button key={l} type="button" className={lang === l ? "active" : ""} onClick={() => switchLang(l)}>{l.toUpperCase()}</button>)}</div>
        </div>
      </header>

      <main className="account-main">
        <section className="account-hero">
          <p className="account-kicker"><span />{t.kicker}</p>
          <h1>{t.title}</h1>
          <p className="account-intro">{t.intro}</p>
        </section>

      <section className="account-grid">
        <article className="account-card">
          <p className="account-card-label">PROGRESS</p>
          <h2>{t.progressTitle}</h2>
          <p className="account-card-desc">{t.progressDesc}</p>
          {progressEntitled
            ? <Link className="account-cta" href="/progress">{t.openProgress}<span>→</span></Link>
            : <>
                <span className="account-price">{t.price}</span>
                <Link className="account-cta" href="/progress/founding">{t.getProgress}<span>→</span></Link>
              </>}
        </article>

        <article className="account-card">
          <p className="account-card-label">COACHING</p>
          <h2>{t.coachingTitle}</h2>
          <p className="account-card-desc">{t.coachingDesc}</p>
          {coachingProfile
            ? <Link className="account-cta" href="/client">{t.openCoaching}<span>→</span></Link>
            : <Link className="account-cta account-cta-outline" href="/#early-access">{t.applyCoaching}<span>→</span></Link>}
        </article>
      </section>
      </main>

      <footer className="account-footer">
        <nav className="account-legal-links">
          <Link href="/legal">{t.legalLinks[0]}</Link>
          <Link href="/legal/privacy">{t.legalLinks[1]}</Link>
          <Link href="/legal/terms">{t.legalLinks[2]}</Link>
          <Link href="/legal/refunds">{t.legalLinks[3]}</Link>
        </nav>
        <span>{t.footer}</span>
      </footer>
    </section>
  );
}