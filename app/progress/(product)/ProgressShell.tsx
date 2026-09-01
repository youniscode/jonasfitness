"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { ProgressLangProvider, useProgressLang } from "./progress-lang";
import { progressLocales } from "./progress-text";

function Nav({ children }: { children: React.ReactNode }) {
  const { lang, setLang, t } = useProgressLang();
  const pathname = usePathname();
  const { user } = useUser();
  const rtl = lang === "ar";
  const baseClass = rtl ? "rtl-site" : "";
  const links = [
    { href: "/progress", label: t.navDashboard, active: pathname === "/progress" || pathname === "/progress/" },
    { href: "/progress/routines", label: t.navRoutines, active: pathname.startsWith("/progress/routines") },
    { href: "/progress/history", label: t.navHistory, active: pathname.startsWith("/progress/history") },
  ];
  return (
    <main dir={rtl ? "rtl" : "ltr"} className={`progress-page ${baseClass}`}>
      <header className="progress-header">
        <Link className="progress-brand" href="/progress"><span className="brand-mark">JP</span><span>{t.brand}</span></Link>
        <nav className="progress-nav" aria-label="Progress">
          {links.map((link) => <Link key={link.href} className={link.active ? "active" : ""} href={link.href}>{link.label}</Link>)}
        </nav>
        <div className="progress-header-end">
          <div className="progress-lang">{progressLocales.map((l) => <button type="button" key={l.code} className={lang === l.code ? "active" : ""} onClick={() => setLang(l.code)}>{l.label}</button>)}</div>
          <span className="progress-name">{user?.firstName || ""}</span>
          <UserButton />
        </div>
      </header>
      <div className="progress-content">{children}</div>
    </main>
  );
}

export default function ProgressShell({ children }: { children: React.ReactNode }) {
  return (
    <ProgressLangProvider>
      <Nav>{children}</Nav>
    </ProgressLangProvider>
  );
}