"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ProgressText } from "../../progress-text";

export type PublicExercise = { id: number; position: number; sectionId: number | null; exerciseId: string; name: string; nameFr: string; nameAr: string; sets: number; targetRepMin: number; targetRepMax: number; targetRir: number; weightUnit: string; notes: string };
export type Section = { id: number; name: string; position: number };
export type Routine = { id: number; name: string; notes: string; createdAt: string; updatedAt: string; sections: Section[]; exercises: PublicExercise[] };
export type Placement = { exerciseId: number; sectionId: number | null };

/** The subset of dictionary keys this surface renders. */
export type RoutineSortableText = Pick<
  ProgressText,
  | "exercises" | "ungrouped" | "move" | "moveUp" | "moveDown" | "moveToSection"
  | "remove" | "workingSets" | "repRange" | "targetRir" | "rename"
  | "deleteSection" | "deleteSectionBody" | "cancel" | "noExercises" | "noExercisesHint" | "sectionName"
>;

export type RoutineSortableProps = {
  routine: Routine;
  t: RoutineSortableText;
  busy: boolean;
  onApplyPlacements: (placements: Placement[]) => void | Promise<void>;
  onReorderSections: (orderedIds: number[]) => void | Promise<void>;
  onPatchExercise: (exercise: PublicExercise, patch: Partial<PublicExercise>) => void;
  onPersistExercise: (exercise: PublicExercise) => void | Promise<void>;
  onRemoveExercise: (exercise: PublicExercise) => void | Promise<void>;
  onRenameSection: (section: Section, name: string) => void | Promise<void>;
  onDeleteSection: (section: Section) => void | Promise<void>;
};

// --- Shared layout model ---------------------------------------------------
// The routine keeps one dense (routine-global) exercise position sequence; a
// section is a pure grouping layer over it. Canonical order: section blocks
// by section.position, then each member by position, then ungrouped.

/** Sections in header (position) order. */
export function orderedSections(routine: Routine): Section[] {
  return [...routine.sections].sort((a, b) => a.position - b.position);
}

/** Rank of a section (0..n-1); the ungrouped block always ranks last (n). */
function sectionRank(sections: Section[], sectionId: number | null): number {
  if (sectionId === null) return sections.length;
  const index = [...sections].sort((a, b) => a.position - b.position).findIndex((section) => section.id === sectionId);
  return index === -1 ? sections.length : index;
}

/** Canonical flat exercise order: section blocks by section order, then ungrouped. */
export function canonicalExercises(routine: Routine): PublicExercise[] {
  return [...routine.exercises].sort((a, b) =>
    sectionRank(routine.sections, a.sectionId) - sectionRank(routine.sections, b.sectionId) || a.position - b.position);
}

export function membersOf(routine: Routine, sectionId: number | null): PublicExercise[] {
  return canonicalExercises(routine).filter((exercise) => (exercise.sectionId ?? null) === sectionId);
}

/**
 * New placements after moving `draggedId`. `targetSection`:
 *  - "same" keeps membership (pure reorder),
 *  - a section id (or null) moves the exercise into that section/ungrouped at
 *    the end of the block (section/ungrouped header drops, Move-to-section),
 * plus `insertAt`: canonical index (of the full list) after which ordering
 * applies for within-list drops. When `insertAt` is used with a real section
 * target, the dragged exercise takes that section's id: dropping next to an
 * exercise of another section is a membership move, never a same-section
 * reorder. Returns the full final placements payload.
 */
