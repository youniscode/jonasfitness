"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { parseLang, type ProgressText } from "./progress-text";
import { progressText } from "./progress-text";

type Lang = "fr" | "en" | "ar";

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void; t: ProgressText } | null>(null);

const STORAGE_KEY = "jonas-progress-lang";

export function ProgressLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    try { return parseLang(window.localStorage.getItem(STORAGE_KEY)); } catch { return "en"; }
  });
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be disabled */ }
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