CREATE TABLE "bodyweight_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_kg" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bodyweight_entries_owner_measured_idx" ON "bodyweight_entries" USING btree ("owner_id","measured_at");