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
}, (table) => [index("clients_owner_id_idx").on(table.ownerId)]);

// Public coaching applications are deliberately separate from clients. A lead
// becomes a client only after the coach explicitly approves the conversion.
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  country: text("country").notNull().default(""),
  goal: text("goal").notNull().default("General fitness"),
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
  aiSummary: text("ai_summary").notNull().default(""),
  coachAction: text("coach_action").notNull().default(""),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("sessions_owner_start_idx").on(table.ownerId, table.startAt),
  index("sessions_client_idx").on(table.clientId),
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

// Kept deliberately small: this is coaching context, not a medical record.
// Clients may share only what they choose; explicit consent is required before saving.
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
