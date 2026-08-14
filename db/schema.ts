import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }), ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(), email: text("email").notNull().default(""), goal: text("goal").notNull().default("Build muscle"),
  status: text("status").notNull().default("active"), sessionsPerWeek: integer("sessions_per_week").notNull().default(4),
  currentWeight: real("current_weight"), adherence: integer("adherence").notNull().default(0), nextCheckIn: text("next_check_in"),
  createdAt: text("created_at").notNull(),
});

export const checkIns = sqliteTable("check_ins", {
  id: integer("id").primaryKey({ autoIncrement: true }), clientId: integer("client_id").notNull(), ownerEmail: text("owner_email").notNull(),
  weight: real("weight"), energy: integer("energy").notNull(), sleep: integer("sleep").notNull(), stress: integer("stress").notNull(),
  adherence: integer("adherence").notNull(), notes: text("notes").notNull().default(""), aiSummary: text("ai_summary").notNull().default(""), createdAt: text("created_at").notNull(),
});

export const programmes = sqliteTable("programmes", {
  id: integer("id").primaryKey({ autoIncrement: true }), clientId: integer("client_id").notNull(), ownerEmail: text("owner_email").notNull(),
  title: text("title").notNull(), goal: text("goal").notNull(), sessionsPerWeek: integer("sessions_per_week").notNull(),
  content: text("content").notNull(), status: text("status").notNull().default("draft"), createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }), clientId: integer("client_id").notNull(), ownerEmail: text("owner_email").notNull(),
  startAt: text("start_at").notNull(), durationMinutes: integer("duration_minutes").notNull().default(60), status: text("status").notNull().default("scheduled"),
  pulseToken: text("pulse_token").notNull().unique(), readinessLevel: text("readiness_level").notNull().default("pending"), readinessScore: integer("readiness_score"),
  energy: integer("energy"), sleep: integer("sleep"), soreness: integer("soreness"), stress: integer("stress"), pain: integer("pain").notNull().default(0),
  painArea: text("pain_area").notNull().default(""), note: text("note").notNull().default(""), aiSummary: text("ai_summary").notNull().default(""),
  coachAction: text("coach_action").notNull().default(""), respondedAt: text("responded_at"), createdAt: text("created_at").notNull(),
});