export function planMove(
  routine: Routine,
  draggedId: number,
  targetSection: number | "same" | null,
  insertAt: number | null,
): Placement[] {
  const full = canonicalExercises(routine);
  const dragged = full.find((exercise) => exercise.id === draggedId);
  if (!dragged) return [];
  const rest = full.filter((exercise) => exercise.id !== draggedId);
  let finalIds: number[] = [];
  if (insertAt === null) {
    const groups: number[][] = orderedSections(routine).map(() => []);
    groups.push([]); // ungrouped tail block
    for (const exercise of rest) groups[sectionRank(routine.sections, exercise.sectionId)].push(exercise.id);
    const target = targetSection === "same" ? dragged.sectionId : targetSection;
    groups[sectionRank(routine.sections, target)].push(dragged.id);
    finalIds = groups.flat();
  } else {
    const restIds = rest.map((exercise) => exercise.id);
    const originalIndex = full.findIndex((exercise) => exercise.id === draggedId);
    let index = insertAt;
    if (originalIndex !== -1 && originalIndex < index) index -= 1;
    finalIds = [...restIds.slice(0, index), dragged.id, ...restIds.slice(index)];
  }
  const placementSection = targetSection === "same"
    ? dragged.sectionId
    : targetSection;
  return finalIds.map((id) => ({ exerciseId: id, sectionId: id === draggedId ? placementSection : (full.find((exercise) => exercise.id === id)?.sectionId ?? null) }));
}

// --- Drag metadata (stable object identities for dnd-kit data) -------------
const exerciseDragData = { kind: "exercise" };
const cardDropData = { zone: "card" };
const ungroupedDropData = { zone: "ungrouped" };

type OverTarget = { id: string; zone: "card" | "head" | "ungrouped"; sectionId: number | null; before: boolean; top: number; height: number } | null;

/** Insert a dragged item before/after the target, using the same rest-insert
 *  math as planMove so sections and exercises share one order engine. */
function planSectionOrder(sections: Section[], draggedId: number, targetId: number, before: boolean): number[] | null {
  const rest = sections.filter((section) => section.id !== draggedId);
  const targetRestIndex = rest.findIndex((section) => section.id === targetId);
  if (targetRestIndex === -1) return null;
  const insertAt = before ? targetRestIndex : targetRestIndex + 1;
  const dragged = sections.find((section) => section.id === draggedId);
  if (!dragged) return null;
  const next: Section[] = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
  return next.map((section) => section.id);
}

