import LegalShell, { SellerIdentity } from "../LegalShell";

export const metadata = { title: "Refunds & withdrawals · Jonas Fitness" };

export default function RefundsPage() {
  return (
    <LegalShell kicker="REFUNDS" title="Refunds & withdrawals" updated="2026">
      <p>
        This page describes our refund and consumer-withdrawal approach for Jonas Fitness Progress
        Founding Access.
      </p>

      <section>
        <h2>Refund policy (conservative &amp; customer-friendly)</h2>
        <ul>
          <li>If you change your mind before you begin using Progress, you may request a refund.</li>
          <li>If you are not satisfied within <strong>14 days</strong> of your purchase, you may request a refund and your Founding Access will be revoked.</li>
          <li>A confirmed full refund on your order results in the revocation of the corresponding Founding Access entitlement (access is withdrawn; training logs you created are preserved but no longer accessible under the paid product).</li>
          <li>Partial refunds do not revoke access.</li>
        </ul>
      </section>

      <section>
        <h2>EU digital-content / digital-service withdrawal</h2>
        <p>
          EU consumer rules provide that the 14-day withdrawal right can, in some cases, be excluded or modified for
          digital content/services <strong>only if</strong> the trader obtains the consumer’s express, prior
          acknowledgement and consent before supply starts. We do <strong>not</strong> currently rely on such an
          exception: no express checkout consent/acknowledgement exists today, so we do not claim automatic loss of
          withdrawal rights. The refund policy above therefore applies.
        </p>
      </section>

      <section>
        <h2>How to request a refund</h2>
        <ul>
          <li><strong>Refund request contact:</strong> <a href="mailto:contact@jonascode.com">contact@jonascode.com</a></li>
          <li><strong>Refund processing time:</strong> we aim to process approved refunds within 14 days of approval.</li>
          <li><strong>Refund method:</strong> to the original payment method, via Stripe.</li>
        </ul>
        <p>
          Note: where Stripe Managed Payments applies, Stripe/Link process payment transactions as merchant of record.
          This does not override our stated refund policy for the Progress product.
        </p>
      </section>

      <section>
        <h2>Technical handling (unchanged)</h2>
        <p>
          A confirmed full refund is detected server-side via Stripe’s <code>charge.refunded</code> webhook and results in
          entitlement revocation, idempotently. We do not alter this behavior merely as part of a policy change; any policy
          wording here is legally reviewed before launch.
        </p>
      </section>

      <section>
        <h2>Refund addressee &amp; status</h2>
        <p>Refunds are the responsibility of the legal seller:</p>
        <SellerIdentity />
        <ul>
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
            <strong>Governing law:</strong> French law applies to refunds, without limiting the mandatory
            consumer-protection rights you may have under the law of your country of residence.
          </li>
        </ul>
      </section>
    </LegalShell>
  );
}