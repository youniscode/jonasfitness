import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { clientBodyMeasurements, clientIntakes, clients, programmes } from "../../../db/schema";
import { evaluateCoachAuth, getCoachId } from "../../clerk-auth";
import { getPortalAccess } from "../../client/portal-auth";
import { publicIntake } from "../../lib/client-dto";
import {
  latestWeightForSync,
  measurementNumberFrom,
  type MeasurementRow,
} from "../../lib/body-measurements";
import {
  applyNutritionInputs,
  applyTrainingSupervision,
  deriveIntakeFields,
  nutritionFoundationStatus,
  parseProfile,
  profileFromIntake,
  profileMinimum,
  profileSummary,
  sanitizeProfile,
  TRAINING_SUPERVISIONS,
  type NutritionInputPatch,
  type OnboardingProfile,
  type TrainingSupervision,
} from "../../lib/onboarding-profile";
import { positiveIntParam } from "../../lib/query-params";
import {
  onboardingChecks,
  onboardingLanguages,
  onboardingState,
  readinessReviewAfterClientEdit,
  type OnboardingLanguage,
} from "../../lib/client-onboarding";

function text(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const clientId = positiveIntParam(searchParams, "clientId");
  // ONE atomic evaluation: the decision and the diagnostic reason come from
  // the same auth()/currentUser() pass, so a denial can never log "allowed".
  const coachAuth = await evaluateCoachAuth();
  let ownerId = coachAuth.allowed ? coachAuth.coachId : null;
  let safeClientId = clientId;
  // Portal access is only resolved in the client/preview branch below; declared
  // here so the branch can narrow it without leaving the rest of the handler blind.
  let access: Awaited<ReturnType<typeof getPortalAccess>> = null;

  if (!coachAuth.allowed || !clientId) {
    access = await getPortalAccess(positiveIntParam(searchParams, "preview"));
    if (!access) {
      if (!coachAuth.allowed) {
        // Server-side diagnostic only. The reason comes from the SAME atomic
        // evaluation that denied coach access - "denied: allowed" is
        // structurally impossible here. Never sent to the client, no PII.
        console.warn(`[coach-auth] client-onboarding denied: ${coachAuth.reason}`);
        return Response.json({ error: "Client access required." }, { status: 403 });
      }
      // Authenticated coach with no valid client selection (and no preview
      // match): a missing parameter, not an access denial.
      return Response.json({ error: "Choose a client." }, { status: 400 });
    }
    ownerId = access.client.ownerId;
    safeClientId = access.client.id;
  }

  if (!ownerId || !safeClientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  const db = getDb();
  const [intake] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, safeClientId), eq(clientIntakes.ownerId, ownerId))).limit(1);

  // Portal consumers (including coach previews) receive only the whitelisted
  // public intake shape. Legacy clients without a structured profile get a
  // synthesized one (best-effort, from their flat answers + client row), so the
  // V2 survey opens pre-filled instead of empty.
  if ((!coachAuth.allowed || !clientId) && access) {
    const profile = parseProfile(intake?.profile) ?? profileFromIntake(intake ?? null, access.client);
    return Response.json({
      intake: intake ? { ...publicIntake(intake), profile } : null,
      client: { id: access.client.id, name: access.client.name, goal: access.client.goal, sessionsPerWeek: access.client.sessionsPerWeek, currentWeight: access.client.currentWeight },
    });
  }

  // Coach consumers get the full intake (private coach notes included) plus
  // the derived onboarding state, the structured profile and programme status.
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, safeClientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  const [programme] = await db.select({ id: programmes.id, title: programmes.title, status: programmes.status })
    .from(programmes)
    .where(and(eq(programmes.clientId, safeClientId), eq(programmes.ownerId, ownerId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);
  const profile = parseProfile(intake?.profile) ?? profileFromIntake(intake ?? null, client);

  // Nutrition Foundations status - deterministic, coach-facing only. Current
  // weight resolution follows the canonical source policy: latest weight-bearing
  // client_body_measurements row, then clients.currentWeight, then the
  // onboarding snapshot. No calories are calculated.
  const [latestBodyWeight] = await db.select({ weightKg: clientBodyMeasurements.weightKg })
    .from(clientBodyMeasurements)
    .where(and(
      eq(clientBodyMeasurements.clientId, safeClientId),
      eq(clientBodyMeasurements.ownerId, ownerId),
      isNotNull(clientBodyMeasurements.weightKg),
    ))
    .orderBy(desc(clientBodyMeasurements.measuredAt), desc(clientBodyMeasurements.id)).limit(1);
  const resolvedWeight = typeof latestBodyWeight?.weightKg === "number"
    ? latestBodyWeight.weightKg
    : typeof client.currentWeight === "number" ? client.currentWeight : profile.measurements.weightKg;

  return Response.json({
    intake: intake ?? null,
    profile,
    client: { id: client.id, name: client.name, email: client.email, goal: client.goal, currentWeight: client.currentWeight },
    programme: programme ?? null,
    state: onboardingState(client, intake ?? null, Boolean(programme), profile),
    checks: onboardingChecks(client, intake ?? null, Boolean(programme), profile),
    // Coach-facing structured summary (compact blocks, not a raw answer dump).
    summary: profileSummary(profile),
    nutritionStatus: nutritionFoundationStatus(profile, { currentWeightKg: resolvedWeight }),
    resolvedWeightKg: resolvedWeight,
  });
}

// Coach-only writer for the client onboarding profile. The coach completes or
// corrects fields the client has not answered yet and records the private
// readiness review. Every write is scoped to the authenticated coach's client
// (ownerId comes from the session, never from the request body).
export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [existing] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId))).limit(1);

  // Structured survey: the coach may correct the client's structured profile.
  // When provided, the critical flat fields are re-derived from it so every
  // downstream consumer stays in sync.
  const incomingProfile = body.profile && typeof body.profile === "object" ? sanitizeProfile(body.profile) : null;
  const derived = incomingProfile ? deriveIntakeFields(incomingProfile) : null;

  // Coach-modal merge: a single canonical trainingSupervision token is applied to
  // the client's EXISTING structured profile (or a legacy synthesis) - never a
  // wholesale profile replacement, so structured fields the modal does not display
  // are preserved. An absent value leaves the profile untouched; an empty value
  // only clears the field for clients who already have a structured profile (and
  // is never inferred from confidence.alone).
  const structuredProfile = parseProfile(existing?.profile);
  const supervisionRaw = body.trainingSupervision === undefined
    ? undefined
    : String(body.trainingSupervision ?? "").trim();
  let mergedProfile: OnboardingProfile | null = null;
  if (supervisionRaw !== undefined) {
    const canonical = (TRAINING_SUPERVISIONS as readonly string[]).includes(supervisionRaw)
      ? (supervisionRaw as TrainingSupervision)
      : "";
    if (canonical || structuredProfile) {
      mergedProfile = applyTrainingSupervision(
        structuredProfile ?? profileFromIntake(existing ?? null, client),
        canonical,
      );
    }
  }
  // Nutrition-foundation fields (demographics, target weight, nutrition
  // preferences, safety flags) merge field-scoped onto the existing profile,
  // chained after any supervision merge so both quick actions coexist.
  if (body.nutritionInputs && typeof body.nutritionInputs === "object") {
    mergedProfile = applyNutritionInputs(
      mergedProfile ?? structuredProfile ?? profileFromIntake(existing ?? null, client),
      body.nutritionInputs as NutritionInputPatch,
    );
  }
  const mergedDerived = mergedProfile ? deriveIntakeFields(mergedProfile) : null;

  // Partial update: only fields present in the body are written, so a quick
  // action (e.g. marking readiness reviewed) never wipes the client's answers.
  if (body.preferredLanguage !== undefined) {
    const candidate = text(body.preferredLanguage, 2);
    if (!onboardingLanguages.includes(candidate as OnboardingLanguage)) {
      return Response.json({ error: "Choose a valid language." }, { status: 400 });
    }
  }
  const preferredLanguage = body.preferredLanguage !== undefined
    ? text(body.preferredLanguage, 2)
    : existing?.preferredLanguage ?? "fr";
  const trainingExperience = body.trainingExperience !== undefined
    ? text(body.trainingExperience, 80)
    : derived?.trainingExperience ?? mergedDerived?.trainingExperience ?? existing?.trainingExperience ?? "";
  const availability = body.availability !== undefined
    ? text(body.availability, 300)
    : derived?.availability ?? mergedDerived?.availability ?? existing?.availability ?? "";
  const equipment = body.equipment !== undefined
    ? text(body.equipment, 180)
    : derived?.equipment ?? mergedDerived?.equipment ?? existing?.equipment ?? "";
  const goalsDetail = body.goalsDetail !== undefined
    ? text(body.goalsDetail, 500)
    : derived?.goalsDetail ?? mergedDerived?.goalsDetail ?? existing?.goalsDetail ?? "";
  const trainingConsiderations = body.trainingConsiderations !== undefined
    ? text(body.trainingConsiderations, 500)
    : derived?.trainingConsiderations ?? mergedDerived?.trainingConsiderations ?? existing?.trainingConsiderations ?? "";
  const coachNotes = body.coachNotes !== undefined
    ? text(body.coachNotes, 1000)
    : existing?.coachNotes ?? "";

  const reviewNow = body.readinessReviewed === true && !existing?.readinessReviewedAt;
  const values = {
    ownerId,
    preferredLanguage,
    trainingExperience,
    availability,
    equipment,
    goalsDetail,
    trainingConsiderations,
    profile: mergedProfile
      ? JSON.stringify(mergedProfile)
      : incomingProfile ? JSON.stringify(incomingProfile) : (existing?.profile ?? "{}"),
    coachNotes,
    readinessReviewedAt: reviewNow ? new Date() : (existing?.readinessReviewedAt ?? null),
    updatedAt: new Date(),
  };
  const [intake] = existing
    ? await db.update(clientIntakes).set(values).where(eq(clientIntakes.id, existing.id)).returning()
    : await db.insert(clientIntakes).values({ clientId, consentAt: new Date(), ...values }).returning();

  // --- Current weight: append to body-measurement history when changed ---
  // The coach modal may include a currentWeight field that represents the
  // authoritative resolved weight. When it differs from the pre-save resolved
  // value (or no weight existed), create a weight-only measurement event.
  // This keeps the body-composition history as the single source of truth.
  let submittedWeightKg: number | null = null;
  if (body.currentWeightKg !== undefined && body.currentWeightKg !== null && body.currentWeightKg !== "") {
    const parsed = measurementNumberFrom(body.currentWeightKg);
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      submittedWeightKg = parsed;
    }
  }

  // Re-read all weight-bearing rows to compute pre-save resolved weight
  const weightRows = await db.select({
    id: clientBodyMeasurements.id,
    clientId: clientBodyMeasurements.clientId,
    weightKg: clientBodyMeasurements.weightKg,
    bodyFatPercent: clientBodyMeasurements.bodyFatPercent,
    leanMassKg: clientBodyMeasurements.leanMassKg,
    waistCm: clientBodyMeasurements.waistCm,
    chestCm: clientBodyMeasurements.chestCm,
    hipsCm: clientBodyMeasurements.hipsCm,
    armCm: clientBodyMeasurements.armCm,
    thighCm: clientBodyMeasurements.thighCm,
    measuredAt: clientBodyMeasurements.measuredAt,
    source: clientBodyMeasurements.source,
    notes: clientBodyMeasurements.notes,
    createdAt: clientBodyMeasurements.createdAt,
    ownerId: clientBodyMeasurements.ownerId,
  }).from(clientBodyMeasurements)
    .where(and(
      eq(clientBodyMeasurements.clientId, clientId),
      eq(clientBodyMeasurements.ownerId, ownerId),
    ))
    .orderBy(desc(clientBodyMeasurements.measuredAt), desc(clientBodyMeasurements.id));

  const typedRows = weightRows as unknown as MeasurementRow[];
  const preSyncWeight = latestWeightForSync(typedRows);

  // Weight changed when: submitted differs from resolved, or no weight existed and one was provided
  const weightChanged = submittedWeightKg !== null
    && (preSyncWeight === null || Math.abs(submittedWeightKg - preSyncWeight) > 0.05);

  if (weightChanged) {
    await db.insert(clientBodyMeasurements).values({
      clientId,
      ownerId,
      weightKg: submittedWeightKg,
      measuredAt: new Date(),
      source: "coach",
      notes: "Saved from coaching foundations",
    });

    // Sync clients.currentWeight: re-read all weight-bearing rows + pick latest
    const allWeightRows = await db.select({
      id: clientBodyMeasurements.id,
      clientId: clientBodyMeasurements.clientId,
      weightKg: clientBodyMeasurements.weightKg,
      bodyFatPercent: clientBodyMeasurements.bodyFatPercent,
      leanMassKg: clientBodyMeasurements.leanMassKg,
      waistCm: clientBodyMeasurements.waistCm,
      chestCm: clientBodyMeasurements.chestCm,
      hipsCm: clientBodyMeasurements.hipsCm,
      armCm: clientBodyMeasurements.armCm,
      thighCm: clientBodyMeasurements.thighCm,
      measuredAt: clientBodyMeasurements.measuredAt,
      source: clientBodyMeasurements.source,
      notes: clientBodyMeasurements.notes,
      createdAt: clientBodyMeasurements.createdAt,
      ownerId: clientBodyMeasurements.ownerId,
    }).from(clientBodyMeasurements)
      .where(and(
        eq(clientBodyMeasurements.clientId, clientId),
        eq(clientBodyMeasurements.ownerId, ownerId),
        isNotNull(clientBodyMeasurements.weightKg),
      ));
    const syncedWeight = latestWeightForSync(allWeightRows as unknown as MeasurementRow[]);
    await db.update(clients).set({ currentWeight: syncedWeight }).where(eq(clients.id, clientId));
  }

  const [programme] = await db.select({ id: programmes.id, title: programmes.title, status: programmes.status })
    .from(programmes)
    .where(and(eq(programmes.clientId, clientId), eq(programmes.ownerId, ownerId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);
  const savedProfile = parseProfile(intake.profile) ?? profileFromIntake(intake, client);

  // Re-resolve current weight after potential write
  const [latestBodyWeight] = await db.select({ weightKg: clientBodyMeasurements.weightKg })
    .from(clientBodyMeasurements)
    .where(and(
      eq(clientBodyMeasurements.clientId, clientId),
      eq(clientBodyMeasurements.ownerId, ownerId),
      isNotNull(clientBodyMeasurements.weightKg),
    ))
    .orderBy(desc(clientBodyMeasurements.measuredAt), desc(clientBodyMeasurements.id)).limit(1);
  const resolvedWeight = typeof latestBodyWeight?.weightKg === "number"
    ? latestBodyWeight.weightKg
    : typeof client.currentWeight === "number" ? client.currentWeight : savedProfile.measurements.weightKg;

  return Response.json({
    intake,
    profile: savedProfile,
    state: onboardingState(client, intake, Boolean(programme), savedProfile),
    checks: onboardingChecks(client, intake, Boolean(programme), savedProfile),
    nutritionStatus: nutritionFoundationStatus(savedProfile, { currentWeightKg: resolvedWeight }),
    resolvedWeightKg: resolvedWeight,
  });
}

// Client-facing writer: consent-gated, portal-authenticated. Accepts either the
// structured survey (profile) or the legacy flat fields. A change to the
// limitation notes invalidates a previous coach readiness review so the coach
// re-reviews the new information before programme assignment.
export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access || access.preview) return Response.json({ error: "Client access required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  if (body.consent !== true) return Response.json({ error: "Consent is required before saving your onboarding." }, { status: 400 });

  const preferredLanguage = text(body.preferredLanguage, 2);
  if (!["fr", "en", "ar"].includes(preferredLanguage)) return Response.json({ error: "Choose a valid language." }, { status: 400 });

  // Structured survey (V2): the client sends their full profile state on every
  // save (autosave per step and the final submit). The critical flat fields are
  // derived from it. `complete: true` only on the final submit enforces the
  // required minimum; intermediate autosaves may be partial.
  const incomingProfile = body.profile && typeof body.profile === "object" ? sanitizeProfile(body.profile) : null;
  if (incomingProfile && body.complete === true) {
    const minimum = profileMinimum(incomingProfile);
    if (!minimum.complete) {
      return Response.json({ error: `Complete the required sections first: ${minimum.missing.join(", ")}.` }, { status: 400 });
    }
  }
  const derived = incomingProfile ? deriveIntakeFields(incomingProfile) : null;

  const trainingExperience = derived?.trainingExperience ?? text(body.trainingExperience, 80);
  const availability = derived?.availability ?? text(body.availability, 300);
  const equipment = derived?.equipment ?? text(body.equipment, 180);
  const goalsDetail = derived?.goalsDetail ?? text(body.goalsDetail, 500);
  const trainingConsiderations = derived?.trainingConsiderations ?? text(body.trainingConsiderations, 500);
  // Legacy flat-only submissions keep the V1 required-field contract.
  if (!incomingProfile && (!trainingExperience || !availability || !goalsDetail)) {
    return Response.json({ error: "Please complete your experience, availability and goals." }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db.select().from(clientIntakes).where(and(eq(clientIntakes.clientId, access.client.id), eq(clientIntakes.ownerId, access.client.ownerId))).limit(1);
  const plannedReview = readinessReviewAfterClientEdit(
    existing?.trainingConsiderations,
    trainingConsiderations,
    existing?.readinessReviewedAt ?? null,
  );
  const readinessReviewedAt = plannedReview ? new Date(plannedReview) : null;
  const values = {
    ownerId: access.client.ownerId,
    preferredLanguage,
    trainingExperience,
    availability,
    equipment,
    goalsDetail,
    trainingConsiderations,
    profile: incomingProfile ? JSON.stringify(incomingProfile) : (existing?.profile ?? "{}"),
    readinessReviewedAt,
    updatedAt: new Date(),
  };
  const [intake] = existing
    ? await db.update(clientIntakes).set(values).where(eq(clientIntakes.id, existing.id)).returning()
    : await db.insert(clientIntakes).values({ clientId: access.client.id, consentAt: new Date(), ...values }).returning();
  const savedProfile = parseProfile(intake.profile) ?? null;

  return Response.json({
    intake: publicIntake(intake),
    state: onboardingState(access.client, intake, false, savedProfile),
    checks: onboardingChecks(access.client, intake, false, savedProfile),
  });
}

