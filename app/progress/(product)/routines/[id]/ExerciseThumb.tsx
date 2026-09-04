"use client";

// 48px exercise tile for Add Exercise search results.
//
// The thumbnail is decorative for exercise selection (the accessible name of
// the row button comes from the exercise text), so the tile is aria-hidden and
// never part of the interaction: the whole result row stays the one tap-to-add
// action and there is no thumbnail button / preview.
//
// Resolution contract (shared with the unit tests):
//   - legacy Coach exercise          -> real thumbnail derived from its own
//     (has a source photo)             canonical imageUrl (/exercises/thumbs/)
//   - Progress-only exercise with    -> its optional in-house illustration
//     an explicit optional path
//   - every other exercise / broken  -> renders the deterministic fallback
//     or missing optional path         (movement line-art on the ink tile)
// The image tile reserves its 48x48 box before load (no CLS) and lazy-loads.

import { useState } from "react";
import { ExerciseFigure, movementVariantFor } from "../../../../components/exercise-figure";
import { getExerciseThumbnail } from "../../../../lib/exercise-thumbnails";
import type { ExerciseDefinition } from "../../../../lib/exercise-catalogue";

type Props = {
  exercise: ExerciseDefinition;
};

export default function ExerciseThumb({ exercise }: Props) {
  // A missing/broken optional path must never leave an empty box or a broken
  // image icon: the row swaps to the same polished fallback as no-image rows.
  const [failed, setFailed] = useState(false);
  const src = failed ? null : getExerciseThumbnail(exercise);

  if (src) {
    return (
      <span className="progress-exercise-thumb" aria-hidden="true">
        <img src={src} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="progress-exercise-thumb progress-exercise-thumb-fallback" aria-hidden="true">
      <svg viewBox="0 0 220 160" preserveAspectRatio="xMidYMid meet">
        <ExerciseFigure variant={movementVariantFor(exercise.name)} />
      </svg>
    </span>
  );
}
