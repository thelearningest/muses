CREATE TABLE `book_daily_budget` (
	`day` text PRIMARY KEY NOT NULL,
	`admitted_jobs` integer DEFAULT 0 NOT NULL,
	`reserved_cost_units` integer DEFAULT 0 NOT NULL,
	`actual_cost_units` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_hash` text NOT NULL,
	`network_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_book_job_attempts_identity_created` ON `book_job_attempts` (`identity_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_book_job_attempts_network_created` ON `book_job_attempts` (`network_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `book_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_hash` text NOT NULL,
	`identity_hash` text NOT NULL,
	`network_hash` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`page_count` integer,
	`status` text NOT NULL,
	`current_stage` text NOT NULL,
	`batch_cursor` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`cancellation_requested` integer DEFAULT false NOT NULL,
	`cleanup_state` text DEFAULT 'pending' NOT NULL,
	`terminal_error_category` text,
	`mistral_batch_id` text,
	`mistral_input_file_id` text,
	`mistral_output_file_id` text,
	`openai_request_ids` text DEFAULT '[]' NOT NULL,
	`reserved_cost_units` integer DEFAULT 0 NOT NULL,
	`actual_cost_units` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`terminal_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_book_jobs_identity_status` ON `book_jobs` (`identity_hash`,`status`);--> statement-breakpoint
CREATE INDEX `idx_book_jobs_expires_at` ON `book_jobs` (`expires_at`);