CREATE TABLE "session_credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"related_session_id" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_credit_ledger" ADD CONSTRAINT "session_credit_ledger_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_credit_ledger" ADD CONSTRAINT "session_credit_ledger_related_session_id_sessions_id_fk" FOREIGN KEY ("related_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_credit_ledger_client_created_idx" ON "session_credit_ledger" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "session_credit_ledger_owner_idx" ON "session_credit_ledger" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_credit_ledger_session_reason_unique" ON "session_credit_ledger" USING btree ("related_session_id","reason") WHERE "session_credit_ledger"."related_session_id" IS NOT NULL;