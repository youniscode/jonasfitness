"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovedTargetSnapshot, MealPlanMealsSnapshot } from "../lib/nutrition-meal-plans";

type Lang = "fr" | "en" | "ar";

type PlanPayload = {
  status: "assigned";
  title: string;
  versionNumber: number;
  assignedAt: string;
  approvedAt: string;
  target: ApprovedTargetSnapshot;
  meals: MealPlanMealsSnapshot;
  disclaimer: string;
};

const copy = {
  fr: {
    kicker: "PLAN NUTRITION · VALIDÉ PAR VOTRE COACH",
    title: "Votre plan nutritionnel.",
    intro: "Un plan approuvé par votre coach, construit sur vos objectifs et vos restrictions.",
    empty: "Votre coach n'a pas encore partagé de plan nutritionnel avec vous.",
    version: (n: number) => `Version ${n}`,
    assigned: "Partagé le",
    daily: "TOTAL JOURNALIER",
    target: "OBJECTIFS APPROUVÉS",
    meal: "REPAS",
    disclaimerLabel: "À noter",
    perMeal: "Par repas",
  },
  en: {
    kicker: "NUTRITION PLAN · COACH-APPROVED",
    title: "Your nutrition plan.",
    intro: "A coach-approved plan built around your goals and restrictions.",
    empty: "Your coach hasn't shared a nutrition plan with you yet.",
    version: (n: number) => `Version ${n}`,
    assigned: "Shared on",
    daily: "DAILY TOTAL",
    target: "APPROVED TARGETS",
    meal: "MEAL",
    disclaimerLabel: "Please note",
    perMeal: "Per meal",
  },
  ar: {
    kicker: "خطة التغذية · معتمدة من مدربك",
    title: "خطتك الغذائية.",
    intro: "خطة معتمدة من مدربك مبنية على أهدافك وقيودك الغذائية.",
    empty: "لم يشارك مدربك خطة تغذية معك بعد.",
    version: (n: number) => `الإصدار ${n}`,
    assigned: "تمت المشاركة في",
    daily: "المجموع اليومي",
    target: "الأهداف المعتمدة",
    meal: "وجبة",
    disclaimerLabel: "ملاحظة",
    perMeal: "لكل وجبة",
  },
} as const;

const format = (value: number, lang: Lang) =>
  new Intl.NumberFormat(lang === "ar" ? "ar" : lang, { maximumFractionDigits: 0 }).format(value);

// Read-only view of the ACTIVE assignment's approved plan. The client can
// never see drafts, history or internal ids — only this sanitized snapshot.
export default function ClientNutritionPlan({ lang, preview, clientId }: { lang: Lang; preview: boolean; clientId: number }) {
  const t = copy[lang];
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    const query = preview ? `?preview=${clientId}` : "";
    const response = await fetch(`/api/client/nutrition-plan${query}`);
    if (!response.ok) { setChecked(true); return; }
    const result = await response.json();
    if (result?.status === "assigned") setPlan(result as PlanPayload);
    setChecked(true);
  }, [clientId, preview]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!checked) return null;

  return (
    <section className="client-nutrition-plan">
      <header>
        <p>{t.kicker}</p>
        <h2>{t.title}</h2>
        <span>{t.intro}</span>
      </header>
      {!plan ? (
        <p className="portal-empty">{t.empty}</p>
      ) : (
        <>
          <div className="client-plan-meta">
            <strong>{plan.title}</strong>
            <span>{t.version(plan.versionNumber)} · {t.assigned} {new Date(plan.assignedAt).toLocaleDateString(lang)}</span>
          </div>
          <div className="client-plan-targets">
            <small>{t.target}</small>
            <span>
              {format(plan.target.calories.min, lang)}–{format(plan.target.calories.max, lang)} kcal · P {format(plan.target.protein.min, lang)}–{format(plan.target.protein.max, lang)} g · F {format(plan.target.fat.min, lang)}–{format(plan.target.fat.max, lang)} g · C {format(plan.target.carbohydrates.min, lang)}–{format(plan.target.carbohydrates.max, lang)} g
            </span>
          </div>
          <div className="client-plan-meals">
            {plan.meals.meals.map((meal, index) => (
              <article key={`${meal.name}-${index}`}>
                <header>
                  <strong>{meal.name}</strong>
                  <small>{t.perMeal} · {format(meal.totals.kcal, lang)} kcal</small>
                </header>
                <ul>
                  {meal.foods.map((food) => (
                    <li key={food.foodId}>
                      <span>{food.name}</span>
                      <em>{format(food.quantityG, lang)} g</em>
                    </li>
                  ))}
                </ul>
                <footer>
                  P {format(meal.totals.proteinG, lang)} g · F {format(meal.totals.fatG, lang)} g · C {format(meal.totals.carbohydrateG, lang)} g
                </footer>
              </article>
            ))}
          </div>
          <div className="client-plan-totals">
            <small>{t.daily}</small>
            <strong>{format(plan.meals.totals.kcal, lang)} kcal</strong>
            <span>P {format(plan.meals.totals.proteinG, lang)} g · F {format(plan.meals.totals.fatG, lang)} g · C {format(plan.meals.totals.carbohydrateG, lang)} g</span>
          </div>
          <p className="client-plan-disclaimer"><b>{t.disclaimerLabel} — </b>{plan.disclaimer}</p>
        </>
      )}
    </section>
  );
}
