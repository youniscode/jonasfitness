"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { isPositiveInt } from "../lib/query-params";
import { NUTRITION_EN_LABELS } from "../lib/onboarding-profile";
import { type NutritionGoalClass } from "../lib/nutrition-engine";
import {
  compareNutritionCalorieEstimate,
  targetValuesFromGuidance,
  type PublicNutritionTarget,
  type NutritionTargetValues,
} from "../lib/nutrition-targets";

type Client = { id: number; name: string };

type MacroRange = { minGrams: number; maxGrams: number };
type CalorieRange = { minKcal: number; maxKcal: number };
type Guidance = {
  estimatedBmrKcal: number;
  activityFactor: number;
  activityBand: string;
  estimatedTdeeKcal: number;
  goal: NutritionGoalClass;
  calorieRange: CalorieRange;
  protein: MacroRange;
  fat: MacroRange;
  carbohydrates: MacroRange;
  assumptions: string[];
  warnings: string[];
};

type InputSummary = {
  ageYears: number | null;
  sex: string;
  heightCm: number | null;
  currentWeightKg: number | null;
  weightSource: string | null;
  activity: string;
  steps: string;
  work: string;
  goal: string;
  targetWeightKg: number | null;
};

type Payload =
  | { status: "blocked"; reasons: string[]; inputSummary: InputSummary }
  | { status: "insufficient_data"; missing: string[]; inputSummary: InputSummary }
  | { status: "ready"; guidance: Guidance; inputSummary: InputSummary };

type TargetData = { current: PublicNutritionTarget | null; history: PublicNutritionTarget[] };

// Deterministic coach-facing labels for the engine's missing-input codes.
const MISSING_LABELS: Record<string, string> = {
  invalid_age: "Age",
  invalid_sex: "Sex",
  insufficient_sex: "Sex",
  invalid_height: "Height",
  invalid_weight: "Current weight",
  invalid_activity: "Activity level",
  unsupported_goal: "Supported goal",
};

const WEIGHT_SOURCE_LABELS: Record<string, string> = {
  body_measurement: "Latest body measurement",
  client_current_weight: "Saved client weight",
  onboarding_snapshot: "Onboarding snapshot",
};

const GOAL_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  recomposition: "Recomposition",
};

function sexLabel(value: string): string {
  return NUTRITION_EN_LABELS[value] ?? value;
}

