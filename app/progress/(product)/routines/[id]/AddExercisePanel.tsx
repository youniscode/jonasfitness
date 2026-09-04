"use client";

// Add-exercise picker shared by RoutineDetail and the /dev/routine-add harness.
//
// The common catalogue path is instant add: tapping a search result creates the
// exercise immediately with the product's default prescription (3 sets, 8-12
// reps, RIR 2, kg) in the currently selected section. The per-exercise
// configuration (sets/reps/RIR/unit/section) stays on the routine card, where
// it is edited after the add (progressive disclosure) - no second confirmation
// step for the catalogue path. Custom exercises keep their explicit form
// (name + configuration + Add) because there is no catalogue result to act as
// the confirmation event; the form is hidden behind a disclosure link so it
// never competes with catalogue search.

import { useEffect, useRef, useState } from "react";
import { exerciseDisplayName, searchCatalogue, type ExerciseDefinition } from "../../../../lib/exercise-catalogue";
import type { ProgressText } from "../../progress-text";
import ExerciseThumb from "./ExerciseThumb";
import type { Section } from "./RoutineSortable";

/** Product defaults applied automatically to every catalogue instant add. */
export const CATALOGUE_ADD_DEFAULTS = { sets: 3, targetRepMin: 8, targetRepMax: 12, targetRir: 2, weightUnit: "kg" as const };

export type AddExerciseDraft = {
  exerciseId: string;
  name: string;
  nameFr: string;
  nameAr: string;
  sets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  weightUnit: "kg" | "lb";
  notes: string;
  language: "fr" | "en" | "ar";
  sectionId: number | null;
};

export type AddExerciseLang = "fr" | "en" | "ar";

/** The subset of dictionary keys this surface renders. */
export type AddExerciseText = Pick<
  ProgressText,
  | "exerciseName" | "searchCatalogue" | "cantFind" | "createCustom" | "customExerciseName"
  | "customExercise" | "workingSets" | "repRange" | "targetRir" | "unit" | "add" | "saving"
  | "added" | "error" | "moveToSection" | "ungrouped"
>;

export type AddExercisePanelProps = {
  t: AddExerciseText;
  lang: AddExerciseLang;
  /** Ordered routine sections; [] means everything lands ungrouped. */
  sections: Section[];
  /** Section new exercises land in by default (first section or null). */
  defaultSectionId: number | null;
  /** Performs the POST through the existing routine-exercise path and resolves
   *  with the server-confirmed routine; throws to surface a failure. */
  onAdd: (draft: AddExerciseDraft) => Promise<void>;
  onClose: () => void;
};

function customExerciseIdFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `custom-${slug || "exercise"}`;
}

/** Server errors are English; the literal "error" (non-JSON 500) is filtered
 *  so the localized generic copy reaches the user instead. */
function messageOf(issue: unknown) {
  return issue instanceof Error && issue.message && issue.message !== "error" ? issue.message : "";
}

