import Link from "next/link";
import LegalShell, { SellerIdentity } from "./LegalShell";

export const metadata = { title: "Legal · Jonas Fitness" };

export default function LegalPage() {
  return (
    <LegalShell kicker="LEGAL" title="Legal" updated="2026">
      <p>
        This section lists the legal and consumer documents that govern the purchase and use of
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
          <li><strong>Publication director:</strong> Younis MOHAMMAD, 104 Avenue Vauban, 83000 Toulon, France.</li>
          <li><strong>Hosting / deployment:</strong> Vercel — hosting and deployment of https://jonas-fitness.jonascode.com.</li>
          <li><strong>Governing law:</strong> French law applies to these documents, without limiting the mandatory consumer-protection rights you may have under the law of your country of residence.</li>
          <li><strong>VAT:</strong> no VAT number is currently displayed. VAT treatment follows the applicable French rules for the seller’s activity and will be updated here when confirmed.</li>
        </ul>
        <h3>Status of administrative items</h3>
        <p>
          The following items remain outstanding and are <strong>not claimed as completed</strong>; they are part of
          the seller’s administrative follow-up, separate from the technical operation of the service:
        </p>
        <ul>
          <li>
            <strong>Additional-activity registration (French Guichet unique / RNE):</strong> the filing for the
            Jonas Fitness additional digital/software activity is <strong>pending</strong> — an administrative update
            in progress, not claimed as completed.
          </li>
          <li>
            <strong>Consumer mediator:</strong> no consumer mediator is currently designated. A referenced mediator
            will be designated and its details published for consumer-mediation matters as required by French consumer
            law; this is being handled alongside the administrative update.
          </li>
        </ul>
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