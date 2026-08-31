import LegalShell, { Placeholder } from "../LegalShell";

export const metadata = { title: "Terms of use · Jonas Fitness" };

export default function TermsPage() {
  return (
    <LegalShell kicker="TERMS" title="Terms of use" updated="Not yet published to production — DRAFT structure">
      <p>
        These terms describe the Jonas Fitness Progress (“Progress”) software product and the one-time
        Founding Access purchase. They are <strong>DRAFT structure</strong> and not yet production-ready.
      </p>

      <section>
        <h2>What Progress is</h2>
        <p>
          Progress is <strong>self-directed strength/bodybuilding training software</strong>. It provides:
        </p>
        <ul>
          <li>workout routines and routine management;</li>
          <li>recording of sets, reps, load (weight) and optional RIR for each working set;</li>
          <li>a <em>previous → target → actual</em> progression workflow so you can compare today against what you did last time;</li>
          <li>progress and history analytics (best performances, trends, volume, estimated 1RM where appropriate).</li>
        </ul>
      </section>

      <section>
        <h2>What Progress is not</h2>
        <ul>
          <li><strong>Not 1:1 coaching</strong> — no professional coaching relationship is formed.</li>
          <li><strong>Not medical advice or diagnosis</strong> — Progress does not assess, treat, or prescribe for injuries, illnesses, or medical conditions.</li>
          <li><strong>Not an individualized nutrition service.</strong></li>
          <li><strong>No guaranteed fitness results.</strong></li>
          <li><strong>Not an AI trainer.</strong> Progress is a transparent training log with deterministic analytics; it does not generate programs or act as an automated personal trainer.</li>
        </ul>
      </section>

      <section>
        <h2>Founding Access</h2>
        <p>
          Progress is offered as a <strong>one-time Founding Access</strong> (currently €19). Founding customers receive
          access to the current Progress product. Future, optional products or services may be sold separately. This is
          not a subscription (no recurring billing).
        </p>
      </section>

      <section>
        <h2>Seller &amp; payment positioning</h2>
        <p>
          Where Stripe Managed Payments is enabled (merchant of record for the payment transaction), Stripe/Link act
          as the payment intermediary for that transaction and process payment data under their own terms and privacy
          policy. Our terms govern the Jonas Fitness Progress <em>product and support</em>; they do not claim that Jonas
          Fitness collects/remits VAT for Managed Payments transactions, and they do not claim Managed Payments removes
          our own legal, privacy, product-support, consumer-information, or data-protection obligations.
        </p>
        <p>
          Where ordinary Stripe Payments (non-managed) is used instead, the applicable tax/compliance treatment — including
          any VAT/indirect-tax obligations — is our responsibility under this draft; specifics still to be confirmed.
        </p>
      </section>

      <section>
        <h2>Seller / legal identity (required)</h2>
        <ul>
          <li>Seller name / entity <Placeholder label="SELLER NAME / ENTITY" /></li>
          <li>Legal form / status <Placeholder label="LEGAL FORM / STATUS" /></li>
          <li>Registered address <Placeholder label="REGISTERED ADDRESS" /></li>
          <li>Business identifiers <Placeholder label="BUSINESS IDENTIFIERS" /></li>
          <li>Business email <Placeholder label="BUSINESS EMAIL" /></li>
          <li>Governing law / competent jurisdiction <Placeholder label="GOVERNING LAW" /></li>
        </ul>
      </section>

      <section>
        <h2>Acceptance &amp; availability</h2>
        <p>
          Final acceptance conditions, applicable-territory statements, and any consumer rights (including withdrawal) will be
          completed once the seller identity above is confirmed. This page remains <strong>NOT PRODUCTION READY</strong>.
        </p>
      </section>
    </LegalShell>
  );
}