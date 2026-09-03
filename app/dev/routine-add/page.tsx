"use client";

// Dev-only Playwright harness for the ultra-fast Add Exercise flow. It mounts
// the exact AddExercisePanel and RoutineSortable components used on
// /progress/routines/[id] with fixture data and a mocked backend (latency,
// failure switch, POST counter), so a real browser can exercise instant add,
// double-tap protection and error recovery without any Clerk session or
// production database. Never rendered in production builds (NODE_ENV is
// inlined by Next.js).
import { useState } from "react";
import AddExercisePanel, { type AddExerciseDraft } from "../../progress/(product)/routines/[id]/AddExercisePanel";
import RoutineSortable, { type Placement, type Routine, type Section } from "../../progress/(product)/routines/[id]/RoutineSortable";
import { progressText, progressLocales } from "../../progress/(product)/progress-text";
import "../../progress/progress.css";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(): Routine {
  const sections: Section[] = [{ id: 1, name: "PUSH", position: 1 }];
  return {
    id: 7,
    name: "Instant add fixture",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sections,
    exercises: [],
  };
}

export default function RoutineAddHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [lang, setLang] = useState<"fr" | "en" | "ar">("en");
  const rtl = lang === "ar";
  const dict = progressText(lang);
  const [routine, setRoutine] = useState<Routine>(fixture);
  const [addOpen, setAddOpen] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [failNext, setFailNext] = useState(false);

  // Mocked backend: exactly like the real exercise POST (validated defaults,
  // next dense position, section membership) but resolved after a short
  // latency so pending/disabled states are observable in a real browser.
  async function addDraft(draft: AddExerciseDraft) {
    await sleep(280);
    if (failNext) { setFailNext(false); throw new Error("Mock backend failure"); }
    const id = 100 + postCount;
    setPostCount((count) => count + 1);
    setRoutine((current) => ({
      ...current,
      exercises: [...current.exercises, {
        id,
        position: current.exercises.length + 1,
        sectionId: draft.sectionId,
        exerciseId: draft.exerciseId,
        name: draft.name,
        nameFr: draft.nameFr,
        nameAr: draft.nameAr,
        sets: draft.sets,
        targetRepMin: draft.targetRepMin,
        targetRepMax: draft.targetRepMax,
        targetRir: draft.targetRir,
        weightUnit: draft.weightUnit,
        notes: draft.notes,
      }],
    }));
  }

  // Reorder persistence mocked the same way the real endpoint responds.
  function applyPlacements(placements: Placement[]) {
    setRoutine((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => {
        const index = placements.findIndex((p) => p.exerciseId === exercise.id);
        return index === -1 ? exercise : { ...exercise, position: index + 1, sectionId: placements[index].sectionId };
      }),
    }));
  }
  function reorderSections(orderedIds: number[]) {
    setRoutine((current) => ({
      ...current,
      sections: orderedIds.map((id, index) => {
        const section = current.sections.find((s) => s.id === id);
        return section ? { ...section, position: index + 1 } : section;
      }).filter((s): s is Section => Boolean(s)),
    }));
  }

  return (
    <main dir={rtl ? "rtl" : "ltr"} className={`progress-page ${rtl ? "rtl-site" : ""}`} style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="progress-content">
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div className="progress-lang" style={{ display: "flex", gap: 4, border: "1px solid #10120e", padding: 4 }}>
            {progressLocales.map((locale) => (
              <button key={locale.code} type="button" onClick={() => setLang(locale.code)} style={lang === locale.code ? { fontWeight: 800, background: "#10120e", color: "#dfffb0" } : { background: "transparent" }}>{locale.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => setFailNext((value) => !value)} style={{ border: "1px solid #10120e", padding: "8px 12px", fontSize: 11, background: failNext ? "#ffe0dc" : "#fff" }} data-testid="fail-toggle">
            fail next add: {failNext ? "ON" : "off"}
          </button>
          <button type="button" className="progress-ghost primary" aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}>{dict.addExercise}<span>+</span></button>
          <span data-testid="post-count" style={{ fontSize: 11 }}>POSTs: {postCount}</span>
        </div>

        {addOpen && (
          <AddExercisePanel
            t={dict}
            lang={lang}
            sections={routine.sections}
            defaultSectionId={routine.sections.length > 0 ? routine.sections[0].id : null}
            onAdd={addDraft}
            onClose={() => setAddOpen(false)}
          />
        )}

        <RoutineSortable
          routine={routine}
          t={dict}
          busy={false}
          onApplyPlacements={applyPlacements}
          onReorderSections={reorderSections}
          onPatchExercise={() => undefined}
          onPersistExercise={() => undefined}
          onRemoveExercise={() => undefined}
          onRenameSection={() => undefined}
          onDeleteSection={() => undefined}
        />
      </div>
    </main>
  );
}
