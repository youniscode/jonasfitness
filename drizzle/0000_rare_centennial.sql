CREATE TABLE `check_ins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`weight` real,
	`energy` integer NOT NULL,
	`sleep` integer NOT NULL,
	`stress` integer NOT NULL,
	`adherence` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`ai_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT 'Build muscle' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sessions_per_week` integer DEFAULT 4 NOT NULL,
	`current_weight` real,
	`adherence` integer DEFAULT 0 NOT NULL,
	`next_check_in` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `programmes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`sessions_per_week` integer NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL
);