function reasonLabel(reason: string): string {
  return NUTRITION_EN_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function missingLabel(code: string): string {
  return MISSING_LABELS[code] ?? code.replace(/_/g, " ");
}

function range(value: MacroRange | CalorieRange, unit: string): string {
  const min = "minGrams" in value ? value.minGrams : value.minKcal;
  const max = "maxGrams" in value ? value.maxGrams : value.maxKcal;
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

function fmtRange(min: number, max: number, unit: string): string {
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

function targetNumbers(target: PublicNutritionTarget): NutritionTargetValues {
  return {
    calorieMinKcal: target.calorieMinKcal,
    calorieMaxKcal: target.calorieMaxKcal,
    proteinMinGrams: target.proteinMinGrams,
    proteinMaxGrams: target.proteinMaxGrams,
    fatMinGrams: target.fatMinGrams,
    fatMaxGrams: target.fatMaxGrams,
    carbohydrateMinGrams: target.carbohydrateMinGrams,
    carbohydrateMaxGrams: target.carbohydrateMaxGrams,
  };
}

function scrollToOnboarding() {
  document.querySelector("#onboarding")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function responseOk(data: unknown): data is Payload {
  if (!data || typeof data !== "object") return false;
  const status = (data as { status?: unknown }).status;
  return status === "blocked" || status === "insufficient_data" || status === "ready";
}

export default function NutritionFoundations({ client }: { client: Client }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<TargetData>({ current: null, history: [] });
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalMode, setModalMode] = useState<"estimate" | "replace" | null>(null);

  const load = useCallback(async () => {
    if (!isPositiveInt(client.id)) { setPayload(null); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/nutrition-guidance?clientId=${client.id}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "Nutrition guidance could not be loaded."); setPayload(null); }
      else { setPayload(data as Payload); setError(""); }
    } catch { setError("Nutrition guidance could not be loaded."); setPayload(null); }
    setLoading(false);
  }, [client.id]);

  const loadTargets = useCallback(async () => {
    if (!isPositiveInt(client.id)) { setTargets({ current: null, history: [] }); setTargetsLoading(false); return; }
    setTargetsLoading(true);
    try {
      const response = await fetch(`/api/nutrition-targets?clientId=${client.id}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data && typeof data === "object" && Array.isArray(data.history)) {
        setTargets({ current: data.current ?? null, history: data.history });
      } else {
        setTargets({ current: null, history: [] });
      }
    } catch {
      setTargets({ current: null, history: [] });
    }
    setTargetsLoading(false);
  }, [client.id]);

  useEffect(() => {
    let active = true;
    // Never issue the request before a real client is selected (demo placeholder id -1).
    if (isPositiveInt(client.id)) {
      void fetch(`/api/nutrition-guidance?clientId=${client.id}`)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (active) { if (responseOk(data)) { setPayload(data); setError(""); } else if (data && typeof data.error === "string") { setError(data.error); setPayload(null); } setLoading(false); } })
        .catch(() => { if (active) { setError("Nutrition guidance could not be loaded."); setPayload(null); setLoading(false); } });
      void fetch(`/api/nutrition-targets?clientId=${client.id}`)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (active && data && typeof data === "object" && Array.isArray(data.history)) setTargets({ current: data.current ?? null, history: data.history }); })
        .catch(() => {})
        .finally(() => { if (active) setTargetsLoading(false); });
    }
    return () => { active = false; };
  }, [client.id]);

  // Refresh the ENGINE ESTIMATE when body measurements are saved (weight may
  // have changed) or when onboarding/nutrition foundations are edited — without
  // a full page reload. Approved targets are deliberately NOT refetched here:
  // those events must never rewrite a coach-approved target.
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId?: number }>).detail;
      if (!isPositiveInt(client.id) || (detail?.clientId !== undefined && detail.clientId !== client.id)) return;
      void load();
    };
    window.addEventListener("jonas-measurement-saved", refresh);
    window.addEventListener("jonas-onboarding-saved", refresh);
    return () => {
      window.removeEventListener("jonas-measurement-saved", refresh);
      window.removeEventListener("jonas-onboarding-saved", refresh);
    };
  }, [client.id, load]);

  const postTargets = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/nutrition-targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not approve nutrition targets.");
      setModalMode(null);
      setNotice("Nutrition targets approved.");
      await loadTargets();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not approve nutrition targets.");
    } finally {
      setSaving(false);
    }
  }, [loadTargets]);

  function approveEstimate() {
    if (payload?.status !== "ready") return;
    void postTargets({ clientId: client.id, ...targetValuesFromGuidance(payload.guidance), notes: "" });
  }

  async function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (payload?.status !== "ready") return;
    const form = new FormData(event.currentTarget);
    const numberOrNull = (value: FormDataEntryValue | null): number | null => {
      const raw = String(value ?? "").trim();
      if (raw === "") return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };
    await postTargets({
      clientId: client.id,
      calorieMinKcal: numberOrNull(form.get("calorieMinKcal")),
      calorieMaxKcal: numberOrNull(form.get("calorieMaxKcal")),
      proteinMinGrams: numberOrNull(form.get("proteinMinGrams")),
      proteinMaxGrams: numberOrNull(form.get("proteinMaxGrams")),
      fatMinGrams: numberOrNull(form.get("fatMinGrams")),
      fatMaxGrams: numberOrNull(form.get("fatMaxGrams")),
      carbohydrateMinGrams: numberOrNull(form.get("carbohydrateMinGrams")),
      carbohydrateMaxGrams: numberOrNull(form.get("carbohydrateMaxGrams")),
      notes: String(form.get("notes") ?? ""),
    });
  }

  if (!isPositiveInt(client.id)) {
    return <section className="nutrition-guidance" id="nutrition"><div className="nutrition-guidance-heading"><div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2></div></div><div className="nutrition-empty"><strong>Choose a saved client.</strong><span>Demo clients do not have a structured nutrition profile.</span></div></section>;
  }

  if (loading && !payload) {
    return <section className="nutrition-guidance" id="nutrition"><div className="nutrition-guidance-heading"><div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2></div></div><div className="nutrition-empty"><strong>Loading guidance…</strong></div></section>;
  }

  if (error && !payload) {
    return <section className="nutrition-guidance" id="nutrition"><div className="nutrition-guidance-heading"><div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2></div></div><div className="nutrition-empty"><strong>Guidance is not available yet.</strong><span>{error}</span></div></section>;
  }

  if (!payload) {
    return <section className="nutrition-guidance" id="nutrition"><div className="nutrition-guidance-heading"><div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2></div></div><div className="nutrition-empty"><strong>Guidance is not available yet.</strong></div></section>;
  }

  const estimateChanged = payload.status === "ready" && targets.current
    ? compareNutritionCalorieEstimate(
      { minKcal: payload.guidance.calorieRange.minKcal, maxKcal: payload.guidance.calorieRange.maxKcal },
      { minKcal: targets.current.sourceCalorieMinKcal, maxKcal: targets.current.sourceCalorieMaxKcal },
    )
    : "unknown";

  const modalBase: NutritionTargetValues | null = modalMode === "replace" && targets.current
    ? targetNumbers(targets.current)
    : modalMode === "estimate" && payload.status === "ready"
      ? targetValuesFromGuidance(payload.guidance)
      : null;

  return <section className="nutrition-guidance" id="nutrition" data-status={payload.status}>
    <div className="nutrition-guidance-heading">
      <div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2><span>Based on {client.name}&apos;s current profile and body data. Nothing is sent to the client until you review and approve it.</span></div>
    </div>

    {notice && <p className="nutrition-approval-notice">✓ {notice}</p>}
    {error && <p className="nutrition-approval-error" role="alert">{error}</p>}

    <p className="nutrition-section-label">ESTIMATED GUIDANCE · RECALCULATED FROM CURRENT INPUTS</p>
    {payload.status === "blocked" && <BlockedView reasons={payload.reasons} />}
    {payload.status === "insufficient_data" && <InsufficientView missing={payload.missing} />}
    {payload.status === "ready" && <ReadyView guidance={payload.guidance} input={payload.inputSummary} />}

    {payload.status === "ready" && <div className="nutrition-actions">
      <button type="button" className="nutrition-approve-button" disabled={saving} onClick={approveEstimate}>{saving ? "Saving…" : targets.current ? "Replace with estimate" : "Approve estimate"}</button>
      <button type="button" className="nutrition-adjust-button" disabled={saving} onClick={() => setModalMode("estimate")}>Adjust &amp; approve</button>
      {targets.current && <button type="button" className="nutrition-adjust-button" disabled={saving} onClick={() => setModalMode("replace")}>Replace approved target</button>}
    </div>}

    <div className="nutrition-approved">
      <p className="nutrition-section-label">APPROVED TARGETS · COACH-REVIEWED SNAPSHOT</p>
      {targetsLoading ? <div className="nutrition-approved-empty"><strong>Loading approved targets…</strong></div>
        : targets.current ? <>
          {estimateChanged === "changed" && <div className="nutrition-estimate-change" role="note">Current estimate has changed since approval — review suggested. Approved targets are not changed automatically.</div>}
          <ApprovedTargetCard target={targets.current} />
        </> : <div className="nutrition-approved-empty"><strong>Not approved yet.</strong><span>Review the estimated guidance above, then approve it or adjust the numbers before approving.</span></div>}
    </div>

    {targets.history.length > 0 && <div className="nutrition-history">
      <p className="nutrition-section-label">APPROVAL HISTORY</p>
      <div className="nutrition-history-list">{targets.history.map((target) => <HistoryCard key={target.id} target={target} />)}</div>
    </div>}

    <p className="nutrition-guidance-notice">These values are estimates for coaching guidance and should be reviewed before being shared with the client. Approved targets stay as you set them — they do not change when the estimate moves.</p>

    {modalMode && modalBase && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalMode(null)}>
      <form className="modal nutrition-approve-form" onSubmit={submitApproval} onMouseDown={(event) => event.stopPropagation()}>
        <div className="portal-form-head"><div><p>COACH-APPROVED TARGETS · {client.name}</p><h2>{modalMode === "replace" ? "Replace approved target." : "Approve nutrition targets."}</h2></div><button type="button" aria-label="Close" onClick={() => setModalMode(null)}>×</button></div>
        <p className="nutrition-section-label">CALORIES · KCAL / DAY</p>
        <div className="nutrition-range-grid">
          <label>Minimum<input name="calorieMinKcal" type="number" step="1" min={800} max={6000} defaultValue={modalBase.calorieMinKcal} required /></label>
          <label>Maximum<input name="calorieMaxKcal" type="number" step="1" min={800} max={6000} defaultValue={modalBase.calorieMaxKcal} required /></label>
        </div>
        <p className="nutrition-section-label">PROTEIN · G / DAY</p>
        <div className="nutrition-range-grid">
          <label>Minimum<input name="proteinMinGrams" type="number" step="1" min={20} max={500} defaultValue={modalBase.proteinMinGrams} required /></label>
          <label>Maximum<input name="proteinMaxGrams" type="number" step="1" min={20} max={500} defaultValue={modalBase.proteinMaxGrams} required /></label>
        </div>
        <p className="nutrition-section-label">FAT · G / DAY</p>
        <div className="nutrition-range-grid">
          <label>Minimum<input name="fatMinGrams" type="number" step="1" min={20} max={250} defaultValue={modalBase.fatMinGrams} required /></label>
          <label>Maximum<input name="fatMaxGrams" type="number" step="1" min={20} max={250} defaultValue={modalBase.fatMaxGrams} required /></label>
        </div>
        <p className="nutrition-section-label">CARBOHYDRATES · G / DAY</p>
        <div className="nutrition-range-grid">
          <label>Minimum<input name="carbohydrateMinGrams" type="number" step="1" min={0} max={800} defaultValue={modalBase.carbohydrateMinGrams} required /></label>
          <label>Maximum<input name="carbohydrateMaxGrams" type="number" step="1" min={0} max={800} defaultValue={modalBase.carbohydrateMaxGrams} required /></label>
        </div>
        <label className="nutrition-notes-label">Notes (optional)<textarea name="notes" defaultValue={modalMode === "replace" ? targets.current?.notes ?? "" : ""} placeholder="Why these numbers, context for future review…" /></label>
        <p className="nutrition-form-note">Macros must be reasonably compatible with the calorie range — obviously impossible combinations are rejected.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="generate nutrition-submit" disabled={saving}>{saving ? "Saving…" : modalMode === "replace" ? "Save replacement targets" : "Approve targets"} <span>→</span></button>
      </form>
    </div>}
  </section>;
}

function BlockedView({ reasons }: { reasons: string[] }) {
  return <div className="nutrition-state-block">
    <i>⚠</i>
    <div><p>PROFESSIONAL REVIEW REQUIRED</p><h3>Automatic nutrition guidance is unavailable.</h3><span>One or more safety conditions require individualized review before any starting targets are estimated. New approvals are disabled.</span></div>
    <ul className="nutrition-reason-list">{reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul>
  </div>;
}

function InsufficientView({ missing }: { missing: string[] }) {
  const codes = missing.length ? missing : ["invalid_age", "invalid_sex", "invalid_height", "invalid_weight", "invalid_activity", "unsupported_goal"];
  return <div className="nutrition-state-block">
    <i>○</i>
    <div><p>NUTRITION FOUNDATIONS INCOMPLETE</p><h3>Missing the inputs needed to estimate guidance.</h3><span>Complete the client&apos;s coaching foundations and these will clear. New approvals are unavailable until then.</span></div>
    <ul className="nutrition-missing-list">{codes.map((code) => <li key={code}>{missingLabel(code)}</li>)}</ul>
    <button type="button" className="nutrition-foundations-action" onClick={scrollToOnboarding}>Complete coaching foundations <span>→</span></button>
  </div>;
}

function ReadyView({ guidance, input }: { guidance: Guidance; input: InputSummary }) {
  const showTarget = typeof input.targetWeightKg === "number";
  const assumptionLines = guidance.assumptions.length
    ? guidance.assumptions.map((a) => a.replace(/_/g, " ")).join(" · ")
    : "Mifflin-St Jeor BMR · resolved activity factor";

  return <div className="nutrition-ready">
    <div className="nutrition-basis-card">
      <p>INPUT BASIS</p>
      <div className="nutrition-basis-grid">
        <span>Age<b>{input.ageYears !== null ? input.ageYears : "—"}</b></span>
        <span>Sex<b>{input.sex ? sexLabel(input.sex) : "—"}</b></span>
        <span>Height<b>{input.heightCm !== null ? `${input.heightCm} cm` : "—"}</b></span>
        <span>Current weight<b>{input.currentWeightKg !== null ? `${input.currentWeightKg} kg` : "—"}</b></span>
        <span>Weight source<b>{input.weightSource ? WEIGHT_SOURCE_LABELS[input.weightSource] ?? input.weightSource : "—"}</b></span>
        <span>Activity<b>{input.activity || "—"}</b></span>
        <span>Goal<b>{input.goal || "—"}</b></span>
        {showTarget && <span>Target weight<b>{input.targetWeightKg} kg</b></span>}
      </div>
    </div>

    <div className="nutrition-energy-grid">
      <article><p>ESTIMATED BMR</p><strong>{guidance.estimatedBmrKcal}</strong><span>kcal / day · Mifflin-St Jeor</span></article>
      <article><p>ESTIMATED MAINTENANCE (TDEE)</p><strong>{guidance.estimatedTdeeKcal}</strong><span>kcal / day · activity factor {guidance.activityFactor}</span></article>
    </div>

    <div className="nutrition-goal-guidance">
      <div><p>GOAL GUIDANCE</p><h3>{GOAL_LABELS[guidance.goal] ?? guidance.goal}</h3></div>
      <div><small>SUGGESTED STARTING CALORIE RANGE</small><strong>{range(guidance.calorieRange, "kcal / day")}</strong></div>
    </div>

    <div className="nutrition-macro-grid">
      <article><p>PROTEIN</p><strong>{range(guidance.protein, "g / day")}</strong><span>1.6–2.2 g per kg body weight</span></article>
      <article><p>FAT</p><strong>{range(guidance.fat, "g / day")}</strong><span>20–35% of intake, min 0.8 g per kg</span></article>
      <article><p>CARBOHYDRATES</p><strong>{range(guidance.carbohydrates, "g / day")}</strong><span>Remaining energy after protein and fat</span></article>
    </div>

    {guidance.warnings.length > 0 && <div className="nutrition-warnings" role="note">⚠ {guidance.warnings.map((w) => w.replace(/_/g, " ")).join(" · ")}</div>}

    <details className="nutrition-disclosure">
      <summary>How this was estimated</summary>
      <div className="nutrition-disclosure-body">
        <p><b>BMR method:</b> Mifflin-St Jeor — 10 × weight + 6.25 × height − 5 × age (+5 male / −161 female).</p>
        <p><b>Activity:</b> resolved deterministically from activity level, step count and work type (single factor — no double-counting). Factor {guidance.activityFactor} ({guidance.activityBand}).</p>
        <p><b>Goal adjustment:</b> {GOAL_LABELS[guidance.goal] ?? guidance.goal} policy applied to maintenance calories ({assumptionLines}).</p>
      </div>
    </details>
  </div>;
}

function ApprovedTargetCard({ target }: { target: PublicNutritionTarget }) {
  return <div className="nutrition-approved-card">
    <div className="nutrition-approved-values">
      <span>Calories<b>{fmtRange(target.calorieMinKcal, target.calorieMaxKcal, "kcal / day")}</b></span>
      <span>Protein<b>{fmtRange(target.proteinMinGrams, target.proteinMaxGrams, "g / day")}</b></span>
      <span>Fat<b>{fmtRange(target.fatMinGrams, target.fatMaxGrams, "g / day")}</b></span>
      <span>Carbohydrates<b>{fmtRange(target.carbohydrateMinGrams, target.carbohydrateMaxGrams, "g / day")}</b></span>
    </div>
    <div className="nutrition-approved-provenance">
      <small>APPROVED {new Date(target.approvedAt).toLocaleDateString()}</small>
      <p>Based on an estimated TDEE of {target.sourceEstimatedTdeeKcal ?? "—"} kcal{target.sourceWeightKg != null ? ` at ${target.sourceWeightKg} kg` : ""}{target.sourceGoal ? ` · ${target.sourceGoal}` : ""}. Engine v{target.engineVersion || "—"}.</p>
      {target.notes && <p className="nutrition-approved-notes">{target.notes}</p>}
    </div>
  </div>;
}

function HistoryCard({ target }: { target: PublicNutritionTarget }) {
  const current = target.status === "approved";
  return <div className={`nutrition-history-card ${current ? "current" : ""}`}>
    <div className="nutrition-history-head">
      <span>{new Date(target.approvedAt).toLocaleDateString()}</span>
      <em>{current ? "CURRENT" : "SUPERSEDED"}</em>
    </div>
    <p>Calories {fmtRange(target.calorieMinKcal, target.calorieMaxKcal, "kcal")} · Protein {fmtRange(target.proteinMinGrams, target.proteinMaxGrams, "g")}</p>
    <p>Fat {fmtRange(target.fatMinGrams, target.fatMaxGrams, "g")} · Carbs {fmtRange(target.carbohydrateMinGrams, target.carbohydrateMaxGrams, "g")}</p>
    <small>{target.sourceGoal}{target.sourceWeightKg != null ? ` · ${target.sourceWeightKg} kg` : ""}{target.sourceWeightSource ? ` (${target.sourceWeightSource.replace(/_/g, " ")})` : ""}</small>
  </div>;
}
