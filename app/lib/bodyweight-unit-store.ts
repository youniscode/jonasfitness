/**
 * Client-side display/input unit preference for the self-service Progress
 * Bodyweight page, mirroring the shared lang-store conventions.
 *
 * This module only manages WHICH unit the page shows (kg or lb). Measurement
 * values are NEVER persisted here - canonical kg storage stays server-side in
 * bodyweight_entries. There is deliberately no DB column, no migration and no
 * account-wide unit architecture: a lightweight localStorage key under the
 * existing "jonas-progress-*" naming convention, defaulting to kg.
 * It contains no React hooks and may be imported from "use client" modules.
 */

import { type BodyweightUnit } from "./bodyweight.ts";

/** Stable localStorage key: Bodyweight page unit preference (kg | lb). */
export const BODYWEIGHT_UNIT_STORAGE_KEY = "jonas-progress-bodyweight-unit";

/** Default when nothing is stored (matches the page's existing default). */
export const DEFAULT_BODYWEIGHT_UNIT: BodyweightUnit = "kg";

/** Coerces any stored/unknown value to exactly kg or lb (default kg). */
export function parseBodyweightUnit(value: string | null): BodyweightUnit {
  return value === "lb" ? "lb" : "kg";
}

/** SSR-safe read: returns the stored unit, or kg when unavailable. */
export function readStoredBodyweightUnit(): BodyweightUnit {
  if (typeof window === "undefined") return DEFAULT_BODYWEIGHT_UNIT;
  try {
    return parseBodyweightUnit(window.localStorage.getItem(BODYWEIGHT_UNIT_STORAGE_KEY));
  } catch {
    return DEFAULT_BODYWEIGHT_UNIT;
  }
}

/** Best-effort persistence; the choice still works for the current page when storage is disabled. */
export function persistBodyweightUnit(unit: BodyweightUnit): void {
  try {
    window.localStorage.setItem(BODYWEIGHT_UNIT_STORAGE_KEY, unit);
  } catch {
    /* storage may be disabled; selection still works for this page */
  }
}
