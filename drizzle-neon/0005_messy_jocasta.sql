CREATE TABLE "client_exercise_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_exercise_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"explicit_state" text DEFAULT 'neutral' NOT NULL,
	"positive_score" integer DEFAULT 0 NOT NULL,
	"negative_score" integer DEFAULT 0 NOT NULL,
	"replacement_in_count" integer DEFAULT 0 NOT NULL,
	"replacement_out_count" integer DEFAULT 0 NOT NULL,
	"manual_add_count" integer DEFAULT 0 NOT NULL,
	"manual_remove_count" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"last_positive_at" timestamp with time zone,
	"last_negative_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_exercise_replacements" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" integer NOT NULL,
	"from_exercise_id" text NOT NULL,
	"to_exercise_id" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_exercise_preferences" ADD CONSTRAINT "client_exercise_preferences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exercise_replacements" ADD CONSTRAINT "client_exercise_replacements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_exercise_events_owner_key_unique" ON "client_exercise_events" USING btree ("owner_id","operation_key");--> statement-breakpoint
CREATE INDEX "client_exercise_preferences_owner_client_idx" ON "client_exercise_preferences" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_exercise_preferences_owner_client_exercise_unique" ON "client_exercise_preferences" USING btree ("owner_id","client_id","exercise_id");--> statement-breakpoint
CREATE INDEX "client_exercise_replacements_owner_client_idx" ON "client_exercise_replacements" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_exercise_replacements_owner_client_pair_unique" ON "client_exercise_replacements" USING btree ("owner_id","client_id","from_exercise_id","to_exercise_id");