import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// -----------------------------------------------------------------
// Phase 2 - Jonas Fitness Progress commercial layer (Founding Access).
//
// Three minimal, provider-faithful tables power the paid product: an
// authoritative order ledger (one row per purchase attempt, keyed by the
// unique Stripe checkout/payment id so retries can never duplicate), an
// entitlement ledger (one active row per owner+product at the database level
// via a partial unique index, `revoked_at` superseding rather than deleting),
// and an append-only webhook idempotency trail (one row per consumed provider
// event id). Ownership is the ATHLETE'S OWN Clerk user id (`owner_id`),
// resolved server-side only - never from the browser. Monetary amounts are
// stored as integer minor units (cents) to avoid floating-point drift; the
// provider (Stripe) remains authoritative for amounts, tax and compliance.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  goal: text("goal").notNull().default("Build muscle"),
  status: text("status").notNull().default("active"),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(4),
  currentWeight: doublePrecision("current_weight"),
  adherence: integer("adherence").notNull().default(0),
  nextCheckIn: text("next_check_in"),
  acquisitionSource: text("acquisition_source").notNull().default("Unknown"),
  acquisitionMedium: text("acquisition_medium").notNull().default(""),
  acquisitionCampaign: text("acquisition_campaign").notNull().default(""),
  acquisitionReferrer: text("acquisition_referrer").notNull().default(""),
  acquisitionLandingPage: text("acquisition_landing_page").notNull().default(""),
  acquisitionCapturedAt: timestamp("acquisition_captured_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("clients_owner_id_idx").on(table.ownerId),
  // Client sign-in is matched by verified email, so the address must be unique
  // across the whole table (case-insensitively). The index is partial so that
  // clients without an email (the empty-string default) do not collide.
  uniqueIndex("clients_email_lower_unique").on(sql`lower(${table.email})`).where(sql`${table.email} <> ''`),
]);

// Public coaching applications are deliberately separate from clients. A lead
// becomes a client only after the coach explicitly approves the conversion.
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  country: text("country").notNull().default(""),
  goal: text("goal").notNull().default("General fitness"),
  // Extra objectives from the multi-goal application wizard: JSON array of
  // canonical goal values (lead.goal stays the PRIMARY objective). "[]" when
  // the prospect selected only one goal. Kept structured, never comma-crammed.
  secondaryGoals: text("secondary_goals").notNull().default("[]"),
  // Set when a former client's durable lead reopens as a fresh application
  // (converted lead whose client was removed). Ordering/"applied" labels use
  // COALESCE(reappliedAt, createdAt) so the reapplication surfaces as new while
  // the original createdAt stays preserved as history.
  reappliedAt: timestamp("reapplied_at", { withTimezone: true }),
  experience: text("experience").notNull().default(""),
  trainingDays: integer("training_days").notNull().default(3),
  coachingFormat: text("coaching_format").notNull().default("Online"),
  contactPreference: text("contact_preference").notNull().default("WhatsApp"),
  preferredLanguage: text("preferred_language").notNull().default("fr"),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("new"),
  coachNotes: text("coach_notes").notNull().default(""),
  acquisitionSource: text("acquisition_source").notNull().default("Direct"),
  acquisitionMedium: text("acquisition_medium").notNull().default("direct"),
  acquisitionCampaign: text("acquisition_campaign").notNull().default(""),
  acquisitionReferrer: text("acquisition_referrer").notNull().default(""),
  acquisitionLandingPage: text("acquisition_landing_page").notNull().default(""),
  fingerprint: text("fingerprint").notNull().default(""),
  convertedClientId: integer("converted_client_id").references(() => clients.id, { onDelete: "set null" }),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("leads_status_created_idx").on(table.status, table.createdAt),
  index("leads_fingerprint_created_idx").on(table.fingerprint, table.createdAt),
  // One durable lead record per normalized (trimmed, lowercased) email. The
  // expression is unique so a resubmission cannot create a duplicate, and the
  // partial predicate ignores empty emails (matching clients_email_lower_unique).
  uniqueIndex("leads_email_lower_unique").on(sql`lower(trim(${table.email}))`).where(sql`trim(${table.email}) <> ''`),
]);