export default function AddExercisePanel({ t, lang, sections, defaultSectionId, onAdd, onClose }: AddExercisePanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [pendingExerciseId, setPendingExerciseId] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [sectionChoice, setSectionChoice] = useState<string>(defaultSectionId === null ? "" : String(defaultSectionId));
  const [customSets, setCustomSets] = useState(CATALOGUE_ADD_DEFAULTS.sets);
  const [customRepMin, setCustomRepMin] = useState(CATALOGUE_ADD_DEFAULTS.targetRepMin);
  const [customRepMax, setCustomRepMax] = useState(CATALOGUE_ADD_DEFAULTS.targetRepMax);
  const [customRir, setCustomRir] = useState(CATALOGUE_ADD_DEFAULTS.targetRir);
  const [customUnit, setCustomUnit] = useState<"kg" | "lb">(CATALOGUE_ADD_DEFAULTS.weightUnit);
  const [addedName, setAddedName] = useState("");
  const [panelError, setPanelError] = useState("");

  const trimmedQuery = query.trim();
  const matches = searchCatalogue(trimmedQuery);
  const highlighted = matches.length > 0 ? Math.min(activeIndex, matches.length - 1) : 0;

  // The confirmation message is transient: it must never persist into the next
  // search or linger as stale state when the panel reopens.
  useEffect(() => {
    if (!addedName) return;
    const timer = window.setTimeout(() => setAddedName(""), 1600);
    return () => window.clearTimeout(timer);
  }, [addedName]);

  function submit(draft: AddExerciseDraft) {
    // Synchronous ref guard + disabled rows: even two clicks in the same tick
    // can never fire a duplicate creation request.
    if (inFlightRef.current) return Promise.resolve();
    inFlightRef.current = true;
    setPending(true);
    setPanelError("");
    return onAdd(draft)
      .then(() => {})
      .catch((issue: unknown) => { setPanelError(messageOf(issue) || t.error); throw issue; })
      .finally(() => { inFlightRef.current = false; setPending(false); setPendingExerciseId(null); });
  }

  function quickAdd(exercise: ExerciseDefinition) {
    setPendingExerciseId(exercise.id);
    void submit({
      exerciseId: exercise.id,
      name: exercise.name,
      nameFr: exercise.nameFr,
      nameAr: exercise.nameAr,
      ...CATALOGUE_ADD_DEFAULTS,
      notes: "",
      language: lang,
      sectionId: sectionChoice === "" ? null : Number(sectionChoice),
    }).then(() => {
      // Keep the picker open for rapid multi-add: clear the query, show a
      // brief confirmation and hand focus back to the search field.
      setQuery("");
      setActiveIndex(0);
      setAddedName(exerciseDisplayName(exercise, lang));
      searchRef.current?.focus();
    }).catch(() => {
      // Failure keeps the query and results intact so the user can retry.
      searchRef.current?.focus();
    });
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) { setPanelError(t.error); customRef.current?.focus(); return; }
    setPendingExerciseId(null);
    void submit({
      exerciseId: customExerciseIdFor(name),
      name,
      nameFr: "",
      nameAr: "",
      sets: customSets,
      targetRepMin: customRepMin,
      targetRepMax: customRepMax,
      targetRir: customRir,
      weightUnit: customUnit,
      notes: "",
      language: lang,
      sectionId: sectionChoice === "" ? null : Number(sectionChoice),
    }).then(() => {
      setCustomName("");
      setAddedName(name);
      customRef.current?.focus();
    }).catch(() => {
      customRef.current?.focus();
    });
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { onClose(); return; }
    if (matches.length === 0 || pending) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, matches.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); quickAdd(matches[highlighted]); }
  }

  const sectionSelect = sections.length > 0 ? (
    <label>{t.moveToSection}<select value={sectionChoice} onChange={(e) => setSectionChoice(e.target.value)}>
      <option value="">{t.ungrouped}</option>
      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
    </select></label>
  ) : null;

  return (
    <div className="progress-add-exercise">
      <label>{t.exerciseName}<input
        ref={searchRef}
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
        onKeyDown={onSearchKeyDown}
        placeholder={t.searchCatalogue}
      /></label>

      {addedName && <p className="progress-add-feedback" role="status"><i>✓</i> {t.added}: {addedName}</p>}
      {panelError && <p className="progress-error" role="alert">{panelError}</p>}

      {matches.length > 0 && (
        <div className={`progress-catalogue-results${pending ? " progress-results-busy" : ""}`} aria-busy={pending}>
          {matches.map((exercise, index) => {
            const active = index === highlighted;
            const adding = pending && pendingExerciseId === exercise.id;
            return (
              <button
                key={exercise.id}
                type="button"
                className={`${active ? "active" : ""}${adding ? " adding" : ""}`.trim() || undefined}
                disabled={pending}
                aria-disabled={pending}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => quickAdd(exercise)}
              >
                {/* Decorative 48px thumbnail (image for the pilot set, deterministic movement fallback otherwise).
                    It is aria-hidden and carries no handlers: the row button remains the one tap-to-add action. */}
                <ExerciseThumb exercise={exercise} />
                <span className="progress-catalogue-copy"><strong>{exerciseDisplayName(exercise, lang)}</strong><small>{exercise.muscleGroup} · {exercise.equipment}</small></span>
                {pending && pendingExerciseId === exercise.id && <em>{t.saving}</em>}
              </button>
            );
          })}
        </div>
      )}

      {!showCustom && sectionSelect}

      {!showCustom ? (
        <div className="progress-custom-row">
          <span>{t.cantFind}</span>
          <button type="button" className="progress-ghost progress-custom-toggle" onClick={() => { setShowCustom(true); window.setTimeout(() => customRef.current?.focus(), 0); }}>{t.createCustom}<span>+</span></button>
        </div>
      ) : (
        <div className="progress-custom-form">
          <label>{t.customExerciseName}<input
            ref={customRef}
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder={t.customExercise}
            maxLength={120}
          /></label>
          {sectionSelect}
          <div className="progress-add-form">
            <label>{t.workingSets}<select value={customSets} onChange={(e) => setCustomSets(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{t.repRange}<span className="progress-rep-range"><input type="number" min={1} max={40} value={customRepMin} onChange={(e) => setCustomRepMin(Number(e.target.value))} /><i>–</i><input type="number" min={1} max={40} value={customRepMax} onChange={(e) => setCustomRepMax(Number(e.target.value))} /></span></label>
            <label>{t.targetRir}<select value={customRir} onChange={(e) => setCustomRir(Number(e.target.value))}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{t.unit}<select value={customUnit} onChange={(e) => setCustomUnit(e.target.value as "kg" | "lb")}><option value="kg">kg</option><option value="lb">lb</option></select></label>
          </div>
          <button className="progress-cta" disabled={pending || !customName.trim()} onClick={addCustom}>{t.add}<span>+</span></button>
        </div>
      )}
    </div>
  );
}
