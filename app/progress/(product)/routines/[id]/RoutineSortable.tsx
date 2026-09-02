"use client";

import { useMemo, useState } from "react";
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

import {
  orderedSections,
  canonicalExercises,
  membersOf,
  planMove,
  planSectionOrder,
  type PublicExercise,
  type Section,
  type Routine,
  type Placement,
} from "./routineLayout";

// Re-export the layout engine so existing consumers (RoutineDetail, the dev
// harness) keep compiling against this module.
export { orderedSections, canonicalExercises, membersOf, planMove } from "./routineLayout";
export type { PublicExercise, Section, Routine, Placement } from "./routineLayout";

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

// --- Drag metadata (stable object identities for dnd-kit data) -------------
const exerciseDragData = { kind: "exercise" };
const cardDropData = { zone: "card" };
const ungroupedDropData = { zone: "ungrouped" };

// Visual-feedback state ONLY. The persisted order is derived exclusively from
// the DragEndEvent (active/over ids + canonical indexes), never from this
// async React state: a user can release the pointer before the latest state
// commit lands, and that must not swallow a valid drop.
type OverTarget = { id: string; zone: "card" | "head" | "ungrouped"; before: boolean; top: number; height: number } | null;

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
  const sections = useMemo(() => orderedSections(routine), [routine]);
  const totalExercises = routine.exercises.length;
  const ungroupedMembers = useMemo(() => membersOf(routine, null), [routine]);

  // Pointer drag with a small activation distance: clicks on the handle never
  // start an accidental drag, but a deliberate 8px+ pointer move does.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Collision strategy: 1) the actively dragged item is excluded from the
  // candidate set - it follows the pointer via its transform, so its own
  // (translated) droppable rect contains the pointer at every moment and
  // would otherwise shadow the real destination; 2) among the remaining
  // droppables prefer the one under the POINTER (the whole dragged card can
  // span several rows and area-based intersection then mis-targets); 3) only
  // fall back to area intersection when the pointer sits in a gap between
  // rows.
  const collisionDetection: CollisionDetection = (args) => {
    const candidates = args.droppableContainers.filter((container) => container.id !== args.active.id);
    const pointed = pointerWithin({ ...args, droppableContainers: candidates });
    return pointed.length > 0 ? pointed : rectIntersection({ ...args, droppableContainers: candidates });
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
  /** Drop next to a specific exercise card. Placement is DETERMINISTIC - the
   *  pointer's release coordinates play no part, so a fast release can never
   *  resolve as "same order" and silently no-op:
   *   - same-section drops: direction comes from the canonical indexes (dragged
   *     BELOW the target => lands BEFORE it; ABOVE => lands AFTER it), and
   *   - cross-section card drops: inserted immediately BEFORE the target card
   *     and take its section (membership move, never a same-section reorder). */
  function dropOnExercise(draggedId: number, targetExerciseId: number) {
    const full = canonicalExercises(routine);
    const targetIndex = full.findIndex((exercise) => exercise.id === targetExerciseId);
    const draggedIndex = full.findIndex((exercise) => exercise.id === draggedId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedId === targetExerciseId) return;
    const dragged = full[draggedIndex];
    const targetSection = full[targetIndex].sectionId ?? null;
    const sameSection = (dragged.sectionId ?? null) === targetSection;
    const before = sameSection ? draggedIndex > targetIndex : true;
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
  /** Section drops are also index-deterministic: dragged below the target =>
   *  lands before it, above => lands after it. No pointer/release state. */
  function dropSectionOn(draggedId: number, targetSectionId: number) {
    const draggedIndex = sections.findIndex((section) => section.id === draggedId);
    const targetIndex = sections.findIndex((section) => section.id === targetSectionId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const before = draggedIndex > targetIndex;
    const ids = planSectionOrder(sections, draggedId, targetSectionId, before);
    if (!ids) return;
    void onReorderSections(ids);
  }

  // --- dnd-kit lifecycle ----------------------------------------------------
  function handleDragStart() {
    setOverTarget(null);
  }
  /** Visual only: records which droppable is hovered and which insertion half.
   *  The half uses the SAME deterministic rule the commit uses (canonical
   *  indexes for card targets), so the indicator never lies about where the
   *  drop will land - but this state is never read at drag end: a fast release
   *  cannot be swallowed by a stale commit. */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || String(over.id) === String(active.id)) { setOverTarget(null); return; }
    const overData = (over.data.current ?? {}) as { zone?: "card" | "head" | "ungrouped" };
    if (overData.zone !== "card" && overData.zone !== "head" && overData.zone !== "ungrouped") { setOverTarget(null); return; }
    const overId = String(over.id);
    const activeId = String(active.id);
    if (overData.zone === "card") {
      // Sections dragged over cards show no card highlight: their drop targets
      // are the section heads. Exercises use the index-deterministic half.
      if (activeId.startsWith("sec:")) { setOverTarget(null); return; }
      const full = canonicalExercises(routine);
      const activeIndex = full.findIndex((exercise) => exercise.id === Number(activeId.split(":")[1]));
      const overIndex = full.findIndex((exercise) => exercise.id === Number(overId.split(":")[1]));
      const sameSection = activeIndex !== -1 && overIndex !== -1 && (full[activeIndex].sectionId ?? null) === (full[overIndex].sectionId ?? null);
      setOverTarget({ id: overId, zone: "card", before: sameSection ? activeIndex > overIndex : true, top: over.rect?.top ?? 0, height: over.rect?.height ?? 0 });
      return;
    }
    if (overData.zone === "head" && overId.startsWith("sec:") && activeId.startsWith("sec:")) {
      const sectionsOrdered = orderedSections(routine);
      const activeIndex = sectionsOrdered.findIndex((section) => section.id === Number(activeId.split(":")[1]));
      const overIndex = sectionsOrdered.findIndex((section) => section.id === Number(overId.split(":")[1]));
      setOverTarget({ id: overId, zone: "head", before: activeIndex > overIndex, top: over.rect?.top ?? 0, height: over.rect?.height ?? 0 });
      return;
    }
    setOverTarget({ id: overId, zone: overData.zone, before: false, top: over.rect?.top ?? 0, height: over.rect?.height ?? 0 });
  }
  /** EVENT-AUTHORITATIVE drop resolution: the persisted operation is derived
   *  exclusively from event.over (its id and zone metadata) plus the canonical
   *  indexes of the current server-confirmed layout. No pointer coordinates,
   *  no async React state: only a genuinely absent over - or a drop onto the
   *  dragged item itself - means "no op". */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setOverTarget(null);
    if (!over) return; // dropped outside any droppable: keep the confirmed layout
    const overId = String(over.id);
    if (overId === String(active.id)) return; // dropped onto itself
    const activeKind = String(active.id).startsWith("sec:") ? "section" : "exercise";
    const activeIdNum = Number(String(active.id).split(":")[1]);
    if (Number.isNaN(activeIdNum)) return;
    const overData = (over.data.current ?? {}) as { zone?: "card" | "head" | "ungrouped"; sectionId?: number };
    if (overData.zone === "card" && activeKind === "exercise") {
      dropOnExercise(activeIdNum, Number(overId.split(":")[1]));
    } else if (overData.zone === "head") {
      if (activeKind === "exercise") dropIntoSection(activeIdNum, overData.sectionId ?? null);
      else if (overData.sectionId != null) dropSectionOn(activeIdNum, overData.sectionId);
    } else if (overData.zone === "ungrouped" && activeKind === "exercise") {
      dropIntoSection(activeIdNum, null);
    }
  }
  function handleDragCancel() {
    setOverTarget(null);
  }

  return (
    <div className="progress-exercise-list">
      {totalExercises > 0 && <p>{t.exercises} · {totalExercises}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
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