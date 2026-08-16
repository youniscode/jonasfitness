ALTER TABLE "client_intakes" ADD COLUMN "readiness_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD COLUMN "coach_notes" text DEFAULT '' NOT NULL;