// --- Exercise card: draggable via handle, droppable as a drop target -------
function ExerciseCard({
  e, index, groupLength, sections, overTarget, t, busy,
  onMove, onMoveToSection, onRemove, onPatch, onPersist,
}: {
  e: PublicExercise; index: number; groupLength: number; sections: Section[];
  overTarget: OverTarget; t: RoutineSortableText; busy: boolean;
  onMove: (e: PublicExercise, direction: -1 | 1) => void;
  onMoveToSection: (e: PublicExercise, sectionId: number | null) => void;
  onRemove: (e: PublicExercise) => void;
  onPatch: (e: PublicExercise, patch: Partial<PublicExercise>) => void;
  onPersist: (e: PublicExercise) => void;
}) {
  // The node is the whole card (so the card lifts), but only the handle
  // receives listeners: sets/rep/RIR/selects and buttons stay clickable.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `ex:${e.id}`, data: exerciseDragData, disabled: busy });
  const { setNodeRef: setDropNodeRef } = useDroppable({ id: `ex:${e.id}`, data: cardDropData });
  const targeted = overTarget?.zone === "card" && overTarget.id === `ex:${e.id}`;
  const className = [
    "progress-exercise-card",
    targeted ? "dragover" : "",
    targeted ? (overTarget.before ? "drop-before" : "drop-after") : "",
    isDragging ? "progress-dragging" : "",
  ].filter(Boolean).join(" ");
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition: isDragging ? "none" : "transform 160ms ease" }
    : undefined;

  return (
    <div
      ref={(node) => { setNodeRef(node); setDropNodeRef(node); }}
      className={className}
      style={style}
    >
      <div className="progress-exercise-order">{String(index + 1).padStart(2, "0")}</div>
      <div className="progress-exercise-main">
        <div className="progress-exercise-title">
          <span
            className={`progress-drag-handle${isDragging ? " progress-grabbing" : ""}`}
            {...attributes}
            {...listeners}
            role="button"
            tabIndex={0}
            title={t.move}
            aria-label={`${t.move} ${e.name}`}
            onKeyDown={(ev) => {
              if (ev.key === "ArrowUp") { ev.preventDefault(); onMove(e, -1); }
              else if (ev.key === "ArrowDown") { ev.preventDefault(); onMove(e, 1); }
            }}
          >⠿</span>
          <strong>{e.name}</strong>
          <span className="progress-exercise-prescription">{e.sets}×{e.targetRepMin === e.targetRepMax ? e.targetRepMax : `${e.targetRepMin}–${e.targetRepMax}`} · RIR {e.targetRir} · {e.weightUnit}</span>
        </div>
        <div className="progress-exercise-edit">
          <label>{t.workingSets}<select value={e.sets} onChange={(ev) => onPatch(e, { sets: Number(ev.target.value) })} onBlur={() => onPersist(e)}>{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{t.repRange}<span className="progress-rep-range"><input type="number" min={1} max={40} value={e.targetRepMin} onChange={(ev) => onPatch(e, { targetRepMin: Number(ev.target.value) })} onBlur={() => onPersist(e)} /><i>–</i><input type="number" min={1} max={40} value={e.targetRepMax} onChange={(ev) => onPatch(e, { targetRepMax: Number(ev.target.value) })} onBlur={() => onPersist(e)} /></span></label>
          <label>{t.targetRir}<select value={e.targetRir} onChange={(ev) => onPatch(e, { targetRir: Number(ev.target.value) })} onBlur={() => onPersist(e)}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
      </div>
      <div className="progress-exercise-actions">
        <button type="button" aria-label={t.moveUp} disabled={index === 0} onClick={() => onMove(e, -1)}>↑</button>
        <button type="button" aria-label={t.moveDown} disabled={index === groupLength - 1} onClick={() => onMove(e, 1)}>↓</button>
        <label className="progress-move-to-section">{t.moveToSection}<select value={e.sectionId === null ? "" : String(e.sectionId)} disabled={busy} onChange={(ev) => onMoveToSection(e, ev.target.value === "" ? null : Number(ev.target.value))}>
          <option value="">{t.ungrouped}</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select></label>
        <button type="button" className="progress-remove" disabled={busy} onClick={() => onRemove(e)}>{t.remove}</button>
      </div>
    </div>
  );
}

