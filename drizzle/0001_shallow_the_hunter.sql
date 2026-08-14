CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`start_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`pulse_token` text NOT NULL,
	`readiness_level` text DEFAULT 'pending' NOT NULL,
	`readiness_score` integer,
	`energy` integer,
	`sleep` integer,
	`soreness` integer,
	`stress` integer,
	`pain` integer DEFAULT 0 NOT NULL,
	`pain_area` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`ai_summary` text DEFAULT '' NOT NULL,
	`coach_action` text DEFAULT '' NOT NULL,
	`responded_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_pulse_token_unique` ON `sessions` (`pulse_token`);