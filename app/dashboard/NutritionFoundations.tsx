"use client";

import { useCallback, useEffect, useState } from "react";
import { isPositiveInt } from "../lib/query-params";
import { NUTRITION_EN_LABELS } from "../lib/onboarding-profile";

type Client = { id: number; name: string };

type MacroRange = { minGrams: number; maxGrams: number };
type CalorieRange = { minKcal: number; maxKcal: number };
type Guidance = {
  estimatedBmrKcal: number;
  activityFactor: number;
  activityBand: string;
  estimatedTdeeKcal: number;
  goal: string;
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

  useEffect(() => {
    let active = true;
    if (isPositiveInt(client.id)) {
      void fetch(`/api/nutrition-guidance?clientId=${client.id}`)
        .then((response) => response.json().catch(() => ({})))
        .then((data) => { if (active) { if (responseOk(data)) { setPayload(data); setError(""); } else if (data && typeof data.error === "string") { setError(data.error); setPayload(null); } setLoading(false); } })
        .catch(() => { if (active) { setError("Nutrition guidance could not be loaded."); setPayload(null); setLoading(false); } });
    }
    return () => { active = false; };
  }, [client.id]);

  // Refresh when body measurements are saved (weight may have changed) or when
  // onboarding/nutrition foundations are edited — without a full page reload.
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

  return <section className="nutrition-guidance" id="nutrition" data-status={payload.status}>
    <div className="nutrition-guidance-heading">
      <div><p>NUTRITION GUIDANCE</p><h2>Estimated starting guidance.</h2><span>Based on {client.name}&apos;s current profile and body data. Nothing is sent to the client until you review it.</span></div>
    </div>

    {payload.status === "blocked" && <BlockedView reasons={payload.reasons} />}
    {payload.status === "insufficient_data" && <InsufficientView missing={payload.missing} />}
    {payload.status === "ready" && <ReadyView guidance={payload.guidance} input={payload.inputSummary} />}

    <p className="nutrition-guidance-notice">These values are estimates for coaching guidance and should be reviewed before being shared with the client.</p>
  </section>;
}

function BlockedView({ reasons }: { reasons: string[] }) {
  return <div className="nutrition-state-block">
    <i>⚠</i>
    <div><p>PROFESSIONAL REVIEW REQUIRED</p><h3>Automatic nutrition guidance is unavailable.</h3><span>One or more safety conditions require individualized review before any starting targets are estimated.</span></div>
    <ul className="nutrition-reason-list">{reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul>
  </div>;
}

function InsufficientView({ missing }: { missing: string[] }) {
  const codes = missing.length ? missing : ["invalid_age", "invalid_sex", "invalid_height", "invalid_weight", "invalid_activity", "unsupported_goal"];
  return <div className="nutrition-state-block">
    <i>○</i>
    <div><p>NUTRITION FOUNDATIONS INCOMPLETE</p><h3>Missing the inputs needed to estimate guidance.</h3><span>Complete the client&apos;s coaching foundations and these will clear.</span></div>
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
