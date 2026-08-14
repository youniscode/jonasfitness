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
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT 'Build muscle' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sessions_per_week" integer DEFAULT 4 NOT NULL,
	"current_weight" double precision,
	"adherence" integer DEFAULT 0 NOT NULL,
	"next_check_in" text,
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
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_client_owner_idx" ON "check_ins" USING btree ("client_id","owner_id");--> statement-breakpoint
CREATE INDEX "clients_owner_id_idx" ON "clients" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "programmes_client_owner_idx" ON "programmes" USING btree ("client_id","owner_id");--> statement-breakpoint
CREATE INDEX "sessions_owner_start_idx" ON "sessions" USING btree ("owner_id","start_at");--> statement-breakpoint
CREATE INDEX "sessions_client_idx" ON "sessions" USING btree ("client_id");