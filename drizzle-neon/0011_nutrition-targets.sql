CREATE TABLE "nutrition_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"calorie_min_kcal" double precision NOT NULL,
	"calorie_max_kcal" double precision NOT NULL,
	"protein_min_grams" double precision NOT NULL,
	"protein_max_grams" double precision NOT NULL,
	"fat_min_grams" double precision NOT NULL,
	"fat_max_grams" double precision NOT NULL,
	"carbohydrate_min_grams" double precision NOT NULL,
	"carbohydrate_max_grams" double precision NOT NULL,
	"source_estimated_bmr_kcal" double precision,
	"source_estimated_tdee_kcal" double precision,
	"source_calorie_min_kcal" double precision,
	"source_calorie_max_kcal" double precision,
	"source_activity_factor" double precision,
	"source_goal" text DEFAULT '' NOT NULL,
	"source_weight_kg" double precision,
	"source_weight_source" text,
	"engine_version" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutrition_targets_owner_client_idx" ON "nutrition_targets" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "nutrition_targets_owner_client_status_idx" ON "nutrition_targets" USING btree ("owner_id","client_id","status");--> statement-breakpoint
CREATE INDEX "nutrition_targets_owner_client_approved_idx" ON "nutrition_targets" USING btree ("owner_id","client_id","approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_targets_owner_client_active_unique" ON "nutrition_targets" USING btree ("owner_id","client_id") WHERE "nutrition_targets"."status" = 'approved';