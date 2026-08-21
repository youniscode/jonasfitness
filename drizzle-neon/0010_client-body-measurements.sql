CREATE TABLE "client_body_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_kg" double precision,
	"body_fat_percent" double precision,
	"lean_mass_kg" double precision,
	"waist_cm" double precision,
	"chest_cm" double precision,
	"hips_cm" double precision,
	"arm_cm" double precision,
	"thigh_cm" double precision,
	"source" text DEFAULT 'coach' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_body_measurements" ADD CONSTRAINT "client_body_measurements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_body_measurements_owner_client_idx" ON "client_body_measurements" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "client_body_measurements_owner_client_measured_idx" ON "client_body_measurements" USING btree ("owner_id","client_id","measured_at");