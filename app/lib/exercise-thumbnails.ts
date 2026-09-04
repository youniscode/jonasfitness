// ---------------------------------------------------------------------------
// Jonas Progress exercise thumbnails (Add-Exercise picker only)
//
// Lightweight thumbnail metadata for the self-service picker. v0.1 is a small
// pilot by design - NOT full-catalogue media production:
//
//   - the 106 Coach-integrated exercises keep their existing imageUrl metadata
//     untouched (coach surfaces, programme snapshots and history never change)
//   - a static pilot map below gives ~18 exercises a small webp thumbnail
//     (public/exercises/thumbs/*.webp), reusing owned Coach assets downscaled
//     for the coach rows and in-house pose illustrations for Progress-only rows
//   - every other exercise resolves to null and the UI renders its
//     deterministic fallback tile (the picker must be fully usable at 0%
//     coverage)
//
// The map is the single source of truth the Add Exercise row consumes:
//   getExerciseThumbnail(exercise) -> local webp path | null
//
// Widening later is a metadata-only change: add catalogue ids to the pilot map
// (or auto-derive a /exercises/thumbs/<slug>.webp for every remaining coach
// imageUrl) - no schema, no DB, no API, no external image host.
// ---------------------------------------------------------------------------

/** Pilot thumbnail paths keyed by stable catalogue exercise id. Values are
 *  local static webp files only - never remote URLs, never user uploads. */
const PILOT_THUMBNAILS: Record<string, string> = {
  // Coach-integrated exercises: downscaled derivatives of their existing
  // owned /exercises/<slug>.webp photo (thumbnails stay light on mobile).
  "builtin-barbell-bench-press": "/exercises/thumbs/barbell-bench-press.webp",
  "builtin-incline-dumbbell-press": "/exercises/thumbs/incline-dumbbell-press.webp",
  "builtin-lat-pulldown": "/exercises/thumbs/lat-pulldown.webp",
  "builtin-seated-cable-row": "/exercises/thumbs/seated-cable-row.webp",
  "builtin-lateral-raise": "/exercises/thumbs/lateral-raise.webp",
  "builtin-triceps-pressdown": "/exercises/thumbs/triceps-pressdown.webp",
  "builtin-back-squat": "/exercises/thumbs/back-squat.webp",
  "builtin-leg-press": "/exercises/thumbs/leg-press.webp",
  "builtin-leg-extension": "/exercises/thumbs/leg-extension.webp",
  "builtin-seated-leg-curl": "/exercises/thumbs/seated-leg-curl.webp",
  "builtin-romanian-deadlift": "/exercises/thumbs/romanian-deadlift.webp",
  "builtin-hip-thrust": "/exercises/thumbs/hip-thrust.webp",
  "builtin-adductor-machine": "/exercises/thumbs/adductor-machine.webp",
  "builtin-abductor-machine": "/exercises/thumbs/abductor-machine.webp",
  // Progress-only exercises: in-house pose illustrations created for Jonas
  // Progress (same dark-tile + lime line-art grammar as the app's fallback).
  "builtin-decline-barbell-bench-press": "/exercises/thumbs/decline-barbell-bench-press.webp",
  "builtin-dumbbell-fly": "/exercises/thumbs/dumbbell-fly.webp",
  "builtin-front-squat": "/exercises/thumbs/front-squat.webp",
  "builtin-ez-bar-curl": "/exercises/thumbs/ez-bar-curl.webp",
};

export const EXERCISE_THUMBNAILS: Readonly<Record<string, string>> = PILOT_THUMBNAILS;

/** Catalogue ids (builtin-*) that currently resolve to a real thumbnail. */
export const EXERCISE_THUMBNAIL_IDS: readonly string[] = Object.keys(PILOT_THUMBNAILS);

/**
 * Unified thumbnail interface for the Add-Exercise picker.
 *
 * Returns the local webp path to render for an exercise, or null when the row
 * must render its deterministic fallback tile. Pure and static: no server
 * round-trip, no DB, no image intelligence - the text name stays the primary
 * identity and this only ever decorates the result row.
 */
export function getExerciseThumbnail(exercise: { id: string }): string | null {
  return PILOT_THUMBNAILS[exercise.id] ?? null;
}
