"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const copy = {
  fr: {
    kicker: "BLESSÉ · BIENVENUE",
    thanks: "L’accès fondateur est actif.",
    body: "Ton accès fondateur à Jonas Fitness Progress est actif. Tu peux créer ta première routine et ouvrir ton carnet d’entraînement.",
    cta: "Créer ma première routine",
    activate: "Activation de ton accès…",
    activateBody: "Le paiement est confirmé. Nous appliquons l’activation — cela ne prend que quelques secondes.",
    retry: "Réessayer",
    notYet: "Pas encore activé.",
    notYetBody: "Ton accès n’a pas encore été activé. Vérifie ta confirmation de paiement ; si cela persiste, contacte nous.",
    contact: "Contact",
    logoutCheck: "Revenir à l’offre",
    hint: "L’accès est accordé automatiquement dès que le paiement est confirmé.",
  },
  en: {
    kicker: "WELCOME · ACTIVATED",
    thanks: "Your Founding Access is active.",
    body: "Your Founding Access to Jonas Fitness Progress is active. Create your first routine and open your training log.",
    cta: "Create your first routine",
    activate: "Activating your access…",
    activateBody: "Your payment is confirmed. We’re applying your activation — just a few seconds.",
    retry: "Check again",
    notYet: "Not activated yet.",
    notYetBody: "Your access hasn’t been activated yet. Check your payment confirmation; if it persists, reach out to us.",
    contact: "Contact us",
    logoutCheck: "Back to the offer",
    hint: "Access is granted automatically the moment payment is confirmed.",
  },
} as const;

export default function PurchaseSuccess({ initiallyEntitled }: { initiallyEntitled: boolean }) {
  const { isLoaded } = useAuth();
  const [phase, setPhase] = useState<"active" | "activating" | "stalled">(
    initiallyEntitled ? "active" : "activating",
  );
  const t = copy.en; // success page copy default English for now

  // Server-authoritative recheck: fetch the entitlement endpoint. Because the
  // webhook can still be delivering, we poll a bounded number of times (do NOT
  // poll indefinitely) then show a recoverable "not activated yet" state.
  useEffect(() => {
    if (initiallyEntitled) return;
    let cancelled = false;
    let attempts = 0;
    const MAX = 10; // ~10 × 2.5s ≈ 25s cap
    const check = async () => {
      if (cancelled || phase === "active" || attempts >= MAX) {
        if (attempts >= MAX) { setPhase((p) => (p === "activating" ? "stalled" : p)); }
        return;
      }
      attempts += 1;
      try {
        const response = await fetch("/api/progress/entitlement", { method: "GET" });
        const data = await response.json().catch(() => ({ entitled: false })) as { entitled?: boolean };
        if (cancelled) return;
        if (data.entitled) { setPhase("active"); return; }
      } catch {
        /* transient — keep trying */
      }
      window.setTimeout(check, 2500);
    };
    void check();
    return () => { cancelled = true; };
  }, [initiallyEntitled, phase]);

  return (
    <section className="founding purchase">
      <header className="purchase-top">
        <Link className="founding-brand" href="/"><span className="brand-mark">JF</span><span>JONAS FITNESS</span></Link>
      </header>

      <div className="purchase-card">
        {phase === "active" ? (
          <>
            <span className="purchase-check">✓</span>
            <p className="purchase-kicker">{t.kicker}</p>
            <h1>{t.thanks}</h1>
            <p className="purchase-body">{t.body}</p>
            <Link className="found-cta" href="/progress/routines">{t.cta}<span>→</span></Link>
            <span className="purchase-hint">{t.hint}</span>
          </>
        ) : phase === "stalled" ? (
          <>
            <h1>{t.notYet}</h1>
            <p className="purchase-body">{t.notYetBody}</p>
            <button className="found-cta" type="button" disabled={!isLoaded} onClick={() => setPhase("activating")}>{t.retry}<span>↻</span></button>
            <Link className="purchase-back" href="/progress/founding">{t.logoutCheck}</Link>
          </>
        ) : (
          <>
            <span className="purchase-spinner" />
            <h1>{t.activate}</h1>
            <p className="purchase-body">{t.activateBody}</p>
          </>
        )}
      </div>
    </section>
  );
}