CREATE TABLE `live_tracking` (
	`id` text PRIMARY KEY NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`speed` real,
	`heading` real,
	`accuracy` real,
	`next_stop` text,
	`completed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 41 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL
);
