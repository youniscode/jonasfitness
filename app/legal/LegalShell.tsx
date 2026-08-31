import Link from "next/link";

/** Placeholder field — one piece of legal identity info we still must confirm. */
export function Placeholder({ label }: { label: string }) {
  return (
    <span className="legal-placeholder">
      <strong>[{label} — REQUIRED]</strong>
    </span>
  );
}

/**
 * Shared shell for the Jonas Fitness legal/document pages (dark + lime brand,
 * consistent with the public Progress offer page). These pages are intentionally
 * DRAFT structure, not production legal documents: every identity/data/legal
 * fact we still need to confirm is rendered as an explicit placeholder so it
 * cannot be mistaken for a real statement. Nothing here is legal advice.
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

      <div className="legal-alert" role="note">
        DRAFT — These pages are <strong>NOT production-ready legal documents</strong>.
        Every required legal/seller/data fact that has not yet been confirmed is shown
        as a marked placeholder. Do not rely on them until reviewed.
      </div>

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
    </main>
  );
}