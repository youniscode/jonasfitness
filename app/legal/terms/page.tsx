import LegalShell, { SellerIdentity } from "../LegalShell";

export const metadata = { title: "Terms of use · Jonas Fitness" };

export default function TermsPage() {
  return (
    <LegalShell kicker="TERMS" title="Terms of use" updated="2026">
      <p>
        These terms govern the Jonas Fitness Progress (“Progress”) software product and the one-time
        Founding Access purchase.
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
          any VAT/indirect-tax obligations — is our responsibility; the specifics are not yet confirmed, and no VAT number
          is claimed in these terms.
        </p>
      </section>

      <section>
        <h2>Seller / legal identity</h2>
        <p>The legal seller / operator of Jonas Fitness Progress is:</p>
        <SellerIdentity />
        <p>
          Jonas Fitness is the <strong>product/brand</strong>; the legal seller / operator is Younis MOHAMMAD,
          entrepreneur individuel. Riviera With Younis is an existing commercial name of the same enterprise
          individuelle. Jonas Fitness is an additional activity of this existing EI.
        </p>
        <ul>
          <li>
            <strong>Governing law / competent jurisdiction:</strong> French law applies to these terms. Nothing in
            them limits the mandatory consumer-protection rights you may have under the law of your country of
            residence, including the right to bring a dispute before the courts of your place of residence where
            applicable law grants it.
          </li>
          <li>
            <strong>Additional-activity registration (French Guichet unique / RNE):</strong> the filing for the
            Jonas Fitness additional digital/software activity is <strong>pending</strong> — an administrative update
            in progress, not claimed as completed.
          </li>
          <li>
            <strong>Consumer mediator:</strong> no consumer mediator is currently designated; designation and
            publication of a referenced mediator’s details for consumer-mediation matters are pending.
          </li>
          <li>
            <strong>VAT:</strong> no VAT number is currently displayed. VAT treatment follows the applicable French
            rules for the seller’s activity and will be updated here when confirmed.
          </li>
        </ul>
      </section>

      <section>
        <h2>Acceptance &amp; availability</h2>
        <p>
          By purchasing Founding Access or using Progress, you accept these terms. These terms do not exclude the
          mandatory rights you have under consumer law.
        </p>
      </section>
    </LegalShell>
  );
}