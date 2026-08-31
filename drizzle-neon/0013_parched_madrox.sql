CREATE TABLE "training_routine_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"routine_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"position" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"name" text NOT NULL,
	"name_fr" text DEFAULT '' NOT NULL,
	"name_ar" text DEFAULT '' NOT NULL,
	"sets" integer DEFAULT 3 NOT NULL,
	"target_rep_min" integer DEFAULT 8 NOT NULL,
	"target_rep_max" integer DEFAULT 12 NOT NULL,
	"target_rir" integer DEFAULT 2 NOT NULL,
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_routines" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_workout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"routine_id" integer,
	"title" text NOT NULL,
	"exercises" text DEFAULT '[]' NOT NULL,
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_routine_exercises" ADD CONSTRAINT "training_routine_exercises_routine_id_training_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."training_routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workout_sessions" ADD CONSTRAINT "training_workout_sessions_routine_id_training_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."training_routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_routine_exercises_owner_routine_idx" ON "training_routine_exercises" USING btree ("owner_id","routine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_routine_exercises_routine_position_unique" ON "training_routine_exercises" USING btree ("routine_id","position");--> statement-breakpoint
CREATE INDEX "training_routines_owner_updated_idx" ON "training_routines" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "training_workout_sessions_owner_status_idx" ON "training_workout_sessions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "training_workout_sessions_owner_routine_completed_idx" ON "training_workout_sessions" USING btree ("owner_id","routine_id","completed_at");