export const leadActivities = pgTable("lead_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull().default("note"),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [index("lead_activities_lead_created_idx").on(table.leadId, table.createdAt)]);

export const leadConsultations = pgTable("lead_consultations", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  status: text("status").notNull().default("scheduled"),
  outcome: text("outcome").notNull().default(""),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("lead_consultations_owner_start_idx").on(table.ownerId, table.startAt),
  index("lead_consultations_lead_idx").on(table.leadId),
]);

export const checkIns = pgTable("check_ins", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  weight: doublePrecision("weight"),
  energy: integer("energy").notNull(),
  sleep: integer("sleep").notNull(),
  stress: integer("stress").notNull(),
  adherence: integer("adherence").notNull(),
  notes: text("notes").notNull().default(""),
  aiSummary: text("ai_summary").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [index("check_ins_client_owner_idx").on(table.clientId, table.ownerId)]);

export const programmes = pgTable("programmes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  sessionsPerWeek: integer("sessions_per_week").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: createdAt(),
}, (table) => [index("programmes_client_owner_idx").on(table.clientId, table.ownerId)]);

export const exerciseLibrary = pgTable("exercise_library", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  // Optional per-language display names. `name` is the canonical English
  // label; blank translations fall back to it at render time.
  nameFr: text("name_fr").notNull().default(""),
  nameAr: text("name_ar").notNull().default(""),
  muscleGroup: text("muscle_group").notNull().default("Other"),
  equipment: text("equipment").notNull().default("Other"),
  instructions: text("instructions").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  videoUrl: text("video_url").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [index("exercise_library_owner_name_idx").on(table.ownerId, table.name)]);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  status: text("status").notNull().default("scheduled"),
  pulseToken: text("pulse_token").notNull().unique(),
  readinessLevel: text("readiness_level").notNull().default("pending"),
  readinessScore: integer("readiness_score"),
  energy: integer("energy"),
  sleep: integer("sleep"),
  soreness: integer("soreness"),
  stress: integer("stress"),
  pain: boolean("pain").notNull().default(false),
  painArea: text("pain_area").notNull().default(""),
  note: text("note").notNull().default(""),
  // Coach booking notes (reschedule history is kept in the activity trail via
  // the note field when the coach records it); the Pulse `note` above stays the
  // client's own readiness note.
  notes: text("notes").notNull().default(""),
  aiSummary: text("ai_summary").notNull().default(""),
  coachAction: text("coach_action").notNull().default(""),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("sessions_owner_start_idx").on(table.ownerId, table.startAt),
  index("sessions_client_idx").on(table.clientId),
]);

// Auditable session-credit ledger. The current balance is derived from
// SUM(delta) rather than a cached counter, so every credit added, consumed or
// restored is a permanent row. One charge per session is enforced by the
// partial unique index on (related_session_id, reason) - a double-click or
// retry can never debit a session twice.
export const sessionCreditLedger = pgTable("session_credit_ledger", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  relatedSessionId: integer("related_session_id").references(() => sessions.id, { onDelete: "set null" }),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [
  index("session_credit_ledger_client_created_idx").on(table.clientId, table.createdAt),
  index("session_credit_ledger_owner_idx").on(table.ownerId),
  uniqueIndex("session_credit_ledger_session_reason_unique")
    .on(table.relatedSessionId, table.reason)
    .where(sql`${table.relatedSessionId} IS NOT NULL`),
]);

export const progressEntries = pgTable("progress_entries", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  submittedBy: text("submitted_by").notNull().default("client"),
  weight: doublePrecision("weight"),
  waist: doublePrecision("waist"),
  chest: doublePrecision("chest"),
  hips: doublePrecision("hips"),
  arm: doublePrecision("arm"),
  thigh: doublePrecision("thigh"),
  energy: integer("energy").notNull().default(5),
  sleep: integer("sleep").notNull().default(5),
  adherence: integer("adherence").notNull().default(0),
  notes: text("notes").notNull().default(""),
  photoData: text("photo_data").notNull().default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [index("progress_entries_client_owner_idx").on(table.clientId, table.ownerId, table.createdAt)]);

