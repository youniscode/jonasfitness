"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { type ProgressText } from "./progress-text";
import { progressText } from "./progress-text";
import { persistLang, readStoredLang, type Lang } from "../../lib/lang-store";

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void; t: ProgressText } | null>(null);

export function ProgressLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
  }, []);
  const t = useMemo(() => progressText(lang), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useProgressLang() {
  const context = useContext(LangContext);
  if (!context) throw new Error("useProgressLang must be used within ProgressLangProvider");
  return context;
}