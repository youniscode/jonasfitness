CREATE TABLE "meal_plan_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"meal_plan_id" integer NOT NULL,
	"meal_plan_version_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal_plan_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"meals_snapshot" text NOT NULL,
	"nutrition_snapshot" text NOT NULL,
	"approved_target_snapshot" text NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"title" text DEFAULT 'Nutrition Plan' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_plan_assignments" ADD CONSTRAINT "meal_plan_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_assignments" ADD CONSTRAINT "meal_plan_assignments_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_assignments" ADD CONSTRAINT "meal_plan_assignments_meal_plan_version_id_meal_plan_versions_id_fk" FOREIGN KEY ("meal_plan_version_id") REFERENCES "public"."meal_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_versions" ADD CONSTRAINT "meal_plan_versions_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_plan_assignments_owner_client_idx" ON "meal_plan_assignments" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "meal_plan_assignments_client_active_idx" ON "meal_plan_assignments" USING btree ("client_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_assignments_client_active_unique" ON "meal_plan_assignments" USING btree ("client_id") WHERE "meal_plan_assignments"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_versions_plan_number_unique" ON "meal_plan_versions" USING btree ("meal_plan_id","version_number");--> statement-breakpoint
CREATE INDEX "meal_plan_versions_owner_plan_idx" ON "meal_plan_versions" USING btree ("owner_id","meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plan_versions_plan_status_idx" ON "meal_plan_versions" USING btree ("meal_plan_id","status");--> statement-breakpoint
CREATE INDEX "meal_plans_owner_client_idx" ON "meal_plans" USING btree ("owner_id","client_id");