// Canonical append-only ledger for measured body-composition data. One row per
// measurement event - history is never collapsed or overwritten. The table holds
// measured body data ONLY: demographic/profile fields (age, sex, onboarding
// snapshot) deliberately stay in `client_intakes.profile`, and
// `clients.currentWeight` remains the denormalized latest-weight cache used by
// existing roster UI. Values are nullable because a measurement rarely captures
// every metric; conservative range validation lives in the domain layer
// (app/lib/body-measurements.ts), never here - raw measurements are stored as
// entered, not clamped. No uniqueness constraint on (client, measuredAt):
// multiple legitimate measurements may exist historically.
export const clientBodyMeasurements = pgTable("client_body_measurements", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
  weightKg: doublePrecision("weight_kg"),
  bodyFatPercent: doublePrecision("body_fat_percent"),
  leanMassKg: doublePrecision("lean_mass_kg"),
  waistCm: doublePrecision("waist_cm"),
  chestCm: doublePrecision("chest_cm"),
  hipsCm: doublePrecision("hips_cm"),
  armCm: doublePrecision("arm_cm"),
  thighCm: doublePrecision("thigh_cm"),
  source: text("source").notNull().default("coach"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [
  index("client_body_measurements_owner_client_idx").on(table.ownerId, table.clientId),
  index("client_body_measurements_owner_client_measured_idx").on(table.ownerId, table.clientId, table.measuredAt),
]);

// Kept deliberately small: this is coaching context, not a medical record.
// Clients may share only what they choose; explicit consent is required before saving.
// `readinessReviewedAt` is set by the coach once limitations have been reviewed
// before programme assignment; `coachNotes` is private coach context and is
// never exposed through the client-facing intake DTO.
export const clientIntakes = pgTable("client_intakes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  preferredLanguage: text("preferred_language").notNull().default("fr"),
  trainingExperience: text("training_experience").notNull().default(""),
  availability: text("availability").notNull().default(""),
  equipment: text("equipment").notNull().default(""),
  goalsDetail: text("goals_detail").notNull().default(""),
  trainingConsiderations: text("training_considerations").notNull().default(""),
  // Structured onboarding survey V2 (JSON). The critical flat fields above
  // (trainingExperience, availability, equipment, goalsDetail,
  // trainingConsiderations) are derived from this profile on every client save,
  // so existing consumers keep working unchanged. `profile` is client-reported
  // coaching context only - never a medical record.
  profile: text("profile").notNull().default("{}"),
  readinessReviewedAt: timestamp("readiness_reviewed_at", { withTimezone: true }),
  coachNotes: text("coach_notes").notNull().default(""),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [index("client_intakes_owner_client_idx").on(table.ownerId, table.clientId)]);

// A completed workout is intentionally separate from an appointment/Pulse session.
// The JSON snapshot keeps every set, note and exercise adjustment exactly as coached that day.
export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  programmeId: integer("programme_id").references(() => programmes.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  exercises: text("exercises").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("active"),
  startedBy: text("started_by").notNull().default("coach"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("workout_sessions_owner_client_idx").on(table.ownerId, table.clientId),
  index("workout_sessions_active_idx").on(table.ownerId, table.clientId, table.status),
  index("workout_sessions_completed_idx").on(table.clientId, table.completedAt),
]);

// Coach alerts are generated from existing coaching activity. The composite
// unique key makes every alert idempotent, even when the dashboard refreshes.
export const coachNotifications = pgTable("coach_notifications", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  actionHref: text("action_href").notNull().default("#overview"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("coach_notifications_owner_key_unique").on(table.ownerId, table.dedupeKey),
  index("coach_notifications_owner_created_idx").on(table.ownerId, table.createdAt),
]);

// This is an operational contact history, not a copy of private conversations.
// It records what was prepared/opened/sent so follow-ups are not duplicated.
// Exercise Intelligence V2 - coach decision learning. Aggregate-only preference
// memory: explicit coach preferences plus deterministic learned counters derived
// from coach actions (replace/remove/add/approve). Owner-scoped and
// client-scoped; canonical exercise ids are validated at the API layer (built-in
// catalogue ids or stable custom-<n> ids). These are PREFERENCES, never medical
// restrictions - the coach remains the final authority and one action never
// bans an exercise. `client_exercise_events` is a tiny dedupe ledger so a
// retried operation (same operationKey) can never inflate a count.
export const clientExercisePreferences = pgTable("client_exercise_preferences", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull(),
  explicitState: text("explicit_state").notNull().default("neutral"),
  positiveScore: integer("positive_score").notNull().default(0),
  negativeScore: integer("negative_score").notNull().default(0),
  replacementInCount: integer("replacement_in_count").notNull().default(0),
  replacementOutCount: integer("replacement_out_count").notNull().default(0),
  manualAddCount: integer("manual_add_count").notNull().default(0),
  manualRemoveCount: integer("manual_remove_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  lastPositiveAt: timestamp("last_positive_at", { withTimezone: true }),
  lastNegativeAt: timestamp("last_negative_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("client_exercise_preferences_owner_client_idx").on(table.ownerId, table.clientId),
  uniqueIndex("client_exercise_preferences_owner_client_exercise_unique").on(table.ownerId, table.clientId, table.exerciseId),
]);

export const clientExerciseReplacements = pgTable("client_exercise_replacements", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  fromExerciseId: text("from_exercise_id").notNull(),
  toExerciseId: text("to_exercise_id").notNull(),
  count: integer("count").notNull().default(1),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("client_exercise_replacements_owner_client_idx").on(table.ownerId, table.clientId),
  uniqueIndex("client_exercise_replacements_owner_client_pair_unique").on(table.ownerId, table.clientId, table.fromExerciseId, table.toExerciseId),
]);

// Dedupe ledger: one row per processed operationKey, so a retried request can
// never double-count a coach action (same pattern as coach_notifications.
// dedupe_key).
export const clientExerciseEvents = pgTable("client_exercise_events", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  operationKey: text("operation_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("client_exercise_events_owner_key_unique").on(table.ownerId, table.operationKey),
]);

// Exercise Intelligence V2.1 - structured client exercise feedback. Append-only
// history (never collapsed into one mutable row) so a client's experience across
// sessions stays visible: liked today, too hard last week, confident later.
// Feedback is a coaching signal, kept strictly separate from coach preference
// (client_exercise_preferences) and from health/limitation/pain information
// (the session Pulse flags). "Uncomfortable" is coaching feedback only - never
// a diagnosis, never an automatic exclusion. Each dimension is optional so a
// client may send a single signal (e.g. just sentiment). `operationKey` makes a
// retried submission idempotent; the unique (owner, client, operationKey) guard
// means the same UI action can never create a duplicate row. The coach remains
// the final authority - feedback never writes the preference tables.
export const clientExerciseFeedback = pgTable("client_exercise_feedback", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull(),
  workoutSessionId: integer("workout_session_id").references(() => workoutSessions.id, { onDelete: "set null" }),
  programmeId: integer("programme_id").references(() => programmes.id, { onDelete: "set null" }),
  sentiment: text("sentiment"),
  comfort: text("comfort"),
  difficulty: text("difficulty"),
  confidence: text("confidence"),
  comment: text("comment").notNull().default(""),
  source: text("source").notNull().default("client_portal"),
  operationKey: text("operation_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("client_exercise_feedback_owner_client_idx").on(table.ownerId, table.clientId),
  index("client_exercise_feedback_client_exercise_idx").on(table.clientId, table.exerciseId, table.createdAt),
  uniqueIndex("client_exercise_feedback_owner_client_key_unique").on(table.ownerId, table.clientId, table.operationKey),
]);

export const communicationLogs = pgTable("communication_logs", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  recipientName: text("recipient_name").notNull(),
  recipientAddress: text("recipient_address").notNull().default(""),
  channel: text("channel").notNull().default("whatsapp"),
  language: text("language").notNull().default("fr"),
  subject: text("subject").notNull(),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("prepared"),
  relatedType: text("related_type").notNull().default("manual"),
  relatedId: integer("related_id"),
  relatedKey: text("related_key").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [
  index("communication_logs_owner_created_idx").on(table.ownerId, table.createdAt),
  index("communication_logs_related_idx").on(table.ownerId, table.relatedKey),
]);

// Nutrition Foundations V1 / Phase 2D - coach-approved nutrition targets.
//
// This is a coach DECISION layer, deliberately separate from the deterministic
// engine estimate (app/lib/nutrition-engine.ts). A row is the numeric targets a
// coach reviewed and approved (possibly adjusted by hand); the engine keeps
// recalculating fresh estimates from current inputs without ever touching these.
// Append-only history: approving a new target supersedes the previous active row
// (never deletes it). Provenance columns capture the SERVER-recomputed engine
// estimate that informed the approval so a future review can explain "these
// targets were based on TDEE X at Y kg", and so the UI can flag when the current
// estimate has since drifted. No demographic duplication (age/sex/height) is
// stored - that stays in client_intakes.profile; only the engine OUTPUT
// provenance needed for audit + drift detection is snapshotted. The partial
// unique index enforces at most ONE active (status='approved') row per
// owner+client at the database level.
export const nutritionTargets = pgTable("nutrition_targets", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  // "approved" (active) | "superseded" (historical). New approvals supersede
  // the previous active row; rows are never deleted.
  status: text("status").notNull().default("approved"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  // Coach-approved numeric targets (may differ from the engine estimate).
  calorieMinKcal: doublePrecision("calorie_min_kcal").notNull(),
  calorieMaxKcal: doublePrecision("calorie_max_kcal").notNull(),
  proteinMinGrams: doublePrecision("protein_min_grams").notNull(),
  proteinMaxGrams: doublePrecision("protein_max_grams").notNull(),
  fatMinGrams: doublePrecision("fat_min_grams").notNull(),
  fatMaxGrams: doublePrecision("fat_max_grams").notNull(),
  carbohydrateMinGrams: doublePrecision("carbohydrate_min_grams").notNull(),
  carbohydrateMaxGrams: doublePrecision("carbohydrate_max_grams").notNull(),
  // Server-recomputed engine provenance at approval time (audit + drift).
  sourceEstimatedBmrKcal: doublePrecision("source_estimated_bmr_kcal"),
  sourceEstimatedTdeeKcal: doublePrecision("source_estimated_tdee_kcal"),
  sourceCalorieMinKcal: doublePrecision("source_calorie_min_kcal"),
  sourceCalorieMaxKcal: doublePrecision("source_calorie_max_kcal"),
  sourceActivityFactor: doublePrecision("source_activity_factor"),
  sourceGoal: text("source_goal").notNull().default(""),
  sourceWeightKg: doublePrecision("source_weight_kg"),
  sourceWeightSource: text("source_weight_source"),
  engineVersion: text("engine_version").notNull().default(""),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index("nutrition_targets_owner_client_idx").on(table.ownerId, table.clientId),
  index("nutrition_targets_owner_client_status_idx").on(table.ownerId, table.clientId, table.status),
  index("nutrition_targets_owner_client_approved_idx").on(table.ownerId, table.clientId, table.approvedAt),
  uniqueIndex("nutrition_targets_owner_client_active_unique")
    .on(table.ownerId, table.clientId)
    .where(sql`${table.status} = 'approved'`),
]);

// Meal Builder V2 Phase 2B - persisted meal plans with immutable versions.
//
// A meal plan is a logical container per (owner, client). Its content lives in
// append-only versions: one mutable draft at a time, frozen approved snapshots
// forever. Nothing becomes client-visible through these tables until a coach
// BOTH approves a version AND creates an active assignment - AI generation,
// optimizer runs and draft saves never publish anything on their own.
//
// Snapshots are deliberately denormalized JSON: an approved version must stay
// historically meaningful even when the CIQUAL catalogue, nutrition formulas
// or the client's current approved target change later. Approved versions are
// never mutated; editing clones the latest version into a new draft.
export const mealPlans = pgTable("meal_plans", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull().default("Nutrition Plan"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("meal_plans_owner_client_idx").on(table.ownerId, table.clientId),
]);

export const mealPlanVersions = pgTable("meal_plan_versions", {
  id: serial("id").primaryKey(),
  mealPlanId: integer("meal_plan_id").notNull().references(() => mealPlans.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  // Sequential per plan; the unique index below means two concurrent saves can
  // never both claim version N.
  versionNumber: integer("version_number").notNull(),
  // "draft" | "approved" | "superseded". Approval freezes every snapshot
  // column permanently; drafts may be overwritten until approved.
  status: text("status").notNull().default("draft"),
  mealsSnapshot: text("meals_snapshot").notNull(),
  nutritionSnapshot: text("nutrition_snapshot").notNull(),
  approvedTargetSnapshot: text("approved_target_snapshot").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meal_plan_versions_plan_number_unique").on(table.mealPlanId, table.versionNumber),
  index("meal_plan_versions_owner_plan_idx").on(table.ownerId, table.mealPlanId),
  index("meal_plan_versions_plan_status_idx").on(table.mealPlanId, table.status),
]);

// -----------------------------------------------------------------
// Self-service "Jonas Fitness Progress" training log domain.
//
// Deliberately separate from the coach-owned domain. Every self-service
// routine/workout belongs to the ATHLETE'S OWN Clerk user id (`ownerId`), not
// to a coach. The coach tables (clients, workoutSessions, programmes) are all
// scoped to a coach's `ownerId` and require a `clientId` FK into a coach-owned
// `clients` row, so a self-directed athlete with no coach cannot reuse them
// without polluting the coaching domain. The workout history is stored as a
// JSON snapshot of the same `WorkoutExercise[]` shape used by the existing
// workout engine (app/lib/workouts.ts), so the parsed-workout, normalisation,
// stats and exercise-history logic is shared unchanged and historical data is
// immutable: editing or deleting a routine never rewrites what was logged.
// Metric units are the Phase 1 default; `weight_unit` (kg|lb) is stored per
// prescription from day one so imperial support can be added safely later.

// A self-service athlete's routine template (a training day: e.g. Push).
export const trainingRoutines = pgTable("training_routines", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [index("training_routines_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

// One prescription per exercise inside a routine template: working-set count
// and target rep range (double progression). `position` preserves explicit
// exercise ordering; the unique (routine_id, position) constraint prevents two
// exercises claiming the same slot even under a concurrent reorder.
export const trainingRoutineExercises = pgTable("training_routine_exercises", {
  id: serial("id").primaryKey(),
  routineId: integer("routine_id").notNull().references(() => trainingRoutines.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  position: integer("position").notNull(),
  // Canonical built-in catalogue id (builtin-*) or a stable custom-* slug.
  exerciseId: text("exercise_id").notNull(),
  name: text("name").notNull(),
  nameFr: text("name_fr").notNull().default(""),
  nameAr: text("name_ar").notNull().default(""),
  sets: integer("sets").notNull().default(3),
  targetRepMin: integer("target_rep_min").notNull().default(8),
  targetRepMax: integer("target_rep_max").notNull().default(12),
  targetRir: integer("target_rir").notNull().default(2),
  weightUnit: text("weight_unit").notNull().default("kg"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [
  index("training_routine_exercises_owner_routine_idx").on(table.ownerId, table.routineId),
  uniqueIndex("training_routine_exercises_routine_position_unique").on(table.routineId, table.position),
]);

// A started/completed self-service workout. `exercises` is an immutable JSON
// snapshot of the logged sets. `routine_id` is set-null on routine deletion so
// the training history always survives routine edits/deletes. `weight_unit`
// reflects the routine prescription used when this workout was started (kg by
// default); the trainer enters weight in that same unit.
export const trainingWorkoutSessions = pgTable("training_workout_sessions", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  routineId: integer("routine_id").references(() => trainingRoutines.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  exercises: text("exercises").notNull().default("[]"),
  weightUnit: text("weight_unit").notNull().default("kg"),
  notes: text("notes").notNull().default(""),
  // active | completed | discarded
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("training_workout_sessions_owner_status_idx").on(table.ownerId, table.status),
  index("training_workout_sessions_owner_routine_completed_idx").on(table.ownerId, table.routineId, table.completedAt),
]);

// Current + historical client assignments. History rows are never deleted;
// assigning a new version deactivates the previous active row inside one
// transaction. The partial unique index guarantees at most ONE active
// assignment per client across ALL plans - the database itself rejects a
// double-assign race even if service logic were bypassed.
export const mealPlanAssignments = pgTable("meal_plan_assignments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  mealPlanId: integer("meal_plan_id").notNull().references(() => mealPlans.id, { onDelete: "cascade" }),
  mealPlanVersionId: integer("meal_plan_version_id").notNull().references(() => mealPlanVersions.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("meal_plan_assignments_owner_client_idx").on(table.ownerId, table.clientId),
  index("meal_plan_assignments_client_active_idx").on(table.clientId, table.active),
  uniqueIndex("meal_plan_assignments_client_active_unique")
    .on(table.clientId)
    .where(sql`${table.active} = true`),
]);

// -----------------------------------------------------------------
// Phase 2 - Jonas Fitness Progress commercial layer (Founding Access).
//
// Three minimal, provider-faithful tables drive the paid validation loop:
//  - A commerce order ledger keyed by the Stripe session id, recording every
//    purchase attempt and its amount/currency in integer minor units.
//  - A product entitlement ledger granting `progress_founding` on authoritative
//    payment confirmation, with at most ONE active entitlement per owner+product
//    enforced by a partial unique index; `revoked_at` supersedes (never deletes).
//  - An append-only webhook idempotency trail so a replayed Stripe event can
//    never double-grant.
// Ownership is always the ATHLETE'S OWN Clerk user id, resolved server-side
// only - never from the browser. The provider (Stripe) remains authoritative
// for amounts, currency and tax treatment.

// One commerce order per purchase attempt. `provider_checkout_id` is the unique
// Stripe Checkout Session id (a provider identifier requiring idempotency).
// Amounts are integer minor units (cents). No payment/card details ever stored.
export const commerceOrders = pgTable("commerce_orders", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  productKey: text("product_key").notNull(),
  provider: text("provider").notNull().default("stripe"),
  // Unique Stripe Checkout Session id - idempotency anchor + audit.
  providerCheckoutId: text("provider_checkout_id").notNull(),
  // Stripe PaymentIntent / Payment id once known (null until paid).
  providerPaymentId: text("provider_payment_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("eur"),
  // created | paid | refunded | failed | canceled
  status: text("status").notNull().default("created"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("commerce_orders_owner_created_idx").on(table.ownerId, table.createdAt),
  uniqueIndex("commerce_orders_provider_checkout_unique").on(table.provider, table.providerCheckoutId),
]);

// One active entitlement per owner+product is enforced at the database level
// by the partial unique index so a double-grant (webhook replay, manual seed)
// is impossible even if service logic is bypassed. `source` records how the
// entitlement arrived (stripe_checkout | manual_test | grant). A grant is
// superseded by setting `revoked_at` / flipping status to "revoked" rather than
// deleting - the commerce order that sourced it stays intact for audit.
export const productEntitlements = pgTable("product_entitlements", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  productKey: text("product_key").notNull(),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("stripe_checkout"),
  orderId: integer("order_id").references(() => commerceOrders.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("product_entitlements_owner_idx").on(table.ownerId),
  // UNIQUENESS is enforced ONLY by the partial index below: at most one ACTIVE
  // entitlement per (owner, product). A revoked/superseded row must not block a
  // later legitimate re-grant, so there is deliberately NO broad unique on
  // (owner, product) - "refund → revoked → later purchase again → active".
  uniqueIndex("product_entitlements_owner_product_active_unique")
    .on(table.ownerId, table.productKey)
    .where(sql`${table.status} = 'active'`),
]);

// Idempotency trail for consumed provider webhook events.
// `provider_event_id` is unique so a Stripe retry (Stripe retries signatures a
// few times on transient failures) or a manual re-delivery is processed once.
// Full payloads are NOT stored - only the id, type and outcome.
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("stripe"),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  outcome: text("outcome").notNull().default("processed"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("payment_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("payment_webhook_events_provider_type_idx").on(table.provider, table.eventType),
]);

// Minimal first-party validation analytics. We deliberately avoided a third-party
// analytics vendor; this append-only table records only a tiny authenticated
// funnel (offer viewed, checkout started, purchase completed, activation). Each
// row is deduplicated by a (owner, name, key) guard so retries never double-count
// a real activation event. No PII beyond the server-resolved owner id.
export const validationEvents = pgTable("validation_events", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  eventName: text("event_name").notNull(),
  dedupeKey: text("dedupe_key").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [
  index("validation_events_owner_created_idx").on(table.ownerId, table.createdAt),
  uniqueIndex("validation_events_owner_name_key_unique").on(table.ownerId, table.eventName, table.dedupeKey),
]);
