import Link from "next/link";
import LegalShell, { Placeholder, SellerIdentity } from "./LegalShell";

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
        <p>The legal seller / operator of Jonas Fitness Progress is:</p>
        <SellerIdentity />
        <p>
          Jonas Fitness is the <strong>product/brand</strong>. The legal seller / operator is Younis MOHAMMAD,
          entrepreneur individuel. Riviera With Younis is an existing commercial name of the same enterprise
          individuelle; it is not a separate company. Jonas Fitness represents an additional activity of this
          existing EI.
        </p>
        <ul>
          <li>
            Jonas Fitness additional digital/software activity registration (French Guichet unique / RNE){" "}
            <Placeholder label="REGISTRATION PENDING — LAUNCH BLOCKER" />
          </li>
          <li>Consumer mediator (not yet selected/contracted) <Placeholder label="CONSUMER MEDIATOR — PENDING — LAUNCH BLOCKER" /></li>
          <li>VAT number (if applicable) <Placeholder label="VAT NUMBER" /></li>
          <li>Publication director if required <Placeholder label="PUBLICATION DIRECTOR" /></li>
          <li>Hosting provider &amp; details <Placeholder label="HOSTING" /></li>
          <li>Governing law / dispute provisions <Placeholder label="GOVERNING LAW" /></li>
        </ul>
        <p>
          Seller name, legal form/status, registered address, SIREN/SIRET and business email are now verified and
          shown above. The items still listed remain <strong>explicit launch blockers</strong>. This page is still{" "}
          <strong>NOT PRODUCTION READY</strong> until the outstanding placeholders are supplied and reviewed.
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