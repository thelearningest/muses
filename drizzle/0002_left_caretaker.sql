CREATE TABLE `book_artifact_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`logical_path` text NOT NULL,
	`result_path` text NOT NULL,
	`run_id` text NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_artifact_identity` ON `book_artifact_refs` (`job_id`,`logical_path`);--> statement-breakpoint
CREATE TABLE `book_provider_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`job_id` text NOT NULL,
	`slot` integer NOT NULL,
	`attempt` integer NOT NULL,
	`request_hash` text NOT NULL,
	`state` text NOT NULL,
	`reserved_units` integer NOT NULL,
	`actual_units` integer DEFAULT 0 NOT NULL,
	`result_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_call_identity` ON `book_provider_calls` (`run_id`,`slot`,`attempt`);--> statement-breakpoint
CREATE INDEX `idx_book_call_budget` ON `book_provider_calls` (`job_id`);--> statement-breakpoint
CREATE TABLE `book_stage_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`stage` text NOT NULL,
	`cursor` integer NOT NULL,
	`policy_hash` text NOT NULL,
	`owner` text NOT NULL,
	`lease_until` integer NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_stage_identity` ON `book_stage_runs` (`job_id`,`stage`,`cursor`);