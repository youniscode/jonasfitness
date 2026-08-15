import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  goal: text("goal").notNull().default("Build muscle"),
  status: text("status").notNull().default("active"),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(4),
  currentWeight: doublePrecision("current_weight"),
  adherence: integer("adherence").notNull().default(0),
  nextCheckIn: text("next_check_in"),
  createdAt: createdAt(),
}, (table) => [index("clients_owner_id_idx").on(table.ownerId)]);

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
  createdAt: createdAt(),
}, (table) => [index("progress_entries_client_owner_idx").on(table.clientId, table.ownerId, table.createdAt)]);

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
  startedAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: createdAt(),
}, (table) => [
  index("workout_sessions_owner_client_idx").on(table.ownerId, table.clientId),
  index("workout_sessions_active_idx").on(table.ownerId, table.clientId, table.status),
  index("workout_sessions_completed_idx").on(table.clientId, table.completedAt),
]);
