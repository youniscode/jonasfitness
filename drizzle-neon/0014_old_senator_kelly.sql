CREATE TABLE "commerce_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"product_key" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_checkout_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text DEFAULT 'processed' NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"product_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'stripe_checkout' NOT NULL,
	"order_id" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"event_name" text NOT NULL,
	"dedupe_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_entitlements" ADD CONSTRAINT "product_entitlements_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_orders_owner_created_idx" ON "commerce_orders" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_provider_checkout_unique" ON "commerce_orders" USING btree ("provider","provider_checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_unique" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_provider_type_idx" ON "payment_webhook_events" USING btree ("provider","event_type");--> statement-breakpoint
CREATE INDEX "product_entitlements_owner_idx" ON "product_entitlements" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entitlements_owner_product_unique" ON "product_entitlements" USING btree ("owner_id","product_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entitlements_owner_product_active_unique" ON "product_entitlements" USING btree ("owner_id","product_key") WHERE "product_entitlements"."status" = 'active';--> statement-breakpoint
CREATE INDEX "validation_events_owner_created_idx" ON "validation_events" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "validation_events_owner_name_key_unique" ON "validation_events" USING btree ("owner_id","event_name","dedupe_key");