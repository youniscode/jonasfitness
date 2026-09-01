import Link from "next/link";

/**
 * VERIFIED legal seller identity (checked against the existing French EI registration).
 * Jonas Fitness is the product/brand; the legal seller/operator is Younis MOHAMMAD,
 * entrepreneur individuel (micro-entrepreneur). This is NOT a separate company.
 */
export function SellerIdentity() {
  return (
    <address className="legal-seller">
      <strong>Younis MOHAMMAD</strong>
      <br />
      Entrepreneur individuel (micro-entrepreneur)
      <br />
      SIREN 108 783 192 — SIRET 108 783 192 00017
      <br />
      104 Avenue Vauban, 83000 Toulon, France
      <br />
      <a href="mailto:contact@jonascode.com">contact@jonascode.com</a>
    </address>
  );
}

/**
 * Shared shell for the Jonas Fitness legal/document pages (dark + lime brand,
 * consistent with the public Progress offer page). Each page states an honest
 * status for any outstanding administrative item — it never claims unresolved
 * obligations as resolved and never invents facts. Nothing here is legal advice.
 */
export default function LegalShell({
  kicker,
  title,
  updated,
  children,
}: {
  kicker: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="legal">
      <header className="legal-nav">
        <Link className="legal-brand" href="/">
          <span className="brand-mark">JF</span>
          <span>JONAS FITNESS</span>
        </Link>
        <nav className="legal-links" aria-label="Legal">
          <Link href="/legal">Legal</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/refunds">Refunds</Link>
        </nav>
      </header>

      <article className="legal-article">
        <p className="legal-kicker"><span />{kicker}</p>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {updated}</p>
        {children}
      </article>

      <footer className="legal-footer">
        <p>© 2026 Jonas Fitness · Founding Access</p>
        <nav>
          <Link href="/legal">Legal</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/refunds">Refunds</Link>
        </nav>
      </footer>
      <p className="legal-disclaimer">
        These documents are provided for information only and do not constitute legal advice.
      </p>
    </main>
  );
}