// --- Section header: sortable node, droppable for exercises ----------------
function SectionHead({
  section, count, index, total, overTarget, t, busy,
  renamingSectionId, sectionRename, confirmDeleteSection,
  onStartRename, onRenameChange, onRenameSave, onRequestDelete, onCancelDelete, onDeleteConfirm,
  onMove,
}: {
  section: Section; count: number; index: number; total: number;
  overTarget: OverTarget; t: RoutineSortableText; busy: boolean;
  renamingSectionId: number | null; sectionRename: string; confirmDeleteSection: number | null;
  onStartRename: (section: Section) => void; onRenameChange: (value: string) => void;
  onRenameSave: (section: Section) => void; onRequestDelete: (section: Section) => void;
  onCancelDelete: () => void; onDeleteConfirm: (section: Section) => void;
  onMove: (section: Section, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: `sec:${section.id}`,
    data: { zone: "head", sectionId: section.id },
    disabled: busy || total < 2,
  });
  const targeted = overTarget?.zone === "head" && overTarget.id === `sec:${section.id}`;
  const className = [
    "progress-section-head",
    targeted ? "dragover" : "",
    isDragging ? "progress-dragging" : "",
  ].filter(Boolean).join(" ");
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition: isDragging ? "none" : "transform 160ms ease" }
    : undefined;

  if (confirmDeleteSection === section.id) {
    return (
      <div className="progress-section-confirm">
        <strong>{t.deleteSection}</strong>
        <span>{t.deleteSectionBody}</span>
        <div className="progress-section-actions">
          <button className="progress-ghost" type="button" disabled={busy} onClick={onCancelDelete}>{t.cancel}</button>
          <button className="progress-ghost danger" type="button" disabled={busy} onClick={() => onDeleteConfirm(section)}>{t.deleteSection}</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={className} style={style}>
      <span
        className={`progress-section-grip${isDragging ? " progress-grabbing" : ""}`}
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        title={t.move}
        aria-label={`${t.move} ${section.name}`}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowUp") { ev.preventDefault(); onMove(section, -1); }
          else if (ev.key === "ArrowDown") { ev.preventDefault(); onMove(section, 1); }
        }}
      >⠿</span>
      {renamingSectionId === section.id ? (
        <form className="progress-section-rename" onSubmit={(event) => { event.preventDefault(); onRenameSave(section); }}>
          <input value={sectionRename} maxLength={80} autoFocus onChange={(event) => onRenameChange(event.target.value)} onBlur={() => onRenameSave(section)} aria-label={t.sectionName} />
        </form>
      ) : (
        <strong>{section.name}</strong>
      )}
      <small>{count}</small>
      <span className="progress-section-actions">
        {renamingSectionId !== section.id && <button className="progress-ghost" type="button" onClick={() => onStartRename(section)}>{t.rename}</button>}
        <button className="progress-ghost" type="button" aria-label={`${t.move} ↑`} disabled={index === 0} onClick={() => onMove(section, -1)}>↑</button>
        <button className="progress-ghost" type="button" aria-label={`${t.move} ↓`} disabled={index === total - 1} onClick={() => onMove(section, 1)}>↓</button>
        <button className="progress-ghost danger" type="button" onClick={() => onRequestDelete(section)}>{t.deleteSection}</button>
      </span>
    </div>
  );
}

// --- Ungrouped tail header: droppable only ---------------------------------
function UngroupedHead({ count, overTarget, t }: { count: number; overTarget: OverTarget; t: RoutineSortableText }) {
  const { setNodeRef } = useDroppable({ id: "ungrouped", data: ungroupedDropData });
  const targeted = overTarget?.zone === "ungrouped";
  return (
    <div ref={setNodeRef} className={`progress-section-head progress-ungrouped-head${targeted ? " dragover" : ""}`}>
      <span className="progress-section-grip" aria-hidden="true" />
      <strong>{t.ungrouped}</strong>
      <small>{count}</small>
    </div>
  );
}

