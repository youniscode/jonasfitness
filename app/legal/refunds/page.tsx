import LegalShell, { Placeholder, SellerIdentity } from "../LegalShell";

export const metadata = { title: "Refunds & withdrawals · Jonas Fitness" };

export default function RefundsPage() {
  return (
    <LegalShell kicker="REFUNDS" title="Refunds & withdrawals" updated="Not yet published to production — DRAFT structure">
      <p>
        This page describes the intended refund / consumer-withdrawal approach for Jonas Fitness Progress
        Founding Access. It is <strong>DRAFT structure</strong> and must be reviewed before live sales.
      </p>

      <section>
        <h2>Current intended policy (conservative &amp; customer-friendly)</h2>
        <p>
          Until the digital-content/digital-service withdrawal question is legally resolved, we intend a conservative,
          customer-friendly policy:
        </p>
        <ul>
          <li>If you change your mind before you begin using Progress, you may request a refund.</li>
          <li>If you are not satisfied within the refund window after purchase, you may request a refund and your Founding Access will be revoked. <Placeholder label="REFUND WINDOW — e.g. 14 days" /></li>
          <li>A confirmed full refund on your order results in the revocation of the corresponding Founding Access entitlement (access is withdrawn; training logs you created are preserved but no longer accessible under the paid product).</li>
          <li>Partial refunds do not revoke access.</li>
        </ul>
      </section>

      <section>
        <h2>EU digital-content / digital-service withdrawal — not yet relied upon</h2>
        <p>
          EU consumer rules provide that the 14-day withdrawal right can, in some cases, be excluded or modified for
          digital content/services <strong>only if</strong> the trader obtains the consumer’s express, prior
          acknowledgement and consent before supply starts. We are <strong>not</strong> currently claiming automatic loss
          of withdrawal rights.
        </p>
        <p>
          Before we could rely on any withdrawal exception we would need, at checkout, a clear consent/acknowledgement
          mechanism — which is <strong>not yet implemented</strong>. Until then we keep the conservative refund policy above.
        </p>
        <ul>
          <li>Digital-content consent/acknowledgement at checkout <Placeholder label="NOT YET IMPLEMENTED — CHECKOUT CONSENT" /></li>
        </ul>
      </section>

      <section>
        <h2>How to request a refund</h2>
        <ul>
          <li>Refund request contact <Placeholder label="SUPPORT / REFUND EMAIL" /></li>
          <li>Refund processing time <Placeholder label="REFUND PROCESSING TIME" /></li>
          <li>Refund method (to the original payment method) <Placeholder label="REFUND METHOD" /></li>
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
        <h2>Refund addressee &amp; outstanding items</h2>
        <p>Refunds are the responsibility of the legal seller:</p>
        <SellerIdentity />
        <ul>
          <li>
            Jonas Fitness additional digital/software activity registration (French Guichet unique / RNE){" "}
            <Placeholder label="REGISTRATION PENDING — LAUNCH BLOCKER" />
          </li>
          <li>Consumer mediator (not yet selected/contracted) <Placeholder label="CONSUMER MEDIATOR — PENDING — LAUNCH BLOCKER" /></li>
          <li>Governing law applicable to refunds <Placeholder label="GOVERNING LAW" /></li>
        </ul>
      </section>
    </LegalShell>
  );
}