CREATE TABLE "check_ins" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"weight" double precision,
	"energy" integer NOT NULL,
	"sleep" integer NOT NULL,
	"stress" integer NOT NULL,
	"adherence" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"ai_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_intakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"preferred_language" text DEFAULT 'fr' NOT NULL,
	"training_experience" text DEFAULT '' NOT NULL,
	"availability" text DEFAULT '' NOT NULL,
	"equipment" text DEFAULT '' NOT NULL,
	"goals_detail" text DEFAULT '' NOT NULL,
	"training_considerations" text DEFAULT '' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_intakes_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT 'Build muscle' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sessions_per_week" integer DEFAULT 4 NOT NULL,
	"current_weight" double precision,
	"adherence" integer DEFAULT 0 NOT NULL,
	"next_check_in" text,
	"acquisition_source" text DEFAULT 'Unknown' NOT NULL,
	"acquisition_medium" text DEFAULT '' NOT NULL,
	"acquisition_campaign" text DEFAULT '' NOT NULL,
	"acquisition_referrer" text DEFAULT '' NOT NULL,
	"acquisition_landing_page" text DEFAULT '' NOT NULL,
	"acquisition_captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"action_href" text DEFAULT '#overview' NOT NULL,
	"client_id" integer,
	"lead_id" integer,
	"scheduled_for" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" integer,
	"lead_id" integer,
	"recipient_name" text NOT NULL,
	"recipient_address" text DEFAULT '' NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"subject" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"related_type" text DEFAULT 'manual' NOT NULL,
	"related_id" integer,
	"related_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"muscle_group" text DEFAULT 'Other' NOT NULL,
	"equipment" text DEFAULT 'Other' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"video_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"type" text DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_consultations" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT 'General fitness' NOT NULL,
	"experience" text DEFAULT '' NOT NULL,
	"training_days" integer DEFAULT 3 NOT NULL,
	"coaching_format" text DEFAULT 'Online' NOT NULL,
	"contact_preference" text DEFAULT 'WhatsApp' NOT NULL,
	"preferred_language" text DEFAULT 'fr' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"coach_notes" text DEFAULT '' NOT NULL,
	"acquisition_source" text DEFAULT 'Direct' NOT NULL,
	"acquisition_medium" text DEFAULT 'direct' NOT NULL,
	"acquisition_campaign" text DEFAULT '' NOT NULL,
	"acquisition_referrer" text DEFAULT '' NOT NULL,
	"acquisition_landing_page" text DEFAULT '' NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"converted_client_id" integer,
	"consent_at" timestamp with time zone NOT NULL,
	"contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"sessions_per_week" integer NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"submitted_by" text DEFAULT 'client' NOT NULL,
	"weight" double precision,
	"waist" double precision,
	"chest" double precision,
	"hips" double precision,
	"arm" double precision,
	"thigh" double precision,
	"energy" integer DEFAULT 5 NOT NULL,
	"sleep" integer DEFAULT 5 NOT NULL,
	"adherence" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"photo_data" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"pulse_token" text NOT NULL,
	"readiness_level" text DEFAULT 'pending' NOT NULL,
	"readiness_score" integer,
	"energy" integer,
	"sleep" integer,
	"soreness" integer,
	"stress" integer,
	"pain" boolean DEFAULT false NOT NULL,
	"pain_area" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ai_summary" text DEFAULT '' NOT NULL,
	"coach_action" text DEFAULT '' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_pulse_token_unique" UNIQUE("pulse_token")
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"programme_id" integer,
	"title" text NOT NULL,
	"exercises" text DEFAULT '[]' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_by" text DEFAULT 'coach' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD CONSTRAINT "client_intakes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_consultations" ADD CONSTRAINT "lead_consultations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_clients_id_fk" FOREIGN KEY ("converted_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_client_owner_idx" ON "check_ins" USING btree ("client_id","owner_id");--> statement-breakpoint
CREATE INDEX "client_intakes_owner_client_idx" ON "client_intakes" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "clients_owner_id_idx" ON "clients" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_email_lower_unique" ON "clients" USING btree (lower("email")) WHERE "clients"."email" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "coach_notifications_owner_key_unique" ON "coach_notifications" USING btree ("owner_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "coach_notifications_owner_created_idx" ON "coach_notifications" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_logs_owner_created_idx" ON "communication_logs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_logs_related_idx" ON "communication_logs" USING btree ("owner_id","related_key");--> statement-breakpoint
CREATE INDEX "exercise_library_owner_name_idx" ON "exercise_library" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_created_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_consultations_owner_start_idx" ON "lead_consultations" USING btree ("owner_id","start_at");--> statement-breakpoint
CREATE INDEX "lead_consultations_lead_idx" ON "lead_consultations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_fingerprint_created_idx" ON "leads" USING btree ("fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "programmes_client_owner_idx" ON "programmes" USING btree ("client_id","owner_id");--> statement-breakpoint
CREATE INDEX "progress_entries_client_owner_idx" ON "progress_entries" USING btree ("client_id","owner_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_owner_start_idx" ON "sessions" USING btree ("owner_id","start_at");--> statement-breakpoint
CREATE INDEX "sessions_client_idx" ON "sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_owner_client_idx" ON "workout_sessions" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_active_idx" ON "workout_sessions" USING btree ("owner_id","client_id","status");--> statement-breakpoint
CREATE INDEX "workout_sessions_completed_idx" ON "workout_sessions" USING btree ("client_id","completed_at");