// --- Sortable surface -------------------------------------------------------
export default function RoutineSortable(props: RoutineSortableProps) {
  const { routine, t, busy, onApplyPlacements, onReorderSections, onPatchExercise, onPersistExercise, onRemoveExercise, onRenameSection, onDeleteSection } = props;
  const [overTarget, setOverTarget] = useState<OverTarget>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<number | null>(null);
  const [sectionRename, setSectionRename] = useState("");
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<number | null>(null);
  // Live pointer position during a drag. DndContext does not expose pointer
  // coordinates, so the wrapper records every pointermove into a ref; the
  // insertion half (before/after) is recomputed from it on each drag move.
  const pointerRef = useRef({ x: 0, y: 0 });

  const sections = useMemo(() => orderedSections(routine), [routine]);
  const totalExercises = routine.exercises.length;
  const ungroupedMembers = useMemo(() => membersOf(routine, null), [routine]);

  // Pointer drag with a small activation distance: clicks on the handle never
  // start an accidental drag, but a deliberate 8px+ pointer move does.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Collision strategy: prefer the droppable under the POINTER (the whole
  // dragged card can span several rows/sections and area-based intersection
  // then mis-targets), and only fall back to area intersection when the
  // pointer sits in a gap between rows.
  const collisionDetection: CollisionDetection = (args) => {
    const pointed = pointerWithin(args);
    return pointed.length > 0 ? pointed : rectIntersection(args);
  };

  // --- Placement operations (single engine shared with the arrows/selects) --
  function moveExerciseInGroup(e: PublicExercise, direction: -1 | 1) {
    const full = canonicalExercises(routine);
    const index = full.findIndex((item) => item.id === e.id);
    const target = full[index + direction];
    if (!target || (target.sectionId ?? null) !== (e.sectionId ?? null)) return;
    void onApplyPlacements(planMove(routine, e.id, "same", direction === 1 ? index + 2 : index));
  }
  function moveExerciseToSection(e: PublicExercise, sectionId: number | null) {
    if ((e.sectionId ?? null) === sectionId) return;
    void onApplyPlacements(planMove(routine, e.id, sectionId, null));
  }
  /** Drop next to a specific exercise card. When that card belongs to another
   *  section, the drop is a membership move (the dragged exercise takes the
   *  target section), never a same-section reorder. */
  function dropOnExercise(draggedId: number, targetExerciseId: number, before: boolean) {
    const full = canonicalExercises(routine);
    const targetIndex = full.findIndex((exercise) => exercise.id === targetExerciseId);
    const dragged = full.find((exercise) => exercise.id === draggedId);
    if (!dragged || targetIndex === -1 || draggedId === targetExerciseId) return;
    const targetSection = full[targetIndex].sectionId ?? null;
    const sameSection = (dragged.sectionId ?? null) === targetSection;
    void onApplyPlacements(planMove(routine, draggedId, sameSection ? "same" : targetSection, before ? targetIndex : targetIndex + 1));
  }
  function dropIntoSection(draggedId: number, sectionId: number | null) {
    void onApplyPlacements(planMove(routine, draggedId, sectionId, null));
  }

  // --- Section order (arrows + drag share onReorderSections) ----------------
  function moveSection(section: Section, direction: -1 | 1) {
    const index = sections.findIndex((item) => item.id === section.id);
    const target = sections[index + direction];
    if (!target) return;
    const reordered = [...sections];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    void onReorderSections(reordered.map((item) => item.id));
  }
  function dropSectionOn(draggedId: number, targetSectionId: number, before: boolean) {
    const ids = planSectionOrder(sections, draggedId, targetSectionId, before);
    if (!ids) return;
    void onReorderSections(ids);
  }

  // --- dnd-kit lifecycle ----------------------------------------------------
  function handleDragStart() {
    setOverTarget(null);
  }
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) { setOverTarget(null); return; }
    const activeKind = String(active.id).startsWith("sec:") ? "section" : "exercise";
    const overId = String(over.id);
    if (overId === String(active.id)) { setOverTarget(null); return; }
    const overData = (over.data.current ?? {}) as { zone?: string; sectionId?: number };
    // onDragOver fires only when the hovered target CHANGES, so before/after is
    // seeded here and kept fresh by handleDragMove using the live pointer.
    const top = over.rect?.top ?? 0;
    const height = over.rect?.height ?? 0;
    const before = height > 0 && pointerRef.current.y < top + height / 2;
    if (activeKind === "section") {
      if (overData.zone !== "head") { setOverTarget(null); return; }
      setOverTarget({ id: overId, zone: "head", sectionId: overData.sectionId ?? null, before, top, height });
    } else if (overData.zone === "card") {
      setOverTarget({ id: overId, zone: "card", sectionId: null, before, top, height });
    } else if (overData.zone === "head") {
      setOverTarget({ id: overId, zone: "head", sectionId: overData.sectionId ?? null, before: false, top, height });
    } else if (overData.zone === "ungrouped") {
      setOverTarget({ id: overId, zone: "ungrouped", sectionId: null, before: false, top, height });
    } else {
      setOverTarget(null);
    }
  }
  function handleDragMove() {
    // Pointer moves dozens of times per second while the target stays the same;
    // recompute the insertion half so the indicator tracks the cursor.
    setOverTarget((current) => {
      if (!current || current.height <= 0) return current;
      const before = pointerRef.current.y < current.top + current.height / 2;
      return before === current.before ? current : { ...current, before };
    });
  }
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = overTarget;
    setOverTarget(null);
    if (!over || !target || String(over.id) !== target.id) return; // dropped off any target: keep the confirmed layout
    const activeKind = String(active.id).startsWith("sec:") ? "section" : "exercise";
    const activeIdNum = Number(String(active.id).split(":")[1]);
    if (Number.isNaN(activeIdNum)) return;
    if (target.zone === "card" && activeKind === "exercise") {
      dropOnExercise(activeIdNum, Number(target.id.split(":")[1]), target.before);
    } else if (target.zone === "head") {
      if (activeKind === "exercise") dropIntoSection(activeIdNum, target.sectionId);
      else if (target.sectionId !== null) dropSectionOn(activeIdNum, target.sectionId, target.before);
    } else if (target.zone === "ungrouped" && activeKind === "exercise") {
      dropIntoSection(activeIdNum, null);
    }
  }
  function handleDragCancel() {
    setOverTarget(null);
  }

  return (
    <div className="progress-exercise-list" onPointerMove={(event) => { pointerRef.current = { x: event.clientX, y: event.clientY }; }}>
      {totalExercises > 0 && <p>{t.exercises} · {totalExercises}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={sections.map((section) => `sec:${section.id}`)} strategy={verticalListSortingStrategy}>
          {sections.map((section, index) => {
            const group = membersOf(routine, section.id);
            return (
              <div className="progress-section" key={section.id}>
                <SectionHead
                  section={section}
                  count={group.length}
                  index={index}
                  total={sections.length}
                  overTarget={overTarget}
                  t={t}
                  busy={busy}
                  renamingSectionId={renamingSectionId}
                  sectionRename={sectionRename}
                  confirmDeleteSection={confirmDeleteSection}
                  onStartRename={(item) => { setRenamingSectionId(item.id); setSectionRename(item.name); }}
                  onRenameChange={setSectionRename}
                  onRenameSave={(item) => {
                    if (!sectionRename.trim()) { setRenamingSectionId(null); return; }
                    setRenamingSectionId(null);
                    void onRenameSection(item, sectionRename.trim());
                  }}
                  onRequestDelete={(item) => setConfirmDeleteSection(item.id)}
                  onCancelDelete={() => setConfirmDeleteSection(null)}
                  onDeleteConfirm={(item) => { setConfirmDeleteSection(null); void onDeleteSection(item); }}
                  onMove={moveSection}
                />
                {group.map((e, i) => (
                  <ExerciseCard
                    key={e.id}
                    e={e}
                    index={i}
                    groupLength={group.length}
                    sections={sections}
                    overTarget={overTarget}
                    t={t}
                    busy={busy}
                    onMove={moveExerciseInGroup}
                    onMoveToSection={moveExerciseToSection}
                    onRemove={onRemoveExercise}
                    onPatch={onPatchExercise}
                    onPersist={onPersistExercise}
                  />
                ))}
              </div>
            );
          })}
        </SortableContext>
        {(sections.length > 0 ? ungroupedMembers.length > 0 : totalExercises > 0) && (
          <div className="progress-section">
            {sections.length > 0 && <UngroupedHead count={ungroupedMembers.length} overTarget={overTarget} t={t} />}
            {ungroupedMembers.map((e, i) => (
              <ExerciseCard
                key={e.id}
                e={e}
                index={i}
                groupLength={ungroupedMembers.length}
                sections={sections}
                overTarget={overTarget}
                t={t}
                busy={busy}
                onMove={moveExerciseInGroup}
                onMoveToSection={moveExerciseToSection}
                onRemove={onRemoveExercise}
                onPatch={onPatchExercise}
                onPersist={onPersistExercise}
              />
            ))}
          </div>
        )}
        {totalExercises === 0 && <div className="progress-empty"><strong>{t.noExercises}</strong><span>{t.noExercisesHint}</span></div>}
      </DndContext>
    </div>
  );
}