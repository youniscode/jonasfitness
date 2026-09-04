// ---------------------------------------------------------------------------
// Jonas Progress exercise thumbnail generator (full legacy Coach coverage)
//
// Produces the small webp files under public/exercises/thumbs/ that the
// Add-Exercise picker renders. Deterministic and idempotent - safe to rerun.
//
// Provenance of every output:
//   - coach derivative files  : downscaled from the project's OWNED coach
//     photos (public/exercises/<slug>.webp). Reuse of existing project
//     assets - no new copyright surface.
//   - illustration files      : vector poses authored in-house for Jonas
//     Progress below (created in-house; no stock, no scraping, no third-party
//     artwork). They use the same dark-tile + lime line-art grammar as the
//     app's exercise fallback figures so rows stay visually coherent.
//
// Coach slugs are NOT hardcoded: they are derived from each legacy Coach
// exercise's own canonical imageUrl in app/lib/exercise-catalogue.ts, so the
// asset set can never drift from the catalogue - rerun after any catalogue
// change. The script fails loudly if a coach row's source photo is missing.
//
// Run:  node scripts/generate-exercise-thumbs.mjs
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { coachCatalogueExercises } from "../app/lib/exercise-catalogue.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "public", "exercises");
const OUT_DIR = join(SRC_DIR, "thumbs");

const WEBP = { quality: 74, effort: 5 };
const THUMB_WIDTH = 288; // ~6x the 48px tile; object-fit: cover crops to square

/** Coach slugs: every legacy Coach exercise that owns a canonical source
 *  photo (/exercises/<slug>.webp) gets a downscaled derivative thumbnail. */
const COACH_SLUGS = coachCatalogueExercises.map((exercise) => {
  const match = /^\/exercises\/([a-z0-9]+(?:-[a-z0-9]+)*)\.webp$/.exec(exercise.imageUrl);
  if (!match) throw new Error(`non-canonical coach imageUrl on ${exercise.id}: ${JSON.stringify(exercise.imageUrl)}`);
  return match[1];
});

/** Illustration slugs: thumbnail = in-house pose SVG rendered below. These are
 *  Progress-only exercises (no source photo) with an OPTIONAL thumbnail. */
const ILLUSTRATION_SLUGS = [
  "decline-barbell-bench-press",
  "dumbbell-fly",
  "front-squat",
  "ez-bar-curl",
];

// ---------------------------------------------------------------------------
// In-house pose illustrations. 256x256 canvas, #171a15 tile background and
// #dfffb0 lime strokes - the same ink + lime grammar as the app fallbacks.
// Kept deliberately minimal so the pose still reads at 48px.
// ---------------------------------------------------------------------------
const BG = "#171a15";
const INK = "#dfffb0";

const art = {
  // Profile: declining bench (head low-left, hips high-right), lifter pressing
  // a loaded barbell up off the lower chest.
  "decline-barbell-bench-press": `
    <rect width="256" height="256" fill="${BG}"/>
    <g fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <path d="M46 196 L212 126"/>
      <path d="M84 179v17M178 140v18"/>
      <circle cx="70" cy="180" r="10"/>
      <path d="M82 173 L156 141"/>
      <path d="M102 163 V112"/>
      <path d="M102 112 L134 84"/>
      <path d="M92 84 H204"/>
      <path d="M92 76v16M102 74v18M194 74v18M204 76v16"/>
    </g>`,
  // Profile on a flat bench: head right, near arm stretched out to the left
  // holding a vertical dumbbell - the open bottom of a fly rep.
  "dumbbell-fly": `
    <rect width="256" height="256" fill="${BG}"/>
    <g fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <path d="M48 152 H214"/>
      <path d="M100 152 v26 M168 152 v26"/>
      <circle cx="200" cy="142" r="10"/>
      <path d="M188 146 L120 146"/>
      <path d="M172 146 C148 138 118 132 96 130"/>
      <path d="M96 116 V146"/>
      <path d="M90 118 h12 M90 144 h12"/>
    </g>`,
  // Side profile deep squat in the front-rack position: torso upright, knees
  // bent, the bar across the front delts with the forearms raised to it.
  "front-squat": `
    <rect width="256" height="256" fill="${BG}"/>
    <g fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="120" cy="42" r="11"/>
      <path d="M120 54 L106 118"/>
      <path d="M106 118 72 140"/>
      <path d="M72 140 V198"/>
      <path d="M106 118 142 134"/>
      <path d="M142 134 V198"/>
      <path d="M58 198 H88 M128 198 H158"/>
      <path d="M124 74 L96 96"/>
      <path d="M76 96 H168"/>
    </g>`,
  // Front view: standing curl at the top of the rep - forearms raised, hands
  // holding an EZ-style bar across the chest.
  "ez-bar-curl": `
    <rect width="256" height="256" fill="${BG}"/>
    <g fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="128" cy="40" r="11"/>
      <path d="M128 52 L128 128"/>
      <path d="M128 128 106 198 M128 128 150 198"/>
      <path d="M96 198 h20 M140 198 h20"/>
      <path d="M104 90 V128 M152 90 V128"/>
      <path d="M104 128 V106 M152 128 V106"/>
      <path d="M82 106 H174"/>
    </g>`,
};

function svg(slug) {
  const body = art[slug] ?? "";
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let coachCount = 0;
  let illustrationCount = 0;

  for (const slug of COACH_SLUGS) {
    const source = join(SRC_DIR, `${slug}.webp`);
    if (!existsSync(source)) throw new Error(`missing coach source asset for slug "${slug}": ${source}`);
    const out = join(OUT_DIR, `${slug}.webp`);
    await sharp(source).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp(WEBP).toFile(out);
    coachCount += 1;
  }

  for (const slug of ILLUSTRATION_SLUGS) {
    const out = join(OUT_DIR, `${slug}.webp`);
    await sharp(Buffer.from(svg(slug))).resize({ width: 256, height: 256 }).webp({ ...WEBP, quality: 82 }).toFile(out);
    illustrationCount += 1;
  }

  console.log(`derived   ${coachCount} coach thumbnails (from catalogue imageUrls)`);
  console.log(`authored  ${illustrationCount} in-house illustration thumbnails`);
  console.log(`total     ${coachCount + illustrationCount} files under public/exercises/thumbs/`);
  if (coachCount !== 106) {
    console.warn(`note: coach catalogue count is ${coachCount}, not the usual 106 - catalogue may have changed`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
