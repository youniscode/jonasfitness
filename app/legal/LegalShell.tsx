"use client";

import Link from "next/link";
import { LegalLangSwitch, useLegalLang } from "./legal-lang";

const chrome = {
  fr: {
    nav: ["Légal", "Confidentialité", "Conditions", "Remboursements"],
    updated: "Dernière mise à jour :",
    disclaimer: "Ces documents sont fournis à titre informatif et ne constituent pas un avis juridique.",
  },
  en: {
    nav: ["Legal", "Privacy", "Terms", "Refunds"],
    updated: "Last updated:",
    disclaimer: "These documents are provided for information only and do not constitute legal advice.",
  },
  ar: {
    nav: ["قانوني", "الخصوصية", "الشروط", "الاسترداد"],
    updated: "آخر تحديث:",
    disclaimer: "تُقدَّم هذه المستندات لأغراض إعلامية فقط ولا تُشكّل استشارة قانونية.",
  },
} as const;

/**
 * VERIFIED legal seller identity (checked against the existing French EI registration).
 * Jonas Fitness is the product/brand; the legal seller/operator is Younis MOHAMMAD,
 * entrepreneur individuel (micro-entrepreneur). This is NOT a separate company.
 * The fields below are exact verified facts and are intentionally NOT translated.
 */
export function SellerIdentity() {
  return (
    <address className="legal-seller">
      <strong>Younis MOHAMMAD</strong>
      <br />
      Entrepreneur individuel (micro-entrepreneur)
      <br />
      SIREN 108 783 192 - SIRET 108 783 192 00017
      <br />
      104 Avenue Vauban, 83000 Toulon, France
      <br />
      <a href="mailto:contact@jonascode.com">contact@jonascode.com</a>
    </address>
  );
}

/**
 * Shared shell for the Jonas Fitness legal/document pages (dark + lime brand,
 * consistent with the public Progress offer page). Renders in fr/en/ar with
 * Arabic in RTL; each page states an honest status for any outstanding
 * administrative item; it never claims unresolved obligations as resolved and
 * never invents facts. Nothing here is legal advice.
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
  const { lang } = useLegalLang();
  const rtl = lang === "ar";
  const t = chrome[lang];
  const navHrefs = ["/legal", "/legal/privacy", "/legal/terms", "/legal/refunds"];
  return (
    <main dir={rtl ? "rtl" : "ltr"} className={`legal ${rtl ? "rtl-site" : ""}`}>
      <header className="legal-nav">
        <Link className="legal-brand" href="/">
          <span className="brand-mark">JF</span>
          <span>JONAS FITNESS</span>
        </Link>
        <nav className="legal-links" aria-label="Legal">
          {navHrefs.map((href, index) => (
            <Link key={href} href={href}>{t.nav[index]}</Link>
          ))}
        </nav>
        <LegalLangSwitch />
      </header>

      <article className="legal-article">
        <p className="legal-kicker"><span />{kicker}</p>
        <h1>{title}</h1>
        <p className="legal-updated">{t.updated} {updated}</p>
        {children}
      </article>

      <footer className="legal-footer">
        <p>© 2026 Jonas Fitness · Founding Access</p>
        <nav>
          {navHrefs.map((href, index) => (
            <Link key={href} href={href}>{t.nav[index]}</Link>
          ))}
        </nav>
      </footer>
      <p className="legal-disclaimer">{t.disclaimer}</p>
    </main>
  );
}