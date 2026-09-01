/**
 * Shared client-side language store for Jonas Fitness customer surfaces.
 *
 * Follows the app's existing no-i18n-library convention (inline dictionaries,
 * no /fr /en /ar URL routing). This module only manages WHICH language is
 * selected: default = French, persisted to localStorage under one shared key so
 * the choice survives navigation between the Progress and legal surfaces.
 * It contains no React hooks and may be imported from "use client" modules.
 */

export type Lang = "fr" | "en" | "ar";

export const LANGS: readonly Lang[] = ["fr", "en", "ar"] as const;

export const DEFAULT_LANG: Lang = "fr";

/** Single shared key: Progress product, founding offer, purchase and legal pages. */
export const LANG_STORAGE_KEY = "jonas-progress-lang";

/** Coerces any stored/unknown value to one of the exactly three supported languages. */
export function parseLang(value: string | null): Lang {
  return value === "en" || value === "ar" ? value : "fr";
}

export function readStoredLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    return parseLang(window.localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return DEFAULT_LANG;
  }
}

export function persistLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage may be disabled — selection still works for this page */
  }
}