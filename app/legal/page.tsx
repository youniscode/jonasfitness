import Link from "next/link";
import LegalShell, { Placeholder } from "./LegalShell";

export const metadata = { title: "Legal · Jonas Fitness" };

export default function LegalPage() {
  return (
    <LegalShell kicker="LEGAL" title="Legal" updated="Not yet published to production — DRAFT structure">
      <p>
        This section lists the legal and consumer documents that will govern the purchase and use of
        Jonas Fitness Progress (“Progress”), a self-directed strength/bodybuilding training log offered
        as a €19 one-time Founding Access.
      </p>

      <section>
        <h2>Documents</h2>
        <ul>
          <li><Link href="/legal/privacy">Privacy</Link> — how we process personal data and which processors are involved.</li>
          <li><Link href="/legal/terms">Terms of use</Link> — the product, what it is and is not, and Founding Access.</li>
          <li><Link href="/legal/refunds">Refunds &amp; withdrawals</Link> — money-back / consumer-rights policy.</li>
        </ul>
      </section>

      <section>
        <h2>Seller / legal identity</h2>
        <p>
          The following seller and legal identity details are <strong>still required</strong> before live sales and are
          shown here as explicit placeholders:
        </p>
        <ul>
          <li>Legal seller name / entity <Placeholder label="SELLER NAME / ENTITY" /></li>
          <li>Legal form / status <Placeholder label="LEGAL FORM / STATUS" /></li>
          <li>Registered / business address <Placeholder label="REGISTERED ADDRESS" /></li>
          <li>Business identifiers (SIREN / SIRET / RCS / VAT id where applicable) <Placeholder label="BUSINESS IDENTIFIERS" /></li>
          <li>Business contact / support email <Placeholder label="BUSINESS EMAIL" /></li>
          <li>Publication director if required <Placeholder label="PUBLICATION DIRECTOR" /></li>
          <li>Hosting provider &amp; details <Placeholder label="HOSTING" /></li>
          <li>Consumer mediator name / contact / site (if applicable) <Placeholder label="CONSUMER MEDIATOR" /></li>
          <li>Governing law / dispute provisions <Placeholder label="GOVERNING LAW" /></li>
        </ul>
        <p>
          None of these details have been invented here. This page remains <strong>NOT PRODUCTION READY</strong> until
          each placeholder is supplied and reviewed.
        </p>
      </section>

      <p>
        Note: where Stripe Managed Payments is used, Stripe/Link act as merchant of record for the payment
        transaction. The transaction terms apply between you and Stripe/Link as the payment intermediary; Jonas
        Fitness’s own terms below describe the software product and support we provide. This does not remove our
        own product-support, privacy, consumer-information, or data-protection obligations.
      </p>
    </LegalShell>
  );
}