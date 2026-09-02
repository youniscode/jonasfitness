CREATE TABLE "training_routine_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"routine_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_routine_exercises" ADD COLUMN "section_id" integer;--> statement-breakpoint
ALTER TABLE "training_routine_sections" ADD CONSTRAINT "training_routine_sections_routine_id_training_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."training_routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_routine_sections_owner_routine_idx" ON "training_routine_sections" USING btree ("owner_id","routine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_routine_sections_routine_position_unique" ON "training_routine_sections" USING btree ("routine_id","position");--> statement-breakpoint
ALTER TABLE "training_routine_exercises" ADD CONSTRAINT "training_routine_exercises_section_id_training_routine_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."training_routine_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_routine_exercises_section_idx" ON "training_routine_exercises" USING btree ("section_id");