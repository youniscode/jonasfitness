import LegalShell, { Placeholder, SellerIdentity } from "../LegalShell";

export const metadata = { title: "Privacy · Jonas Fitness" };

export default function PrivacyPage() {
  return (
    <LegalShell kicker="PRIVACY" title="Privacy" updated="Not yet published to production — DRAFT structure">
      <p>
        This page describes the personal data handled in relation to Jonas Fitness Progress (“Progress”) and the
        processors we use. It is <strong>DRAFT structure</strong>: it inventories what actually exists in the
        product today and flags retention periods that are not yet defined, rather than inventing them.
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
        <p>
          Retention periods are <strong>not currently defined</strong> and are flagged here rather than invented:
        </p>
        <ul>
          <li>Retention period for account/training data <Placeholder label="RETENTION PERIOD — DATA" /></li>
          <li>Retention period for purchase/entitlement/validation records <Placeholder label="RETENTION PERIOD — PURCHASE" /></li>
          <li>Retention period for technical logs <Placeholder label="RETENTION PERIOD — LOGS" /></li>
          <li>Data deletion / export / portability procedure <Placeholder label="DELETION &amp; EXPORT PROCEDURE" /></li>
        </ul>
      </section>

      <section>
        <h2>Status</h2>
        <p>
          Jonas Fitness is an <strong>additional digital/software activity</strong> of the legal seller’s existing
          enterprise. Registration of this additional activity with the French Guichet unique / RNE is{" "}
          <Placeholder label="REGISTRATION PENDING — LAUNCH BLOCKER" />. This document remains{" "}
          <strong>NOT PRODUCTION READY</strong> until registration and the other outstanding items below are resolved.
        </p>
      </section>

      <section>
        <h2>Legal basis &amp; rights</h2>
        <p>
          Where EU/UK data-protection law applies, your rights (access, rectification, erasure, restriction,
          portability, objection) and the precise legal bases will be set out once this page is completed. The data
          controller for Progress personal data is the legal seller:
        </p>
        <SellerIdentity />
        <ul>
          <li>Legal bases for each processing purpose <Placeholder label="LEGAL BASES" /></li>
          <li>Data-transfer safeguards (e.g. outside EEA) <Placeholder label="TRANSFER SAFEGUARDS" /></li>
          <li>Contact for privacy requests — use the seller email above.</li>
        </ul>
      </section>
    </LegalShell>
  );
}