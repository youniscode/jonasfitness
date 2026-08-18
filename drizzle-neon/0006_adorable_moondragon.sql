CREATE TABLE "client_exercise_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"workout_session_id" integer,
	"programme_id" integer,
	"sentiment" text,
	"comfort" text,
	"difficulty" text,
	"confidence" text,
	"comment" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'client_portal' NOT NULL,
	"operation_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_exercise_feedback" ADD CONSTRAINT "client_exercise_feedback_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exercise_feedback" ADD CONSTRAINT "client_exercise_feedback_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exercise_feedback" ADD CONSTRAINT "client_exercise_feedback_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_exercise_feedback_owner_client_idx" ON "client_exercise_feedback" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "client_exercise_feedback_client_exercise_idx" ON "client_exercise_feedback" USING btree ("client_id","exercise_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_exercise_feedback_owner_client_key_unique" ON "client_exercise_feedback" USING btree ("owner_id","client_id","operation_key");