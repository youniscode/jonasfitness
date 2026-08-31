"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ACTIVATION_POLL_INTERVAL_MS,
  ACTIVATION_TIMEOUT_MS,
  nextActivationPhase,
} from "../../lib/purchase-activation.ts";

const copy = {
  fr: {
    kicker: "BLESSÉ · BIENVENUE",
    thanks: "L’accès fondateur est actif.",
    body: "Ton accès fondateur à Jonas Fitness Progress est actif. Tu peux créer ta première routine et ouvrir ton carnet d’entraînement.",
    cta: "Créer ma première routine",
    activate: "Activation de ton accès…",
    activateBody: "Le paiement est confirmé. Nous appliquons l’activation — cela ne prend que quelques secondes.",
    retry: "Réessayer",
    notYet: "Nous confirmons encore ton paiement…",
    notYetBody: "Ton accès n’est pas encore activé. Recharge la page ou réessaie dans un instant ; si cela persiste, contacte-nous.",
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
    activateBody: "Your payment is confirmed. We’re confirming your access — just a few seconds.",
    retry: "Check again",
    notYet: "We’re still confirming your payment…",
    notYetBody: "Your access hasn’t activated yet. Refresh or check again in a moment; if it persists, reach out to us.",
    contact: "Contact us",
    logoutCheck: "Back to the offer",
    hint: "Access is granted automatically the moment payment is confirmed.",
  },
} as const;

export default function PurchaseSuccess({ initiallyEntitled }: { initiallyEntitled: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [phase, setPhase] = useState<"active" | "activating" | "stalled">(
    initiallyEntitled ? "active" : "activating",
  );
  // Drives manual "Check again" retries from the stalled state.
  const [pollKey, setPollKey] = useState(0);
  const t = copy.en; // success page copy default English for now

  // Server-authoritative recheck: fetch the entitlement endpoint. Because the
  // webhook can still be delivering, we poll for a bounded window (see the pure
  // module) then show a recoverable "still confirming" state. Once the Clerk
  // client loads, if the user is genuinely signed out we send them to sign-in
  // (preserving their return) — but we never grant access client-side and never
  // bounce a signed-in-but-not-yet-entitled user to the founding offer.
  useEffect(() => {
    if (initiallyEntitled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const step = async () => {
      if (cancelled) return;
      // If Clerk finished loading and reports signed-out, authenticate first.
      if (isLoaded && !isSignedIn) {
        window.location.assign(`/sign-in?redirect_url=/progress/purchase`);
        return;
      }
      attempts += 1;
      let entitled = false;
      try {
        const response = await fetch("/api/progress/entitlement", { method: "GET" });
        const data = (await response.json().catch(() => ({}))) as { entitled?: boolean; signedIn?: boolean };
        if (cancelled) return;
        if (response.ok && data.signedIn === false) {
          window.location.assign(`/sign-in?redirect_url=/progress/purchase`);
          return;
        }
        entitled = Boolean(data.entitled);
      } catch {
        /* transient — keep trying within the bounded window */
      }
      if (cancelled) return;
      const next = nextActivationPhase({
        entitled,
        signedIn: true, // we follow the server's signedIn signal above; false already routed to sign-in
        attempts,
        timeoutMs: ACTIVATION_TIMEOUT_MS,
        intervalMs: ACTIVATION_POLL_INTERVAL_MS,
      });
      if (next === "active") { setPhase("active"); return; }
      if (next === "stalled") { setPhase("stalled"); return; }
      timer = setTimeout(step, ACTIVATION_POLL_INTERVAL_MS);
    };

    void step();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [initiallyEntitled, pollKey, isLoaded, isSignedIn]);

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
            <div className="purchase-actions">
              <button className="found-cta" type="button" disabled={!isLoaded} onClick={() => { setPhase("activating"); setPollKey((k) => k + 1); }}>{t.retry}<span>↻</span></button>
            </div>
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