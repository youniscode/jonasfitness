"use client";

// Dev-only Playwright harness for the routine sortable surface. It mounts the
// exact RoutineSortable component used on /progress/routines/[id] with fixture
// data and no backend, so a real browser can exercise pointer drag-and-drop
// without any Clerk session or production database. Never rendered in
// production builds (NODE_ENV is inlined by Next.js).
import { useState } from "react";
import RoutineSortable, { type Placement, type Routine, type RoutineSortableText, type Section } from "../../progress/(product)/routines/[id]/RoutineSortable";
import "../../progress/progress.css";

const EN: RoutineSortableText = {
  exercises: "EXERCISES",
  ungrouped: "Ungrouped",
  move: "Move",
  moveUp: "Move up",
  moveDown: "Move down",
  moveToSection: "Move to section",
  remove: "Remove",
  workingSets: "SETS",
  repRange: "REP RANGE",
  targetRir: "RIR TARGET",
  rename: "Rename",
  deleteSection: "Delete section",
  deleteSectionBody: "Exercises stay in this routine and become ungrouped.",
  cancel: "Cancel",
  noExercises: "No exercises yet.",
  noExercisesHint: "Add your first exercise to build this routine.",
  sectionName: "Section name",
};

function fixture(): Routine {
  const sections: Section[] = [
    { id: 1, name: "BACK", position: 1 },
    { id: 2, name: "TRICEPS", position: 2 },
  ];
  const base = { sets: 3, targetRepMin: 10, targetRepMax: 12, targetRir: 2, weightUnit: "kg" as const, notes: "" };
  return {
    id: 2,
    name: "Drag fixture",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sections,
    exercises: [
      { id: 4, position: 1, sectionId: 1, exerciseId: "straight-arm-pulldown", name: "Straight-arm pulldown", nameFr: "", nameAr: "", ...base },
      { id: 5, position: 2, sectionId: 1, exerciseId: "seated-cable-row", name: "Seated cable row", nameFr: "", nameAr: "", ...base },
      { id: 6, position: 3, sectionId: 2, exerciseId: "overhead-triceps-extension", name: "Overhead triceps extension", nameFr: "", nameAr: "", ...base },
      { id: 7, position: 4, sectionId: 2, exerciseId: "triceps-pressdown", name: "Triceps pressdown", nameFr: "", nameAr: "", ...base },
      { id: 8, position: 5, sectionId: null, exerciseId: "farmers-walk", name: "Farmers walk", nameFr: "", nameAr: "", ...base },
    ],
  };
}

export default function RoutineSortableHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [routine, setRoutine] = useState<Routine>(fixture);
  const [lastPlacements, setLastPlacements] = useState("");
  const [placementCount, setPlacementCount] = useState(0);
  const [lastSectionOrder, setLastSectionOrder] = useState("");
  const [sectionCount, setSectionCount] = useState(0);

  // Mock server: applies a placements payload exactly like the real reorder
  // endpoint (dense positions + authoritative section membership) and returns
  // the confirmed layout, which re-renders the list. Counters prove exactly
  // one persistence call per drop.
  function applyPlacements(placements: Placement[]) {
    setRoutine((current) => ({
      ...current,
      exercises: current.exercises.map((e) => {
        const index = placements.findIndex((p) => p.exerciseId === e.id);
        return index === -1 ? e : { ...e, position: index + 1, sectionId: placements[index].sectionId };
      }),
    }));
    setLastPlacements(JSON.stringify(placements));
    setPlacementCount((count) => count + 1);
  }
  function reorderSections(orderedIds: number[]) {
    setRoutine((current) => ({
      ...current,
      sections: orderedIds.map((id, index) => {
        const section = current.sections.find((s) => s.id === id);
        return section ? { ...section, position: index + 1 } : section;
      }).filter((s): s is Section => Boolean(s)),
    }));
    setLastSectionOrder(JSON.stringify(orderedIds));
    setSectionCount((count) => count + 1);
  }

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ fontSize: 12, color: "#666" }}>Fixture: BACK (4, 5) · TRICEPS (6, 7) · ungrouped (8). Drag via the ⠿ handles.</p>
      <RoutineSortable
        routine={routine}
        t={EN}
        busy={false}
        onApplyPlacements={applyPlacements}
        onReorderSections={reorderSections}
        onPatchExercise={() => undefined}
        onPersistExercise={() => undefined}
        onRemoveExercise={() => undefined}
        onRenameSection={() => undefined}
        onDeleteSection={() => undefined}
      />
      <h3 data-testid="payload-heading" style={{ marginTop: 28, fontSize: 12 }}>Last placements</h3>
      <pre data-testid="last-placements" style={{ fontSize: 10, background: "#f4f4ef", padding: 8 }}>{lastPlacements || "(none yet)"}</pre>
      <p data-testid="placement-count" style={{ fontSize: 10 }}>placement calls: {placementCount}</p>
      <h3 style={{ marginTop: 12, fontSize: 12 }}>Last section order</h3>
      <pre data-testid="last-section-order" style={{ fontSize: 10, background: "#f4f4ef", padding: 8 }}>{lastSectionOrder || "(none yet)"}</pre>
      <p data-testid="section-count" style={{ fontSize: 10 }}>section calls: {sectionCount}</p>
    </main>
  );
}