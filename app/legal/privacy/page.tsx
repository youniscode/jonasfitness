import LegalShell, { SellerIdentity } from "../LegalShell";

export const metadata = { title: "Privacy · Jonas Fitness" };

export default function PrivacyPage() {
  return (
    <LegalShell kicker="PRIVACY" title="Privacy" updated="2026">
      <p>
        This page describes the personal data handled in relation to Jonas Fitness Progress (“Progress”) and the
        processors we use. It inventories what actually exists in the product today and states the applicable
        retention and legal-basis policy, without inventing periods or features.
      </p>

      <section>
        <h2>What we process</h2>
        <ul>
          <li><strong>Account identity (via Clerk):</strong> Clerk account identity, email, user ID, and sign-in/session data.</li>
          <li><strong>Training data (stored by the app):</strong> workout routines, exercises, sets/reps/load/RIR, targets, and exercise/workout history.</li>
          <li><strong>Purchase &amp; entitlement data:</strong> order/payment identifiers, product entitlement and its status (active/revoked), timestamps.</li>
          <li><strong>First-party validation events:</strong> funnel events such as offer viewed, checkout started, purchase completed, first routine created, first workout started/completed.</li>
          <li><strong>Technical logs:</strong> server logs and error/diagnostic output produced by the platforms below.</li>
        </ul>
        <p>We do not collect any biometric, health-diagnosis, or medical data. Training logs are exercise records, not medical information.</p>
      </section>

      <section>
        <h2>Processors / services actually used</h2>
        <ul>
          <li><strong>Clerk</strong> — authentication/identity (account creation, sign-in, user profile data).</li>
          <li><strong>Neon</strong> — Postgres database storage of training, purchase/entitlement, and validation data.</li>
          <li><strong>Vercel</strong> — application hosting and infrastructure.</li>
          <li><strong>Stripe / Link</strong> — payment processing. Where Stripe Managed Payments is used (merchant-of-record for the transaction), Stripe/Link process payment data (e.g. payment method and transaction details) directly under their own terms and privacy policy.</li>
        </ul>
      </section>

      <section>
        <h2>What Stripe / Link handle versus us</h2>
        <p>
          Payment method data (card details, Link credentials, etc.) is collected and processed by Stripe/Link, not
          stored by us. We store order/payment references (session/payment identifiers) needed to reconcile and
          grant your entitlement, but never full card data. Where Managed Payments applies, Stripe/Link act as
          merchant of record for the payment transaction.
        </p>
      </section>

      <section>
        <h2>Retention</h2>
        <ul>
          <li><strong>Account and training data:</strong> retained for as long as your account remains active.</li>
          <li><strong>Purchase / entitlement / validation records:</strong> retained for as long as needed for the seller’s legal obligations (including tax and accounting) and to verify entitlements.</li>
          <li><strong>Technical logs:</strong> retained for the limited period needed for security, reliability, and troubleshooting.</li>
          <li><strong>Deletion / export:</strong> Progress does not currently offer an in-app self-service data export. To request deletion or a copy of your data, contact <a href="mailto:contact@jonascode.com">contact@jonascode.com</a>; requests are processed in accordance with applicable law.</li>
        </ul>
      </section>

      <section>
        <h2>Status</h2>
        <p>
          Jonas Fitness is an <strong>additional digital/software activity</strong> of the legal seller’s existing
          enterprise. The filing of this additional activity with the French administration (Guichet unique / RNE) is{" "}
          <strong>pending</strong> — an administrative update in progress, not claimed as completed.
        </p>
      </section>

      <section>
        <h2>Legal basis &amp; rights</h2>
        <p>The data controller for Progress personal data is the legal seller:</p>
        <SellerIdentity />
        <p>Where EU/UK data-protection law applies, we rely on the following legal bases:</p>
        <ul>
          <li>providing the service and storing your training data: performance of the contract with you (Article 6(1)(b) GDPR);</li>
          <li>purchase / entitlement / validation records: performance of the contract and, for tax- and accounting-related records, compliance with a legal obligation (Article 6(1)(c) GDPR);</li>
          <li>technical logs and security / anti-fraud measures: our legitimate interest in operating a secure and reliable service (Article 6(1)(f) GDPR).</li>
        </ul>
        <p>
          You have the rights of access, rectification, erasure, restriction, portability, and objection where the
          legal conditions are met. For any privacy request, contact{" "}
          <a href="mailto:contact@jonascode.com">contact@jonascode.com</a>.
        </p>
        <h3>International transfers</h3>
        <p>
          Some of our processors (Clerk, Stripe, Vercel, Neon) may process data on infrastructure located outside the
          EEA. Where transfers outside the EEA occur, we rely on the safeguards offered by the processors concerned,
          including the European Commission’s standard contractual clauses where applicable.
        </p>
      </section>
    </LegalShell>
  );
}