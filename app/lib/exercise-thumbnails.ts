// ---------------------------------------------------------------------------
// Jonas Progress exercise thumbnails (Add-Exercise picker only)
//
// Lightweight thumbnail metadata for the self-service picker. Full legacy
// Coach coverage by derivation - NOT a hand-maintained per-row manifest:
//
//   - every legacy Coach exercise already carries its OWN canonical source
//     photo as imageUrl ("/exercises/<slug>.webp", public/exercises/). The
//     picker thumbnail is derived deterministically from that same slug as
//     "/exercises/thumbs/<slug>.webp" - so all 106 Coach exercises resolve a
//     real thumbnail automatically, the map can never drift from the
//     catalogue, and a row that ever loses its imageUrl simply falls back
//     instead of pointing at a broken path. Coach payloads stay untouched:
//     coach surfaces, programme snapshots and history never change.
//   - a tiny EXPLICIT set below keeps optional thumbnails for Progress-only
//     exercises that carry NO source photo (in-house pose illustrations,
//     public/exercises/thumbs/*.webp). Everything else Progress-only resolves
//     to null and the UI renders its deterministic fallback tile (the picker
//     must be fully usable at 0% coverage).
//
// The picker consumes only this interface:
//   getExerciseThumbnail(exercise) -> local webp path | null
//
// No schema, no DB, no API, no external image host. Never remote URLs.
// ---------------------------------------------------------------------------

/** Optional thumbnails for rows without a source photo (Progress-only
 *  illustrations). Values are local static webp files only. */
const OPTIONAL_THUMBNAILS: Record<string, string> = {
  "builtin-decline-barbell-bench-press": "/exercises/thumbs/decline-barbell-bench-press.webp",
  "builtin-dumbbell-fly": "/exercises/thumbs/dumbbell-fly.webp",
  "builtin-front-squat": "/exercises/thumbs/front-squat.webp",
  "builtin-ez-bar-curl": "/exercises/thumbs/ez-bar-curl.webp",
};

/** Canonical legacy Coach image path: /exercises/<slug>.webp. Only rows that
 *  already own such a photo are eligible for a derived thumbnail. */
const COACH_IMAGE_URL = /^\/exercises\/([a-z0-9]+(?:-[a-z0-9]+)*)\.webp$/;

/**
 * Unified thumbnail interface for the Add-Exercise picker.
 *
 * Resolution order:
 *   1. explicit optional path (Progress-only rows with an in-house illustration)
 *   2. derived path from the exercise's OWN canonical coach imageUrl
 *      ("/exercises/<slug>.webp" -> "/exercises/thumbs/<slug>.webp")
 *   3. null - the row renders its deterministic fallback tile
 *
 * Pure and static: no server round-trip, no DB, no image intelligence - the
 * text name stays the primary identity and this only ever decorates the row.
 */
export function getExerciseThumbnail(exercise: { id: string; imageUrl?: string }): string | null {
  const optional = OPTIONAL_THUMBNAILS[exercise.id];
  if (optional) return optional;
  const match = COACH_IMAGE_URL.exec(exercise.imageUrl ?? "");
  if (!match) return null;
  return `/exercises/thumbs/${match[1]}.webp`;
}
