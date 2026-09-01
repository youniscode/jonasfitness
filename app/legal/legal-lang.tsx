"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LANGS, persistLang, readStoredLang, type Lang } from "../lib/lang-store";

const LegalLangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void } | null>(null);

/**
 * Language state for the legal/commercial pages. Seeded from (and persisted to)
 * the shared Jonas Fitness lang store, so a choice made on Progress carries over
 * to the legal pages and vice versa. French is the default.
 */
export function LegalLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LegalLangContext.Provider value={value}>{children}</LegalLangContext.Provider>;
}

export function useLegalLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const context = useContext(LegalLangContext);
  if (!context) throw new Error("useLegalLang must be used within LegalLangProvider");
  return context;
}

/** FR / EN / AR switch with the same visual convention used across Jonas Fitness. */
export function LegalLangSwitch() {
  const { lang, setLang } = useLegalLang();
  return (
    <div className="legal-lang" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? "active" : ""}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}